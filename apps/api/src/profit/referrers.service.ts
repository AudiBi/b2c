import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CompensationInput, CreateReferrerInput, PayCommissionInput, UpdateReferrerInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';

const D = Prisma.Decimal;
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);

const referrerDto = (r: { id: string; name: string; phone: string | null; email: string | null; rate: Prisma.Decimal; active: boolean }) => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  rate: r.rate.toFixed(2),
  active: r.active,
});

interface ProfitRow {
  referrer_id: string;
  month: string;
  packages: bigint | number;
  revenue: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
}

/** Début (inclus) et fin (exclue) d'un mois AAAA-MM. */
export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

/**
 * Référents : une personne qui amène des clients touche un pourcentage du PROFIT (chiffre d'affaires hors frais CONATEL et taxes, moins le coût
 * d'achat figé) des colis facturés ce mois-là à ses clients, jamais moins de zéro. Le relevé et le paiement sont réservés à `referrer:*`.
 */
@Injectable()
export class ReferrersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const rows = await tx.referrer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { customers: true } } } });
      return { items: rows.map((r) => ({ ...referrerDto(r), customers: r._count.customers })) };
    });
  }

  async create(auth: AuthContext, input: CreateReferrerInput) {
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const row = await tx.referrer.create({ data: { companyId: auth.companyId, name: input.name, phone: input.phone, email: input.email, rate: new D(String(input.rate)) } });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'referrer.created', entityType: 'referrer', entityId: row.id, after: { name: row.name, rate: row.rate.toFixed(2) } });
        return referrerDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('REFERRER_EXISTS', 'Un référent porte déjà ce nom');
      throw error;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateReferrerInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const before = await tx.referrer.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('REFERRER_NOT_FOUND', 'Référent introuvable');
      const row = await tx.referrer.update({ where: { id }, data: { phone: input.phone, email: input.email, active: input.active, rate: input.rate !== undefined ? new D(String(input.rate)) : undefined } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'referrer.updated', entityType: 'referrer', entityId: id, before: { rate: before.rate.toFixed(2), active: before.active }, after: input });
      return referrerDto(row);
    });
  }

  async assign(auth: AuthContext, customerId: string, referrerId: string | null) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      if (!(await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
      if (referrerId === null) {
        await tx.customerReferrer.deleteMany({ where: { customerId } });
      } else {
        const referrer = await tx.referrer.findUnique({ where: { id: referrerId } });
        if (!referrer || !referrer.active) throw AppException.notFound('REFERRER_NOT_FOUND', 'Référent introuvable ou inactif');
        await tx.customerReferrer.upsert({
          where: { customerId },
          update: { referrerId },
          create: { companyId: auth.companyId, customerId, referrerId },
        });
      }
      await this.audit.record(tx, { companyId: auth.companyId, action: 'referrer.assigned', entityType: 'customer', entityId: customerId, after: { referrerId } });
      return { customerId, referrerId };
    });
  }

  /** Profit par référent et par mois, sur les factures émises dans la plage (devise par défaut de l'entreprise). */
  async profitByReferrerMonth(tx: Tx, companyId: string, currency: string, from: Date, to: Date): Promise<ProfitRow[]> {
    return tx.$queryRaw<ProfitRow[]>(Prisma.sql`
      WITH inv AS (
        SELECT i.id, i.customer_id, cr.referrer_id, to_char(i.issued_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month
        FROM invoices i JOIN customer_referrers cr ON cr.customer_id = i.customer_id AND cr.company_id = i.company_id
        WHERE i.company_id = ${companyId}::uuid AND i.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CREDITED')
          AND i.currency = ${currency} AND i.issued_at >= ${from} AND i.issued_at < ${to}
      ),
      rev AS (
        SELECT inv.referrer_id, inv.month, SUM(CASE WHEN l.kind NOT IN ('CUSTOMS', 'TAX') THEN l.amount ELSE 0 END) AS revenue
        FROM invoice_lines l JOIN inv ON inv.id = l.invoice_id WHERE l.company_id = ${companyId}::uuid GROUP BY inv.referrer_id, inv.month
      ),
      cst AS (
        SELECT d.referrer_id, d.month, COUNT(*) AS packages, SUM(d.cost) AS cost FROM (
          SELECT DISTINCT inv.referrer_id, inv.month, l.package_id, p.cost_amount AS cost
          FROM invoice_lines l JOIN inv ON inv.id = l.invoice_id JOIN packages p ON p.id = l.package_id
          WHERE l.company_id = ${companyId}::uuid AND l.package_id IS NOT NULL AND (p.cost_currency = ${currency} OR p.cost_currency IS NULL)
        ) d GROUP BY d.referrer_id, d.month
      )
      SELECT COALESCE(rev.referrer_id, cst.referrer_id)::text AS referrer_id, COALESCE(rev.month, cst.month) AS month,
             COALESCE(cst.packages, 0) AS packages, rev.revenue, cst.cost
      FROM rev FULL JOIN cst ON rev.referrer_id = cst.referrer_id AND rev.month = cst.month
    `);
  }

  async statement(auth: AuthContext, id: string, month: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const referrer = await tx.referrer.findUnique({ where: { id }, include: { customers: true, payouts: { where: { month } } } });
      if (!referrer) throw AppException.notFound('REFERRER_NOT_FOUND', 'Référent introuvable');
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { defaultCurrency: true } });
      const { from, to } = monthBounds(month);
      const rows = (await this.profitByReferrerMonth(tx, auth.companyId, company.defaultCurrency, from, to)).filter((r) => r.referrer_id === id && r.month === month);
      const revenue = new D(rows[0]?.revenue ?? 0);
      const cost = new D(rows[0]?.cost ?? 0);
      const profit = revenue.sub(cost);
      const commission = money(D.max(0, profit).mul(referrer.rate).div(100));
      const payout = referrer.payouts[0] ?? null;
      return {
        referrer: referrerDto(referrer),
        month,
        currency: company.defaultCurrency,
        customers: referrer.customers.length,
        newCustomers: referrer.customers.filter((c) => c.since >= from && c.since < to).length,
        packages: Number(rows[0]?.packages ?? 0),
        revenue: money(revenue).toFixed(2),
        cost: money(cost).toFixed(2),
        profit: money(profit).toFixed(2),
        commission: commission.toFixed(2),
        payout: payout ? { amount: payout.amount.toFixed(2), paidOn: payout.paidOn.toISOString().slice(0, 10), note: payout.note } : null,
      };
    });
  }

  /** Paie la commission d'un mois : montant recalculé et figé, une seule fois par mois et par référent. */
  async pay(auth: AuthContext, id: string, input: PayCommissionInput) {
    const statement = await this.statement(auth, id, input.month);
    if (statement.payout) throw AppException.conflict('ALREADY_PAID', 'La commission de ce mois est déjà payée');
    if (Number(statement.commission) <= 0) throw AppException.unprocessable('NOTHING_TO_PAY', 'Aucune commission à payer ce mois-ci');
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await tx.referrerPayout.create({
        data: { companyId: auth.companyId, referrerId: id, month: input.month, amount: new D(statement.commission), currency: statement.currency, paidOn: new Date(input.paidOn), note: input.note, createdBy: auth.userId },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'referrer.commission_paid', entityType: 'referrer', entityId: id, after: { month: input.month, amount: row.amount.toFixed(2), currency: row.currency } });
      return { month: row.month, amount: row.amount.toFixed(2), currency: row.currency, paidOn: input.paidOn };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Indemnisation des incidents
  // ---------------------------------------------------------------------------------------------

  async getCompensation(auth: AuthContext, claimId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      if (!(await tx.claim.findUnique({ where: { id: claimId }, select: { id: true } }))) throw AppException.notFound('CLAIM_NOT_FOUND', 'Réclamation introuvable');
      const row = await tx.claimCompensation.findUnique({ where: { claimId } });
      return row ? this.compensationDto(row) : null;
    });
  }

  async setCompensation(auth: AuthContext, claimId: string, input: CompensationInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      if (!(await tx.claim.findUnique({ where: { id: claimId }, select: { id: true } }))) throw AppException.notFound('CLAIM_NOT_FOUND', 'Réclamation introuvable');
      const data = {
        indemnity: new D(String(input.indemnity)),
        reimbursement: new D(String(input.reimbursement)),
        currency: input.currency,
        paidOn: input.paidOn ? new Date(input.paidOn) : null,
        note: input.note ?? null,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      };
      const row = await tx.claimCompensation.upsert({ where: { claimId }, update: data, create: { companyId: auth.companyId, claimId, ...data } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'claim.compensation_set', entityType: 'claim', entityId: claimId, after: { indemnity: row.indemnity.toFixed(2), reimbursement: row.reimbursement.toFixed(2), currency: row.currency } });
      return this.compensationDto(row);
    });
  }

  private compensationDto(r: { indemnity: Prisma.Decimal; reimbursement: Prisma.Decimal; currency: string; paidOn: Date | null; note: string | null }) {
    return { indemnity: r.indemnity.toFixed(2), reimbursement: r.reimbursement.toFixed(2), net: r.indemnity.sub(r.reimbursement).toFixed(2), currency: r.currency, paidOn: r.paidOn ? r.paidOn.toISOString().slice(0, 10) : null, note: r.note };
  }
}
