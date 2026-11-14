import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateExpenseInput, UpdateExpenseInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { readFxRate } from '../finance/fx';
import type { AuthContext } from '../security/auth.types';
import { ReferrersService } from './referrers.service';

const D = Prisma.Decimal;
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);

export const expenseDto = (e: { id: string; spentOn: Date; category: string; agency: string | null; description: string; amount: Prisma.Decimal; currency: string }) => ({
  id: e.id,
  spentOn: e.spentOn.toISOString().slice(0, 10),
  category: e.category,
  agency: e.agency,
  description: e.description,
  amount: e.amount.toFixed(2),
  currency: e.currency,
});

/** Mois AAAA-MM (le plus ancien en premier), `month` inclus. */
export function lastMonths(month: string, count = 12): string[] {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

interface Row {
  month: string;
  mode: string | null;
  revenue: Prisma.Decimal | null;
  customs: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
}

/**
 * Dépenses et profit mensuel. Réservé à ceux qui ont `report:profit` / `cost:read` / `expense:*` : ni le site, ni l'espace client, ni la
 * réception n'y accèdent. Les formules reprennent celles de l'outil de gestion pour pouvoir comparer les chiffres :
 *   chiffre d'affaires = lignes de factures émises, hors frais CONATEL (reversés) et taxes ;
 *   marge = chiffre d'affaires − coût d'achat figé à la pesée ;
 *   profit net = marge − dépenses du mois.
 * Seules les factures dans la devise par défaut de l'entreprise sont comptées ; les dépenses en gourdes sont converties au taux courant
 * (indicatif, signalé), les autres devises sont listées à part et exclues.
 */
@Injectable()
export class ProfitService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly referrers: ReferrersService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Dépenses
  // ---------------------------------------------------------------------------------------------

  async listExpenses(auth: AuthContext, query: { month?: string; category?: string; limit: number }) {
    const range = query.month ? this.monthRange(query.month) : null;
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.expense.findMany({
        where: { ...(range ? { spentOn: { gte: range.from, lt: range.to } } : {}), ...(query.category ? { category: query.category } : {}) },
        orderBy: [{ spentOn: 'desc' }, { id: 'desc' }],
        take: query.limit,
      }),
    );
    return { items: rows.map(expenseDto) };
  }

  async createExpense(auth: AuthContext, input: CreateExpenseInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await tx.expense.create({
        data: {
          companyId: auth.companyId,
          spentOn: new Date(input.spentOn),
          category: input.category,
          agency: input.agency,
          description: input.description,
          amount: new D(String(input.amount)),
          currency: input.currency,
          createdBy: auth.userId,
        },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'expense.created', entityType: 'expense', entityId: row.id, after: { category: row.category, amount: row.amount.toFixed(2), currency: row.currency } });
      return expenseDto(row);
    });
  }

  async updateExpense(auth: AuthContext, id: string, input: UpdateExpenseInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const before = await tx.expense.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('EXPENSE_NOT_FOUND', 'Dépense introuvable');
      const row = await tx.expense.update({
        where: { id },
        data: {
          spentOn: input.spentOn ? new Date(input.spentOn) : undefined,
          category: input.category,
          agency: input.agency,
          description: input.description,
          amount: input.amount !== undefined ? new D(String(input.amount)) : undefined,
          currency: input.currency,
        },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'expense.updated', entityType: 'expense', entityId: id, before: { amount: before.amount.toFixed(2), currency: before.currency }, after: input });
      return expenseDto(row);
    });
  }

  async deleteExpense(auth: AuthContext, id: string) {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const before = await tx.expense.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('EXPENSE_NOT_FOUND', 'Dépense introuvable');
      await tx.expense.delete({ where: { id } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'expense.deleted', entityType: 'expense', entityId: id, before: { amount: before.amount.toFixed(2), currency: before.currency, category: before.category } });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Profit
  // ---------------------------------------------------------------------------------------------

  private monthRange(month: string) {
    const [y, m] = month.split('-').map(Number);
    return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
  }

  async profit(auth: AuthContext, query: { month?: string }) {
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    const months = lastMonths(month);
    const from = this.monthRange(months[0]).from;
    const to = this.monthRange(month).to;

    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { defaultCurrency: true } });
      const currency = company.defaultCurrency;
      const rows = await this.invoiceRows(tx, auth.companyId, currency, from, to);
      const expenses = await tx.expense.findMany({ where: { spentOn: { gte: from, lt: to } } });
      const fx = await readFxRate(tx, auth.companyId);

      const blank = () => ({ revenue: new D(0), cost: new D(0) });
      const byMonth = new Map(months.map((m) => [m, { revenue: new D(0), customs: new D(0), cost: new D(0), expenses: new D(0), commissions: new D(0), incidents: new D(0), air: blank(), sea: blank() }]));

      // Commissions des référents (profit du mois × pourcentage, jamais négatif)
      const rates = new Map((await tx.referrer.findMany({ select: { id: true, rate: true } })).map((r) => [r.id, r.rate]));
      for (const row of await this.referrers.profitByReferrerMonth(tx, auth.companyId, currency, from, to)) {
        const bucket = byMonth.get(row.month);
        const rate = rates.get(row.referrer_id);
        if (!bucket || !rate) continue;
        const profit = new D(row.revenue ?? 0).sub(new D(row.cost ?? 0));
        if (profit.gt(0)) bucket.commissions = bucket.commissions.add(profit.mul(rate).div(100));
      }
      // Incidents : indemnité payée au client moins remboursement du transporteur, au mois du paiement
      for (const c of await tx.claimCompensation.findMany({ where: { paidOn: { gte: from, lt: to }, currency } })) {
        const bucket = byMonth.get((c.paidOn as Date).toISOString().slice(0, 7));
        if (bucket) bucket.incidents = bucket.incidents.add(c.indemnity.sub(c.reimbursement));
      }
      for (const r of rows) {
        const bucket = byMonth.get(r.month);
        if (!bucket) continue;
        const revenue = new D(r.revenue ?? 0);
        const cost = new D(r.cost ?? 0);
        bucket.revenue = bucket.revenue.add(revenue);
        bucket.customs = bucket.customs.add(new D(r.customs ?? 0));
        bucket.cost = bucket.cost.add(cost);
        const mode = r.mode === 'SEA' ? bucket.sea : bucket.air;
        mode.revenue = mode.revenue.add(revenue);
        mode.cost = mode.cost.add(cost);
      }

      let converted = false;
      const exclude = new Map<string, { count: number; total: Prisma.Decimal }>();
      for (const e of expenses) {
        const bucket = byMonth.get(e.spentOn.toISOString().slice(0, 7));
        if (!bucket) continue;
        if (e.currency === currency) bucket.expenses = bucket.expenses.add(e.amount);
        else if (e.currency === 'HTG' && currency === 'USD' && fx) {
          bucket.expenses = bucket.expenses.add(e.amount.div(fx));
          converted = true;
        } else {
          const x = exclude.get(e.currency) ?? { count: 0, total: new D(0) };
          exclude.set(e.currency, { count: x.count + 1, total: x.total.add(e.amount) });
        }
      }

      const items = months.map((m) => {
        const b = byMonth.get(m)!;
        const margin = b.revenue.sub(b.cost);
        const expensesTotal = money(b.expenses);
        const commissions = money(b.commissions);
        const incidents = money(b.incidents);
        return {
          month: m,
          revenue: money(b.revenue).toFixed(2),
          customsPassThrough: money(b.customs).toFixed(2),
          cost: money(b.cost).toFixed(2),
          margin: money(margin).toFixed(2),
          expenses: expensesTotal.toFixed(2),
          commissions: commissions.toFixed(2),
          incidents: incidents.toFixed(2),
          net: money(margin.sub(expensesTotal).sub(commissions).sub(incidents)).toFixed(2),
          byMode: {
            AIR: { revenue: money(b.air.revenue).toFixed(2), cost: money(b.air.cost).toFixed(2), margin: money(b.air.revenue.sub(b.air.cost)).toFixed(2) },
            SEA: { revenue: money(b.sea.revenue).toFixed(2), cost: money(b.sea.cost).toFixed(2), margin: money(b.sea.revenue.sub(b.sea.cost)).toFixed(2) },
          },
        };
      });
      return {
        currency,
        month,
        current: items[items.length - 1],
        items,
        notes: {
          expensesConvertedFromHtg: converted,
          excludedExpenseCurrencies: [...exclude].map(([c, x]) => ({ currency: c, count: x.count, total: x.total.toFixed(2) })),
          method: 'Factures émises (hors frais CONATEL et taxes) − coût d’achat figé à la pesée − dépenses − commissions des référents − incidents (indemnités − remboursements) ; avoirs non déduits.',
        },
      };
    });
  }

  /** Une ligne par mois de facturation et par mode de transport : chiffre d'affaires, frais reversés, coût d'achat des colis facturés. */
  private invoiceRows(tx: Tx, companyId: string, currency: string, from: Date, to: Date): Promise<Row[]> {
    return tx.$queryRaw<Row[]>(Prisma.sql`
      WITH inv AS (
        SELECT id, to_char(issued_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month
        FROM invoices
        WHERE company_id = ${companyId}::uuid AND status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CREDITED')
          AND currency = ${currency} AND issued_at >= ${from} AND issued_at < ${to}
      ),
      lines AS (
        SELECT i.month, p.transport_mode::text AS mode,
               SUM(CASE WHEN l.kind NOT IN ('CUSTOMS', 'TAX') THEN l.amount ELSE 0 END) AS revenue,
               SUM(CASE WHEN l.kind = 'CUSTOMS' THEN l.amount ELSE 0 END) AS customs
        FROM invoice_lines l JOIN inv i ON i.id = l.invoice_id
        LEFT JOIN packages p ON p.id = l.package_id
        WHERE l.company_id = ${companyId}::uuid
        GROUP BY i.month, p.transport_mode
      ),
      costs AS (
        SELECT d.month, d.mode, SUM(d.cost) AS cost FROM (
          SELECT DISTINCT i.month, l.package_id, p.transport_mode::text AS mode, p.cost_amount AS cost
          FROM invoice_lines l JOIN inv i ON i.id = l.invoice_id JOIN packages p ON p.id = l.package_id
          WHERE l.company_id = ${companyId}::uuid AND l.package_id IS NOT NULL AND p.cost_currency = ${currency}
        ) d GROUP BY d.month, d.mode
      )
      SELECT COALESCE(lines.month, costs.month) AS month, COALESCE(lines.mode, costs.mode) AS mode, lines.revenue, lines.customs, costs.cost
      FROM lines FULL JOIN costs ON lines.month = costs.month AND lines.mode IS NOT DISTINCT FROM costs.mode
    `);
  }
}
