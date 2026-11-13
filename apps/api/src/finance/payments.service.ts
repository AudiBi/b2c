import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import { receiptNumber, webhookEventSchema, type PaymentMethod, type PaymentStatus } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService, type Tx } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import { IdempotencyService } from '../infra/idempotency.service';
import { csvCell } from '../logistics/manifest';
import { displayName, OutboxService } from '../notifications/outbox.service';
import { CompanyDirectory } from '../platform/company-directory.service';
import type { AuthContext } from '../security/auth.types';
import { paymentDto } from './invoices.service';
import { readFxRate } from './fx';
import { D, LedgerService, money, type Decimal } from './ledger.service';

const dec = (v: Decimal | null | undefined) => (v === null || v === undefined ? null : new D(v).toFixed(2));

/** Tolérance de l'horodatage signé d'une confirmation de prestataire (rejeu hors fenêtre refusé). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly counters: CounterService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly companies: CompanyDirectory,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Confirmation : un seul chemin (espèces, validation d'un virement, confirmation signée du prestataire)
  // ---------------------------------------------------------------------------------------------

  /** Passe un paiement EN ATTENTE à « confirmé », met à jour la facture, émet le reçu et la notification. */
  private async confirm(tx: Tx, companyId: string, paymentId: string, actorUserId: string | null, extra: { provider?: string; providerRef?: string } = {}) {
    const found = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!found) throw AppException.notFound('PAYMENT_NOT_FOUND', 'Paiement introuvable');
    const invoice = await this.ledger.lockInvoice(tx, found.invoiceId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status !== 'PENDING') throw AppException.conflict('PAYMENT_NOT_PENDING', "Ce paiement n'est plus en attente");
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) throw AppException.conflict('INVOICE_NOT_PAYABLE', "La facture n'accepte plus de paiement");

    const now = new Date();
    const confirmed = await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'CONFIRMED', confirmedAt: now, recordedBy: payment.recordedBy ?? actorUserId, provider: extra.provider ?? payment.provider, providerRef: extra.providerRef ?? payment.providerRef },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { paidTotal: new D(invoice.paidTotal).add(payment.amount) } });
    await this.ledger.settle(tx, companyId, actorUserId, invoice.id);
    const year = now.getUTCFullYear();
    const receipt = await tx.receipt.create({
      data: { companyId, paymentId, number: receiptNumber(year, await this.counters.next(tx, companyId, 'receipt', year)), issuedBy: actorUserId, issuedAt: now },
    });
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: payment.customerId }, include: { user: true } });
    await this.outbox.emit(tx, {
      companyId,
      eventCode: 'payment.confirmed',
      aggregateType: 'payment',
      aggregateId: paymentId,
      customerId: payment.customerId,
      payload: { customerName: displayName(customer), invoiceNumber: invoice.number ?? '', receiptNumber: receipt.number, amount: new D(payment.amount).toFixed(2), currency: payment.currency },
    });
    await this.audit.record(tx, { companyId, action: 'payment.confirmed', entityType: 'payment', entityId: paymentId, actorUserId: actorUserId ?? undefined, after: { method: payment.method, amount: new D(payment.amount).toFixed(2), receipt: receipt.number } });
    return { payment: confirmed, receiptNumber: receipt.number };
  }

  /** Montant encore payable sur la facture, hors paiements déjà réservés. */
  private async assertPayable(tx: Tx, invoiceId: string, amount: Decimal) {
    const invoice = await this.ledger.lockInvoice(tx, invoiceId);
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) throw AppException.conflict('INVOICE_NOT_PAYABLE', "La facture n'accepte pas de paiement (brouillon, réglée, annulée ou créditée)");
    const pending = await this.ledger.pendingTotal(tx, invoiceId);
    const available = this.ledger.balance(invoice).sub(pending);
    if (amount.gt(available)) throw new AppException(422, 'AMOUNT_EXCEEDS_BALANCE', 'Le montant dépasse ce qui reste à payer', { available: available.toFixed(2) });
    return invoice;
  }

  // ---------------------------------------------------------------------------------------------
  // Espèces (employé)
  // ---------------------------------------------------------------------------------------------

  /** Caisse ouverte de l'agence (ou de l'entreprise) POUR CETTE DEVISE : une caisse n'a qu'une devise. */
  private async openSession(tx: Tx, agencyId: string | null, currency: string) {
    return tx.cashSession.findFirst({ where: { agencyId, currency, closedAt: null } });
  }

  async recordCash(auth: AuthContext, input: { invoiceId: string; amount: number; reference?: string; agencyId?: string }, idempotencyKey?: string) {
    // Encaisser pour une agence demande le droit sur cette agence ; sans agence, le droit sur toute l'entreprise
    const allowed = input.agencyId ? auth.permissions.can('payment:record_cash', { type: 'AGENCY', id: input.agencyId }) : auth.permissions.can('payment:record_cash');
    if (!allowed) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette caisse');
    const run = async (tx: Tx) => {
      const amount = money(input.amount);
      if (input.agencyId && !(await tx.agency.findUnique({ where: { id: input.agencyId } }))) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable');
      // La caisse est choisie d'après la devise de la facture : jamais d'encaissement dans une caisse d'une autre devise
      const target = await tx.invoice.findUnique({ where: { id: input.invoiceId }, select: { currency: true } });
      if (!target) throw AppException.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
      const session = await this.openSession(tx, input.agencyId ?? null, target.currency);
      if (!session) throw new AppException(409, 'CASH_SESSION_REQUIRED', `Ouvrez la caisse en ${target.currency} avant d'encaisser des espèces dans cette devise`, { currency: target.currency });
      const invoice = await this.assertPayable(tx, input.invoiceId, amount);
      let payment: Payment;
      try {
        payment = await tx.payment.create({
          data: { companyId: auth.companyId, customerId: invoice.customerId, invoiceId: invoice.id, method: 'CASH', currency: invoice.currency, amount, reference: input.reference, recordedBy: auth.userId, agencyId: input.agencyId, cashSessionId: session.id },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw AppException.conflict('DUPLICATE_REFERENCE', 'Cette référence est déjà enregistrée');
        throw error;
      }
      const confirmed = await this.confirm(tx, auth.companyId, payment.id, auth.userId);
      return { payment: paymentDto({ ...confirmed.payment, receipt: { number: confirmed.receiptNumber } }), receiptNumber: confirmed.receiptNumber };
    };
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      if (!idempotencyKey) return run(tx);
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const out = await this.idempotency.run(tx, { companyId: auth.companyId, scope: 'payments.cash', key: idempotencyKey, requestHash: hash }, async () => JSON.parse(JSON.stringify(await run(tx))));
      return { ...out.result, replayed: out.replayed };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Virement ou mobile : déclaré par le client, validé par le personnel (ou confirmé par le prestataire)
  // ---------------------------------------------------------------------------------------------

  async declare(auth: AuthContext, invoiceId: string, input: { method: 'BANK_TRANSFER' | 'ZELLE' | 'MOBILE_MONEY'; amount: number; reference: string }) {
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const customer = auth.kind === 'CUSTOMER' ? await tx.customer.findUnique({ where: { userId: auth.userId } }) : null;
        const own = customer ? await tx.invoice.findFirst({ where: { id: invoiceId, customerId: customer.id, status: { not: 'DRAFT' } }, select: { id: true } }) : null;
        if (!customer || !own) throw AppException.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
        const invoice = await this.assertPayable(tx, invoiceId, money(input.amount));
        const payment = await tx.payment.create({
          data: { companyId: auth.companyId, customerId: customer.id, invoiceId, method: input.method, currency: invoice.currency, amount: money(input.amount), reference: input.reference, declaredByCustomer: true },
        });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'payment.declared', entityType: 'payment', entityId: payment.id, after: { method: input.method, amount: money(input.amount).toFixed(2) } });
        return paymentDto(payment);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('DUPLICATE_REFERENCE', 'Cette référence de paiement a déjà été déclarée');
      throw error;
    }
  }

  /** Le client retire sa déclaration tant que le personnel ne l'a pas validée. */
  async cancelMine(auth: AuthContext, paymentId: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = auth.kind === 'CUSTOMER' ? await tx.customer.findUnique({ where: { userId: auth.userId } }) : null;
      const payment = customer ? await tx.payment.findFirst({ where: { id: paymentId, customerId: customer.id } }) : null;
      if (!payment) throw AppException.notFound('PAYMENT_NOT_FOUND', 'Paiement introuvable');
      await this.ledger.lockInvoice(tx, payment.invoiceId);
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (fresh.status !== 'PENDING') throw AppException.conflict('PAYMENT_NOT_PENDING', "Ce paiement n'est plus en attente");
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'CANCELLED', failureReason: 'Retiré par le client' } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'payment.cancelled', entityType: 'payment', entityId: paymentId });
    });
  }

  async confirmByStaff(auth: AuthContext, paymentId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw AppException.notFound('PAYMENT_NOT_FOUND', 'Paiement introuvable');
      if (payment.method === 'CASH') throw AppException.conflict('PAYMENT_NOT_PENDING', 'Un paiement en espèces est confirmé dès son enregistrement');
      const done = await this.confirm(tx, auth.companyId, paymentId, auth.userId);
      return { payment: paymentDto({ ...done.payment, receipt: { number: done.receiptNumber } }), receiptNumber: done.receiptNumber };
    });
  }

  async reject(auth: AuthContext, paymentId: string, reason: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const found = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!found) throw AppException.notFound('PAYMENT_NOT_FOUND', 'Paiement introuvable');
      await this.ledger.lockInvoice(tx, found.invoiceId);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.status !== 'PENDING') throw AppException.conflict('PAYMENT_NOT_PENDING', "Ce paiement n'est plus en attente");
      const updated = await tx.payment.update({ where: { id: paymentId }, data: { status: 'FAILED', failureReason: reason } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'payment.rejected', entityType: 'payment', entityId: paymentId, after: { reason } });
      return paymentDto(updated);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Remboursement (enregistrement manuel : l'argent est rendu hors de la plateforme)
  // ---------------------------------------------------------------------------------------------

  async refund(auth: AuthContext, paymentId: string, input: { amount: number; reason: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const found = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!found) throw AppException.notFound('PAYMENT_NOT_FOUND', 'Paiement introuvable');
      const invoice = await this.ledger.lockInvoice(tx, found.invoiceId);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (!['CONFIRMED', 'REFUNDED_PARTIAL'].includes(payment.status)) throw AppException.conflict('PAYMENT_NOT_REFUNDABLE', "Seul un paiement confirmé se rembourse");
      const amount = money(input.amount);
      const refundable = new D(payment.amount).sub(payment.refundedTotal);
      if (amount.gt(refundable)) throw new AppException(422, 'REFUND_EXCEEDS_PAYMENT', 'Le remboursement dépasse ce qui reste remboursable', { refundable: refundable.toFixed(2) });

      const refund = await tx.refund.create({ data: { companyId: auth.companyId, paymentId, amount, reason: input.reason, createdBy: auth.userId } });
      const refundedTotal = new D(payment.refundedTotal).add(amount);
      await tx.payment.update({ where: { id: paymentId }, data: { refundedTotal, status: refundedTotal.eq(payment.amount) ? 'REFUNDED' : 'REFUNDED_PARTIAL' } });
      await tx.invoice.update({ where: { id: invoice.id }, data: { paidTotal: new D(invoice.paidTotal).sub(amount) } });
      await this.ledger.settle(tx, auth.companyId, auth.userId, invoice.id);
      await this.audit.record(tx, { companyId: auth.companyId, action: 'payment.refunded', entityType: 'payment', entityId: paymentId, after: { amount: amount.toFixed(2), reason: input.reason } });
      return { refundId: refund.id, payment: paymentDto(await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { receipt: { select: { number: true } } } })) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------------------------

  async list(auth: AuthContext, query: { limit: number; cursor?: string; status?: PaymentStatus; method?: PaymentMethod; invoiceId?: string }) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.payment.findMany({
        where: { status: query.status, method: query.method, invoiceId: query.invoiceId, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
        include: { receipt: { select: { number: true } }, invoice: { select: { number: true } }, customer: { select: { customerCode: true } } },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map((p) => ({ ...paymentDto(p), invoiceNumber: p.invoice.number, customerCode: p.customer.customerCode })), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  async receiptData(auth: AuthContext, paymentId: string, mine: boolean) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = mine && auth.kind === 'CUSTOMER' ? await tx.customer.findUnique({ where: { userId: auth.userId } }) : null;
      if (mine && !customer) throw AppException.notFound('RECEIPT_NOT_FOUND', 'Reçu introuvable');
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, ...(customer ? { customerId: customer.id } : {}) },
        include: { receipt: true, invoice: true, customer: { include: { user: true } } },
      });
      if (!payment?.receipt) throw AppException.notFound('RECEIPT_NOT_FOUND', 'Reçu introuvable');
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { name: true } });
      return {
        htgPerUsd: await readFxRate(tx, auth.companyId),
        company: company.name,
        receiptNumber: payment.receipt.number,
        issuedAt: payment.receipt.issuedAt,
        invoiceNumber: payment.invoice.number ?? '',
        customer: `${displayName(payment.customer)} (${payment.customer.customerCode})`,
        method: payment.method,
        reference: payment.reference,
        amount: new D(payment.amount).toFixed(2),
        currency: payment.currency,
        refunded: new D(payment.refundedTotal).toFixed(2),
      };
    });
  }

  async mine(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = auth.kind === 'CUSTOMER' ? await tx.customer.findUnique({ where: { userId: auth.userId } }) : null;
      if (!customer) return { items: [] };
      const rows = await tx.payment.findMany({ where: { customerId: customer.id }, include: { receipt: { select: { number: true } } }, orderBy: { id: 'desc' }, take: 100 });
      return { items: rows.map((p) => paymentDto(p)) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Caisse
  // ---------------------------------------------------------------------------------------------

  private sessionDto(s: { id: string; agencyId: string | null; currency: string; openedAt: Date; openingAmount: Decimal; closedAt: Date | null; countedAmount: Decimal | null; expectedAmount: Decimal | null; difference: Decimal | null }) {
    return { id: s.id, agencyId: s.agencyId, currency: s.currency, openedAt: s.openedAt, openingAmount: dec(s.openingAmount), closedAt: s.closedAt, countedAmount: dec(s.countedAmount), expectedAmount: dec(s.expectedAmount), difference: dec(s.difference) };
  }

  private cashScope(auth: AuthContext, agencyId: string | null | undefined): void {
    const allowed = agencyId ? auth.permissions.can('payment:record_cash', { type: 'AGENCY', id: agencyId }) : auth.permissions.can('payment:record_cash');
    if (!allowed) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette caisse');
  }

  async openCash(auth: AuthContext, input: { agencyId?: string; currency?: string; openingAmount?: number }) {
    this.cashScope(auth, input.agencyId);
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        if (input.agencyId && !(await tx.agency.findUnique({ where: { id: input.agencyId } }))) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable');
        const currency = input.currency ?? (await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { defaultCurrency: true } })).defaultCurrency;
        const session = await tx.cashSession.create({ data: { companyId: auth.companyId, agencyId: input.agencyId, currency, openedBy: auth.userId, openingAmount: money(input.openingAmount ?? 0) } });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'cash_session.opened', entityType: 'cash_session', entityId: session.id });
        return this.sessionDto(session);
      });
    } catch (error) {
      if (isUniqueViolation(error) || /cash_sessions_one_open/.test(String((error as Error).message))) throw AppException.conflict('CASH_SESSION_OPEN', 'Une caisse est déjà ouverte ici dans cette devise');
      throw error;
    }
  }

  /** Attendu = fond de caisse + espèces encaissées pendant la session − espèces remboursées pendant la session. */
  async closeCash(auth: AuthContext, sessionId: string, countedAmount: number) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const session = await tx.cashSession.findUnique({ where: { id: sessionId } });
      if (!session) throw AppException.notFound('CASH_SESSION_NOT_FOUND', 'Caisse introuvable');
      this.cashScope(auth, session.agencyId);
      if (session.closedAt) throw AppException.conflict('CASH_SESSION_CLOSED', 'Cette caisse est déjà clôturée');
      const now = new Date();
      const collected = await tx.payment.aggregate({ where: { cashSessionId: sessionId, method: 'CASH', status: { in: ['CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED'] } }, _sum: { amount: true } });
      const refunded = await tx.refund.aggregate({
        where: { createdAt: { gte: session.openedAt, lte: now }, payment: { method: 'CASH', agencyId: session.agencyId, currency: session.currency } },
        _sum: { amount: true },
      });
      const expected = new D(session.openingAmount).add(collected._sum.amount ?? 0).sub(refunded._sum.amount ?? 0);
      const counted = money(countedAmount);
      const closed = await tx.cashSession.update({ where: { id: sessionId }, data: { closedAt: now, closedBy: auth.userId, countedAmount: counted, expectedAmount: expected, difference: counted.sub(expected) } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'cash_session.closed', entityType: 'cash_session', entityId: sessionId, after: { expected: expected.toFixed(2), counted: counted.toFixed(2) } });
      return this.sessionDto(closed);
    });
  }

  async listCash(auth: AuthContext) {
    const restrict = auth.permissions.can('payment:read') ? undefined : auth.permissions.scopeIds('payment:read', 'AGENCY');
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.cashSession.findMany({ where: restrict ? { agencyId: { in: restrict } } : undefined, orderBy: { openedAt: 'desc' }, take: 50 }),
    );
    return { items: rows.map((s) => this.sessionDto(s)) };
  }

  // ---------------------------------------------------------------------------------------------
  // Rapprochement et export
  // ---------------------------------------------------------------------------------------------

  /** Registre chronologique (factures émises, encaissements, remboursements, avoirs) en CSV sûr pour un tableur. */
  async exportCsv(auth: AuthContext, from: string, to: string): Promise<string> {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    const data = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const [invoices, payments, refunds, credits] = await Promise.all([
        tx.invoice.findMany({ where: { issuedAt: { gte: start, lte: end } }, include: { customer: { select: { customerCode: true } } } }),
        tx.payment.findMany({ where: { confirmedAt: { gte: start, lte: end } }, include: { receipt: true, invoice: { select: { number: true } }, customer: { select: { customerCode: true } } } }),
        tx.refund.findMany({ where: { createdAt: { gte: start, lte: end } }, include: { payment: { include: { invoice: { select: { number: true } }, customer: { select: { customerCode: true } } } } } }),
        tx.creditNote.findMany({ where: { createdAt: { gte: start, lte: end } }, include: { invoice: { include: { customer: { select: { customerCode: true } } } } } }),
      ]);
      return { invoices, payments, refunds, credits };
    });
    type Row = { at: Date; cells: string[] };
    const rows: Row[] = [];
    for (const i of data.invoices) rows.push({ at: i.issuedAt as Date, cells: ['FACTURE', i.number ?? '', i.customer.customerCode, '', i.currency, new D(i.total).toFixed(2), i.status, ''] });
    for (const p of data.payments) rows.push({ at: p.confirmedAt as Date, cells: ['PAIEMENT', p.receipt?.number ?? '', p.customer.customerCode, p.method, p.currency, new D(p.amount).toFixed(2), p.status, `${p.invoice.number ?? ''} ${p.reference ?? ''}`.trim()] });
    for (const r of data.refunds) rows.push({ at: r.createdAt, cells: ['REMBOURSEMENT', '', r.payment.customer.customerCode, r.payment.method, r.payment.currency, new D(r.amount).neg().toFixed(2), '', `${r.payment.invoice.number ?? ''} ${r.reason}`.trim()] });
    for (const c of data.credits) rows.push({ at: c.createdAt, cells: ['AVOIR', c.number, c.invoice.customer.customerCode, '', c.invoice.currency, new D(c.amount).neg().toFixed(2), '', `${c.invoice.number ?? ''} ${c.reason}`.trim()] });
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    const header = ['Date (UTC)', 'Type', 'Numéro', 'Code client', 'Mode', 'Devise', 'Montant', 'Statut', 'Référence'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      const [type, number, code, method, currency, amount, status, reference] = r.cells;
      // Le montant est calculé par le serveur (jamais saisi) : écrit tel quel pour rester numérique, y compris négatif.
      const cells = [r.at.toISOString().replace('T', ' ').slice(0, 19), type, number, code, method, currency].map(csvCell);
      lines.push([...cells, amount, ...[status, reference].map(csvCell)].join(','));
    }
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  /** Synthèse de rapprochement : encaissé net, en attente, remboursé, par mode et par devise. */
  async summary(auth: AuthContext, from: string, to: string) {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const confirmed = await tx.payment.groupBy({ by: ['method', 'currency'], where: { confirmedAt: { gte: start, lte: end } }, _sum: { amount: true, refundedTotal: true }, _count: { _all: true } });
      const pending = await tx.payment.groupBy({ by: ['method', 'currency'], where: { status: 'PENDING' }, _sum: { amount: true }, _count: { _all: true } });
      return {
        from,
        to,
        confirmed: confirmed.map((g) => ({ method: g.method, currency: g.currency, count: g._count._all, collected: dec(g._sum.amount), refunded: dec(g._sum.refundedTotal), net: dec(new D(g._sum.amount ?? 0).sub(g._sum.refundedTotal ?? 0)) })),
        pending: pending.map((g) => ({ method: g.method, currency: g.currency, count: g._count._all, amount: dec(g._sum.amount) })),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Confirmation signée d'un prestataire de paiement
  // ---------------------------------------------------------------------------------------------

  /** Le point d'entrée n'existe que si un prestataire est configuré (variables d'environnement) : sinon rien n'est simulé. */
  providerConfigured(provider: string): boolean {
    const env = this.config.env;
    return !!env.PAYMENT_WEBHOOK_PROVIDER && !!env.PAYMENT_WEBHOOK_SECRET && env.PAYMENT_WEBHOOK_PROVIDER === provider;
  }

  /** Signature : « t=<secondes>,v1=<hex> » où v1 = HMAC-SHA256(secret, `${t}.${corps brut}`). */
  verifySignature(rawBody: Buffer, header: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): void {
    const invalid = () => AppException.unauthorized('INVALID_SIGNATURE', 'Signature invalide');
    const secret = this.config.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !header) throw invalid();
    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
    const timestamp = Number(parts.t);
    if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) throw invalid();
    if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw invalid();
    const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
    const given = Buffer.from(parts.v1, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
  }

  async handleWebhook(slug: string, provider: string, rawBody: Buffer, signature: string | undefined) {
    if (!this.providerConfigured(provider)) throw AppException.notFound('NOT_FOUND', 'Ressource introuvable');
    this.verifySignature(rawBody, signature);
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw AppException.badRequest('INVALID_PAYLOAD', 'Corps illisible');
    }
    const parsed = webhookEventSchema.safeParse(json);
    if (!parsed.success) throw AppException.badRequest('INVALID_PAYLOAD', 'Événement invalide');
    const event = parsed.data;
    const company = await this.companies.requirePublic(slug);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    return this.db.run({ companyId: company.id }, async (tx) => {
      // Rejeu : un même événement n'a jamais deux effets (verrou par événement puis contrainte unique)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook:${company.id}:${provider}:${event.eventId}`}, 0))`;
      const seen = await tx.providerWebhookEvent.findUnique({ where: { companyId_provider_eventId: { companyId: company.id, provider, eventId: event.eventId } } });
      if (seen) return { status: 'DUPLICATE' as const };

      const record = (status: string) => tx.providerWebhookEvent.create({ data: { companyId: company.id, provider, eventId: event.eventId, payloadHash, status } });
      const payment = await tx.payment.findFirst({ where: { reference: event.providerRef, status: 'PENDING', method: { in: ['BANK_TRANSFER', 'ZELLE', 'MOBILE_MONEY'] } } });
      if (!payment) {
        await record('UNMATCHED');
        return { status: 'UNMATCHED' as const };
      }
      if (!new D(payment.amount).eq(event.amount) || payment.currency !== event.currency) {
        await record('MISMATCH');
        this.logger.warn(`Confirmation ${event.eventId} : montant ou devise différent du paiement ${payment.id}`);
        return { status: 'MISMATCH' as const };
      }
      if (event.type === 'payment.failed') {
        await this.ledger.lockInvoice(tx, payment.invoiceId);
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'Refusé par le prestataire', provider, providerRef: event.providerRef } });
        await record('PROCESSED');
        await this.audit.record(tx, { companyId: company.id, action: 'payment.failed_by_provider', entityType: 'payment', entityId: payment.id });
        return { status: 'PROCESSED' as const };
      }
      await this.confirm(tx, company.id, payment.id, null, { provider, providerRef: event.providerRef });
      await record('PROCESSED');
      return { status: 'PROCESSED' as const };
    });
  }
}

