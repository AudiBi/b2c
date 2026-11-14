import { memberAccount } from '../customers/account';
import { Injectable } from '@nestjs/common';
import { Prisma, type Invoice, type InvoiceLine, type CreditNote, type Payment } from '@prisma/client';
import { formatTrackingNumber, invoiceNumber, creditNoteNumber, type CreateInvoiceInput, type InvoiceLineKind, type InvoiceStatus } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import { displayName, OutboxService } from '../notifications/outbox.service';
import { PackagesService } from '../packages/packages.service';
import type { AuthContext } from '../security/auth.types';
import { readFxRate } from './fx';
import { D, LedgerService, money, type Decimal } from './ledger.service';

type InvoiceFull = Invoice & {
  lines: InvoiceLine[];
  credits: CreditNote[];
  payments: (Payment & { receipt: { number: string } | null })[];
  packages: { package: { id: string; trackingNumber: string } }[];
  customer: { id: string; customerCode: string; customerType: string; user: { firstName: string; lastName: string; businessName: string | null } };
};
const full = {
  lines: { orderBy: { position: 'asc' } },
  credits: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' }, include: { receipt: { select: { number: true } } } },
  packages: { include: { package: { select: { id: true, trackingNumber: true } } } },
  customer: { include: { user: { select: { firstName: true, lastName: true, businessName: true } } } },
} satisfies Prisma.InvoiceInclude;

const dec = (value: Decimal | null | undefined) => (value === null || value === undefined ? null : new D(value).toFixed(2));

export function paymentDto(p: Payment & { receipt?: { number: string } | null }) {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    method: p.method,
    status: p.status,
    currency: p.currency,
    amount: dec(p.amount),
    refundedTotal: dec(p.refundedTotal),
    reference: p.reference,
    provider: p.provider,
    declaredByCustomer: p.declaredByCustomer,
    failureReason: p.failureReason,
    confirmedAt: p.confirmedAt,
    createdAt: p.createdAt,
    receiptNumber: p.receipt?.number ?? null,
  };
}

export function invoiceDto(inv: InvoiceFull, pending: Decimal) {
  const balance = new D(inv.total).sub(inv.creditedTotal).sub(inv.paidTotal);
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    customer: { id: inv.customer.id, customerCode: inv.customer.customerCode, name: displayName(inv.customer) },
    currency: inv.currency,
    subtotal: dec(inv.subtotal),
    discountTotal: dec(inv.discountTotal),
    taxTotal: dec(inv.taxTotal),
    total: dec(inv.total),
    creditedTotal: dec(inv.creditedTotal),
    paidTotal: dec(inv.paidTotal),
    pendingTotal: dec(pending),
    balance: dec(balance),
    discountPercent: inv.discountPercent ? new D(inv.discountPercent).toFixed(2) : null,
    dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
    notes: inv.notes,
    issuedAt: inv.issuedAt,
    voidedAt: inv.voidedAt,
    voidReason: inv.voidReason,
    createdAt: inv.createdAt,
    lines: inv.lines.map((l) => ({ id: l.id, kind: l.kind, description: l.description, quantity: new D(l.quantity).toString(), unitPrice: dec(l.unitPrice), amount: dec(l.amount), packageId: l.packageId })),
    credits: inv.credits.map((c) => ({ id: c.id, number: c.number, amount: dec(c.amount), reason: c.reason, createdAt: c.createdAt })),
    payments: inv.payments.map((p) => paymentDto(p)),
    packages: inv.packages.map((p) => ({ id: p.package.id, trackingNumber: p.package.trackingNumber, trackingNumberDisplay: formatTrackingNumber(p.package.trackingNumber) })),
  };
}

const BILLABLE = ['REGISTERED_WEIGHED', 'AWAITING_PAYMENT'];
const SNAPSHOT_KIND: Record<string, InvoiceLineKind> = { FREIGHT: 'FREIGHT', SURCHARGE: 'HANDLING', INSURANCE: 'INSURANCE', TAX: 'TAX' };

@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly counters: CounterService,
    private readonly packages: PackagesService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Création d'un brouillon : les frais viennent de la pesée (grille appliquée), jamais d'une saisie libre
  // ---------------------------------------------------------------------------------------------

  async createDraft(auth: AuthContext, input: CreateInvoiceInput) {
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
        if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');

        const percent = input.discountPercent ?? 0;
        if (percent > 0) {
          if (!auth.permissions.can('discount:apply')) throw AppException.forbidden('DISCOUNT_NOT_ALLOWED', "Vous n'avez pas le droit d'accorder une remise");
          const { maxDiscountPercent } = await this.ledger.settings(tx);
          if (percent > maxDiscountPercent) throw new AppException(422, 'DISCOUNT_ABOVE_CAP', `La remise dépasse le plafond de l'entreprise (${maxDiscountPercent} %)`, { max: maxDiscountPercent });
        }

        if (input.unitDiscounts.length > 0) {
          if (!auth.permissions.can('discount:apply')) throw AppException.forbidden('DISCOUNT_NOT_ALLOWED', "Vous n'avez pas le droit d'accorder une remise");
          for (const u of input.unitDiscounts) {
            if (!input.packageIds.includes(u.packageId)) throw AppException.badRequest('UNIT_DISCOUNT_PACKAGE_UNKNOWN', "Un rabais désigne un colis qui n'est pas sur la facture");
          }
          if (new Set(input.unitDiscounts.map((u) => u.packageId)).size !== input.unitDiscounts.length) throw AppException.badRequest('UNIT_DISCOUNT_DUPLICATE', 'Un colis a deux rabais');
        }
        const unitDiscounts = new Map(input.unitDiscounts.map((u) => [u.packageId, u.perUnit]));
        if (input.priceOverrides.length > 0 && !auth.permissions.can('price:override')) {
          throw AppException.forbidden('PRICE_OVERRIDE_NOT_ALLOWED', "Vous n'avez pas le droit de fixer un prix à la main");
        }
        const overrides = new Map(input.priceOverrides.map((o) => [o.packageId, o]));
        if (overrides.size !== input.priceOverrides.length) throw AppException.badRequest('PRICE_OVERRIDE_DUPLICATE', 'Un colis a deux prix convenus');
        for (const id of overrides.keys()) {
          if (!input.packageIds.includes(id)) throw AppException.badRequest('PRICE_OVERRIDE_PACKAGE_UNKNOWN', "Un prix convenu désigne un colis qui n'est pas sur la facture");
        }
        const overrideAudit: { packageId: string; computed: string | null; agreed: string; reason: string }[] = [];

        const packages = await tx.package.findMany({ where: { id: { in: input.packageIds } }, include: { invoicePackage: true } });
        if (packages.length !== input.packageIds.length) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Un des colis est introuvable');
        for (const pkg of packages) {
          if (pkg.customerId !== input.customerId) throw AppException.conflict('PACKAGE_CUSTOMER_MISMATCH', "Un des colis n'appartient pas à ce client");
          if (!BILLABLE.includes(pkg.status)) throw new AppException(409, 'PACKAGE_NOT_BILLABLE', 'Un colis doit être pesé (et pas encore prêt ou parti) pour être facturé', { trackingNumber: pkg.trackingNumber, status: pkg.status });
          if (pkg.invoicePackage) throw new AppException(409, 'ALREADY_INVOICED', 'Un des colis est déjà sur une facture', { trackingNumber: pkg.trackingNumber });
        }
        const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { defaultCurrency: true } });

        const lines: { kind: InvoiceLineKind; description: string; amount: Decimal; packageId: string | null }[] = [];
        const currencies = new Set<string>();
        for (const pkg of packages) {
          const display = formatTrackingNumber(pkg.trackingNumber);
          const snapshot = pkg.pricingSnapshot as { kind?: string; result?: { currency: string; lines: { code: string; kind: string; label: Record<string, string> | null; amount: string }[] } } | null;
          const extraFreight = input.extraLines.filter((l) => l.packageId === pkg.id && l.kind === 'FREIGHT');
          const agreed = overrides.get(pkg.id);
          if (agreed) {
            if (extraFreight.length > 0) throw new AppException(409, 'PACKAGE_ALREADY_PRICED', 'Un prix convenu remplace le fret : pas de fret saisi en plus', { trackingNumber: pkg.trackingNumber });
            const computed = snapshot?.kind === 'COMPUTED_AT_WEIGHING' ? (snapshot.result ?? null) : null;
            if (computed) currencies.add(computed.currency);
            const computedTotal = computed ? computed.lines.reduce((acc, l) => acc.add(new D(l.amount)), new D(0)) : null;
            overrideAudit.push({ packageId: pkg.id, computed: computedTotal ? computedTotal.toFixed(2) : null, agreed: money(agreed.amount).toFixed(2), reason: agreed.reason });
            lines.push({ kind: 'FREIGHT', description: `Prix convenu — ${display}`.slice(0, 200), amount: money(agreed.amount), packageId: pkg.id });
            continue;
          }
          if (snapshot?.kind === 'COMPUTED_AT_WEIGHING' && snapshot.result) {
            if (extraFreight.length > 0) throw new AppException(409, 'PACKAGE_ALREADY_PRICED', 'Ce colis a déjà un tarif calculé : pas de fret saisi à la main', { trackingNumber: pkg.trackingNumber });
            currencies.add(snapshot.result.currency);
            for (const line of snapshot.result.lines) {
              const kind = SNAPSHOT_KIND[line.kind];
              if (!kind) continue;
              const label = line.kind === 'FREIGHT' ? 'Fret' : (line.label?.fr ?? line.code);
              lines.push({ kind, description: `${label} — ${display}`.slice(0, 200), amount: new D(line.amount), packageId: pkg.id });
            }
            const perUnit = unitDiscounts.get(pkg.id);
            if (perUnit !== undefined) {
              const r = snapshot.result as unknown as { basis?: string; quantity?: number; freight?: string };
              const quantity = r.quantity ?? 1;
              const unitPrice = new D(r.freight ?? '0').div(quantity);
              if (r.basis !== 'UNIT') throw new AppException(422, 'UNIT_DISCOUNT_NOT_APPLICABLE', "Le rabais par unité ne s'applique qu'à un colis facturé à l'unité (baril)", { trackingNumber: pkg.trackingNumber });
              if (new D(String(perUnit)).gt(unitPrice)) throw new AppException(422, 'UNIT_DISCOUNT_TOO_HIGH', 'Le rabais dépasse le prix unitaire', { trackingNumber: pkg.trackingNumber });
              const { maxDiscountPercent } = await this.ledger.settings(tx);
              if (new D(String(perUnit)).div(unitPrice).mul(100).gt(maxDiscountPercent)) throw new AppException(422, 'DISCOUNT_ABOVE_CAP', `La remise dépasse le plafond de l'entreprise (${maxDiscountPercent} %)`, { max: maxDiscountPercent });
              lines.push({ kind: 'DISCOUNT', description: `Rabais ${money(perUnit).toFixed(2)} × ${quantity} — ${display}`.slice(0, 200), amount: money(perUnit).mul(quantity).neg(), packageId: pkg.id });
            }
          } else if (extraFreight.length === 0) {
            throw new AppException(409, 'PACKAGE_NOT_PRICED', "Aucun tarif n'a été calculé pour ce colis : saisissez son fret", { trackingNumber: pkg.trackingNumber });
          }
        }
        // Frais CONATEL saisis sur les colis : lignes CUSTOMS (reversées), en dollars comme la table
        const customsLines = await tx.packageCustomsLine.findMany({ where: { packageId: { in: input.packageIds } }, include: { item: true }, orderBy: { createdAt: 'asc' } });
        for (const cl of customsLines) {
          const pkg = packages.find((p) => p.id === cl.packageId);
          currencies.add(cl.currency);
          const label = `CONATEL — ${cl.item.name}${cl.item.size ? ` ${cl.item.size}` : ''}${cl.quantity > 1 ? ` × ${cl.quantity}` : ''} — ${formatTrackingNumber(pkg?.trackingNumber ?? '')}`;
          lines.push({ kind: 'CUSTOMS', description: label.slice(0, 200), amount: cl.fee, packageId: cl.packageId });
        }
        for (const extra of input.extraLines) {
          if (extra.packageId && !input.packageIds.includes(extra.packageId)) throw AppException.badRequest('EXTRA_LINE_PACKAGE_UNKNOWN', "Une ligne désigne un colis qui n'est pas sur la facture");
          lines.push({ kind: extra.kind, description: extra.description, amount: money(extra.amount), packageId: extra.packageId ?? null });
        }
        if (currencies.size > 1) throw new AppException(409, 'CURRENCY_MISMATCH', 'Les colis ont des devises différentes : une facture par devise', { currencies: [...currencies] });
        const currency = [...currencies][0] ?? company.defaultCurrency;

        const sum = (kinds: (l: { kind: string }) => boolean) => lines.filter(kinds).reduce((acc, l) => acc.add(l.amount), new D(0));
        const subtotal = sum((l) => l.kind !== 'TAX' && l.kind !== 'DISCOUNT');
        const taxTotal = sum((l) => l.kind === 'TAX');
        const lineDiscounts = sum((l) => l.kind === 'DISCOUNT').neg();
        // Les frais CONATEL sont reversés à l'organisme : aucune remise en pourcentage ne les touche
        const percentBase = subtotal.sub(sum((l) => l.kind === 'CUSTOMS'));
        const percentDiscount = money(percentBase.mul(percent).div(100));
        if (percentDiscount.gt(0)) lines.push({ kind: 'DISCOUNT', description: `Remise ${percent} %`, amount: percentDiscount.neg(), packageId: null });
        const discount = percentDiscount.add(lineDiscounts);
        const total = subtotal.sub(discount).add(taxTotal);

        const invoice = await tx.invoice.create({
          data: {
            companyId: auth.companyId,
            customerId: input.customerId,
            currency,
            subtotal,
            discountTotal: discount,
            taxTotal,
            total,
            discountPercent: percent > 0 ? new D(String(percent)) : null,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            notes: input.notes,
            createdBy: auth.userId,
          },
        });
        await tx.invoiceLine.createMany({ data: lines.map((l, i) => ({ companyId: auth.companyId, invoiceId: invoice.id, kind: l.kind, description: l.description, quantity: new D(1), unitPrice: l.amount, amount: l.amount, packageId: l.packageId, position: i + 1 })) });
        if (packages.length > 0) await tx.invoicePackage.createMany({ data: packages.map((p) => ({ companyId: auth.companyId, invoiceId: invoice.id, packageId: p.id })) });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'invoice.drafted', entityType: 'invoice', entityId: invoice.id, after: { customerId: input.customerId, total: total.toFixed(2), currency, ...(overrideAudit.length > 0 ? { priceOverrides: overrideAudit } : {}) } });
        return this.read(tx, invoice.id);
      });
    } catch (error) {
      // Deux brouillons simultanés sur le même colis : la contrainte unique départage
      if (isUniqueViolation(error)) throw AppException.conflict('ALREADY_INVOICED', 'Un des colis vient d’être ajouté à une autre facture');
      throw error;
    }
  }

  private async read(tx: Tx, id: string) {
    const inv = (await tx.invoice.findUnique({ where: { id }, include: full })) as InvoiceFull | null;
    if (!inv) throw AppException.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
    return invoiceDto(inv, await this.ledger.pendingTotal(tx, id));
  }

  // ---------------------------------------------------------------------------------------------
  // Émission, annulation, avoirs
  // ---------------------------------------------------------------------------------------------

  async issue(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const invoice = await this.ledger.lockInvoice(tx, id);
      if (invoice.status !== 'DRAFT') throw AppException.conflict('INVOICE_NOT_DRAFT', 'Seul un brouillon peut être émis');
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { paymentPolicy: true } });
      const links = await tx.invoicePackage.findMany({ where: { invoiceId: id }, include: { package: true } });
      for (const link of links) {
        if (!BILLABLE.includes(link.package.status)) {
          throw new AppException(409, 'PACKAGE_NOT_BILLABLE', "Un colis de ce brouillon n'est plus facturable", { trackingNumber: link.package.trackingNumber, status: link.package.status });
        }
      }

      const now = new Date();
      const year = now.getUTCFullYear();
      const number = invoiceNumber(year, await this.counters.next(tx, auth.companyId, 'invoice', year));
      const zero = new D(invoice.total).eq(0);
      await tx.invoice.update({ where: { id }, data: { number, status: zero ? 'PAID' : 'ISSUED', issuedAt: now, version: { increment: 1 } } });

      // Effet sur les colis selon la politique de paiement de l'entreprise
      for (const link of links) {
        const status = link.package.status;
        if ((company.paymentPolicy === 'PAY_BEFORE_SHIPMENT' || company.paymentPolicy === 'PAY_BEFORE_BOTH') && !zero) {
          if (status === 'REGISTERED_WEIGHED') await this.packages.transition(tx, auth.companyId, link.packageId, 'AWAITING_PAYMENT', { actor: { userId: auth.userId, bypassPermission: true } });
        } else if (status === 'REGISTERED_WEIGHED' || status === 'AWAITING_PAYMENT') {
          await this.packages.transition(tx, auth.companyId, link.packageId, 'READY_TO_SHIP', {
            reason: zero ? `Facture ${number} sans montant à payer` : `Politique de l'entreprise : paiement à la remise (facture ${number})`,
            actor: { userId: auth.userId, bypassPermission: true },
          });
        }
      }
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: invoice.customerId }, include: { user: true } });
      await this.outbox.emit(tx, {
        companyId: auth.companyId,
        eventCode: 'payment.required',
        aggregateType: 'invoice',
        aggregateId: id,
        customerId: invoice.customerId,
        payload: { customerName: displayName(customer), invoiceNumber: number, amount: new D(invoice.total).toFixed(2), currency: invoice.currency },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'invoice.issued', entityType: 'invoice', entityId: id, after: { number, total: new D(invoice.total).toFixed(2) } });
      return this.read(tx, id);
    });
  }

  async deleteDraft(auth: AuthContext, id: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const invoice = await this.ledger.lockInvoice(tx, id);
      if (invoice.status !== 'DRAFT') throw AppException.conflict('INVOICE_NOT_DRAFT', 'Seul un brouillon se supprime : annulez ou créditez une facture émise');
      await tx.invoicePackage.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'invoice.draft_deleted', entityType: 'invoice', entityId: id });
    });
  }

  /** Annule une facture émise SANS encaissement : ses colis redeviennent facturables. */
  async void(auth: AuthContext, id: string, reason: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const invoice = await this.ledger.lockInvoice(tx, id);
      if (invoice.status === 'DRAFT') throw AppException.conflict('INVOICE_IS_DRAFT', 'Un brouillon se supprime, il ne s’annule pas');
      if (invoice.status === 'VOID') throw AppException.conflict('INVOICE_VOID', 'Cette facture est déjà annulée');
      const open = await tx.payment.count({ where: { invoiceId: id, status: { in: ['PENDING', 'CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED'] } } });
      if (open > 0 || new D(invoice.paidTotal).gt(0) || new D(invoice.creditedTotal).gt(0)) {
        throw AppException.conflict('INVOICE_HAS_PAYMENTS', 'Des paiements ou des avoirs existent : rejetez les paiements en attente, remboursez puis émettez un avoir');
      }
      await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason, version: { increment: 1 } } });
      await tx.invoicePackage.deleteMany({ where: { invoiceId: id } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'invoice.voided', entityType: 'invoice', entityId: id, after: { number: invoice.number, reason } });
      return this.read(tx, id);
    });
  }

  /** Avoir : réduit le montant dû. Limité à ce qui n'est ni encaissé ni réservé (sinon : rembourser d'abord). */
  async creditNote(auth: AuthContext, id: string, input: { amount: number; reason: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const invoice = await this.ledger.lockInvoice(tx, id);
      if (!['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) throw AppException.conflict('INVOICE_NOT_CREDITABLE', 'Seule une facture émise peut recevoir un avoir');
      const amount = money(input.amount);
      const pending = await this.ledger.pendingTotal(tx, id);
      const available = new D(invoice.total).sub(invoice.creditedTotal).sub(invoice.paidTotal).sub(pending);
      if (amount.gt(available)) {
        throw new AppException(422, 'CREDIT_EXCEEDS_UNPAID', "L'avoir dépasse ce qui n'est ni encaissé ni en attente : remboursez d'abord", { available: available.toFixed(2) });
      }
      const year = new Date().getUTCFullYear();
      const number = creditNoteNumber(year, await this.counters.next(tx, auth.companyId, 'credit-note', year));
      await tx.creditNote.create({ data: { companyId: auth.companyId, number, invoiceId: id, amount, reason: input.reason, createdBy: auth.userId } });
      await tx.invoice.update({ where: { id }, data: { creditedTotal: new D(invoice.creditedTotal).add(amount) } });
      await this.ledger.settle(tx, auth.companyId, auth.userId, id);
      await this.audit.record(tx, { companyId: auth.companyId, action: 'invoice.credited', entityType: 'invoice', entityId: id, after: { number, amount: amount.toFixed(2) } });
      return this.read(tx, id);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------------------------

  async get(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, (tx) => this.read(tx, id));
  }

  async list(auth: AuthContext, query: { limit: number; cursor?: string; status?: InvoiceStatus; customerId?: string; q?: string }) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.invoice.findMany({
        where: {
          status: query.status,
          customerId: query.customerId,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
          ...(query.q ? { OR: [{ number: { contains: query.q.toUpperCase() } }, { customer: { customerCode: { contains: query.q.toUpperCase() } } }] } : {}),
        },
        include: full,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit) as InvoiceFull[];
    const zero = new D(0);
    return { items: items.map((i) => ({ ...invoiceDto(i, zero), lines: undefined, payments: undefined, credits: undefined, packages: undefined })), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  private async customerOf(tx: Tx, auth: AuthContext) {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    // Un membre « lecteur » voit les factures du compte de son propriétaire
    return (await memberAccount(tx, auth.userId)) ?? tx.customer.findUnique({ where: { userId: auth.userId } });
  }

  /** Factures du client connecté : jamais les brouillons ; la facture d'un autre est indistinguable d'une facture inexistante. */
  async listMine(auth: AuthContext, query: { limit: number; cursor?: string; status?: InvoiceStatus }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      if (!customer) return { items: [], nextCursor: null };
      const rows = (await tx.invoice.findMany({
        where: { customerId: customer.id, status: query.status ?? { not: 'DRAFT' }, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
        include: full,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      })) as InvoiceFull[];
      const items = rows.slice(0, query.limit);
      const zero = new D(0);
      return { items: items.map((i) => ({ ...invoiceDto(i, zero), lines: undefined, payments: undefined, credits: undefined, packages: undefined })), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
    });
  }

  async getMine(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const own = customer ? await tx.invoice.findFirst({ where: { id, customerId: customer.id, status: { not: 'DRAFT' } }, select: { id: true } }) : null;
      if (!own) throw AppException.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
      return this.read(tx, id);
    });
  }

  /** Données pour le PDF : la même vue que l'API, avec le nom de l'entreprise. */
  async pdfData(auth: AuthContext, id: string, mine: boolean) {
    const invoice = mine ? await this.getMine(auth, id) : await this.get(auth, id);
    if (!invoice.number) throw AppException.conflict('INVOICE_NOT_ISSUED', "Un brouillon n'a pas de PDF : émettez la facture");
    const { company, rate } = await this.db.run({ companyId: auth.companyId }, async (tx) => ({
      company: await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { name: true } }),
      rate: await readFxRate(tx, auth.companyId),
    }));
    return { company: company.name, invoice, htgPerUsd: rate };
  }
}
