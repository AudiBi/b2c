import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateDepositInput, CreatePettyCashInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import type { AuthContext } from '../security/auth.types';

const D = Prisma.Decimal;
const THRESHOLDS_KEY = 'petty_cash.low_thresholds';

const day = (d: Date) => d.toISOString().slice(0, 10);

const pettyDto = (e: { id: string; number: string; entryDate: Date; kind: string; category: string | null; description: string; counterparty: string | null; receiptRef: string | null; amount: Prisma.Decimal; currency: string }) => ({
  id: e.id,
  number: e.number,
  entryDate: day(e.entryDate),
  kind: e.kind,
  category: e.category,
  description: e.description,
  counterparty: e.counterparty,
  receiptRef: e.receiptRef,
  amount: e.amount.toFixed(2),
  currency: e.currency,
});

/** Petite caisse (écritures sans modification, solde par devise, alerte de solde bas) et dépôts bancaires des caisses clôturées. */
@Injectable()
export class CashbookService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Petite caisse
  // ---------------------------------------------------------------------------------------------

  async createPetty(auth: AuthContext, input: CreatePettyCashInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      // Une dépense ne peut pas dépasser le solde de sa devise
      if (input.kind === 'EXPENSE') {
        const balance = await this.balanceOf(tx, input.currency);
        if (balance.lt(new D(String(input.amount)))) {
          throw new AppException(422, 'PETTY_CASH_INSUFFICIENT', 'Le solde de la petite caisse est insuffisant : approvisionnez-la d’abord', { balance: balance.toFixed(2), currency: input.currency });
        }
      }
      const year = Number(input.entryDate.slice(0, 4));
      const sequence = await this.counters.next(tx, auth.companyId, 'petty-cash', year);
      const row = await tx.pettyCashEntry.create({
        data: {
          companyId: auth.companyId,
          number: `PC-${year}-${String(sequence).padStart(6, '0')}`,
          entryDate: new Date(input.entryDate),
          kind: input.kind,
          category: input.category,
          description: input.description,
          counterparty: input.counterparty,
          receiptRef: input.receiptRef,
          amount: new D(String(input.amount)),
          currency: input.currency,
          createdBy: auth.userId,
        },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'petty_cash.entry', entityType: 'petty_cash_entry', entityId: row.id, after: { kind: row.kind, amount: row.amount.toFixed(2), currency: row.currency } });
      return pettyDto(row);
    });
  }

  private async balanceOf(tx: Parameters<Parameters<DbService['run']>[1]>[0], currency: string): Promise<Prisma.Decimal> {
    const rows = await tx.pettyCashEntry.groupBy({ by: ['kind'], where: { currency }, _sum: { amount: true } });
    const sum = (kind: string) => new D(rows.find((r) => r.kind === kind)?._sum.amount ?? 0);
    return sum('FUNDING').sub(sum('EXPENSE'));
  }

  async listPetty(auth: AuthContext, query: { month?: string; currency?: string; limit: number }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const range = query.month ? { from: new Date(`${query.month}-01T00:00:00Z`), to: new Date(new Date(`${query.month}-01T00:00:00Z`).setUTCMonth(new Date(`${query.month}-01T00:00:00Z`).getUTCMonth() + 1)) } : null;
      const rows = await tx.pettyCashEntry.findMany({
        where: { ...(range ? { entryDate: { gte: range.from, lt: range.to } } : {}), ...(query.currency ? { currency: query.currency } : {}) },
        orderBy: [{ entryDate: 'desc' }, { number: 'desc' }],
        take: query.limit,
      });
      const currencies = await tx.pettyCashEntry.findMany({ distinct: ['currency'], select: { currency: true } });
      const setting = await tx.companySetting.findUnique({ where: { companyId_key: { companyId: auth.companyId, key: THRESHOLDS_KEY } } });
      const thresholds = (setting?.value as Record<string, number> | undefined) ?? {};
      const balances = [];
      for (const { currency } of currencies) {
        const balance = await this.balanceOf(tx, currency);
        const threshold = thresholds[currency] ?? null;
        balances.push({ currency, balance: balance.toFixed(2), threshold, low: threshold !== null && balance.lt(new D(String(threshold))) });
      }
      return { items: rows.map(pettyDto), balances };
    });
  }

  async setThresholds(auth: AuthContext, thresholds: Record<string, number>) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.companySetting.upsert({
        where: { companyId_key: { companyId: auth.companyId, key: THRESHOLDS_KEY } },
        update: { value: thresholds },
        create: { companyId: auth.companyId, key: THRESHOLDS_KEY, value: thresholds },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'petty_cash.thresholds', entityType: 'company_setting', after: thresholds });
      return { thresholds };
    });
  }

  /** Rapport du jour : entrées, sorties et solde de chaque devise. */
  async dailyReport(auth: AuthContext, date: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const rows = await tx.pettyCashEntry.findMany({ where: { entryDate: new Date(date) }, orderBy: { number: 'asc' } });
      const byCurrency = new Map<string, { funding: Prisma.Decimal; expense: Prisma.Decimal }>();
      for (const r of rows) {
        const x = byCurrency.get(r.currency) ?? { funding: new D(0), expense: new D(0) };
        if (r.kind === 'FUNDING') x.funding = x.funding.add(r.amount);
        else x.expense = x.expense.add(r.amount);
        byCurrency.set(r.currency, x);
      }
      const totals = [];
      for (const [currency, x] of byCurrency) totals.push({ currency, funding: x.funding.toFixed(2), expense: x.expense.toFixed(2), balance: (await this.balanceOf(tx, currency)).toFixed(2) });
      return { date, entries: rows.map(pettyDto), totals };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Dépôts bancaires
  // ---------------------------------------------------------------------------------------------

  /** Montant à déposer d'une caisse clôturée : ce qui a été compté, moins le fonds de caisse d'ouverture qui reste au tiroir. */
  private depositable(s: { countedAmount: Prisma.Decimal | null; openingAmount: Prisma.Decimal }): Prisma.Decimal {
    const value = new D(s.countedAmount ?? 0).sub(s.openingAmount);
    return value.lt(0) ? new D(0) : value;
  }

  /** Caisses clôturées pas encore déposées, par devise (« reste à déposer »). */
  async toDeposit(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const sessions = await tx.cashSession.findMany({ where: { closedAt: { not: null }, deposit: null }, orderBy: { openedAt: 'asc' } });
      const totals = new Map<string, Prisma.Decimal>();
      for (const s of sessions) totals.set(s.currency, (totals.get(s.currency) ?? new D(0)).add(this.depositable(s)));
      return {
        sessions: sessions.map((s) => ({ id: s.id, agencyId: s.agencyId, currency: s.currency, closedAt: s.closedAt, depositable: this.depositable(s).toFixed(2) })),
        totals: [...totals].map(([currency, amount]) => ({ currency, toDeposit: amount.toFixed(2) })),
      };
    });
  }

  async createDeposit(auth: AuthContext, input: CreateDepositInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const ids = [...new Set(input.sessionIds)];
      const sessions = await tx.cashSession.findMany({ where: { id: { in: ids } } });
      if (sessions.length !== ids.length) throw AppException.notFound('CASH_SESSION_NOT_FOUND', 'Une des caisses est introuvable');
      if (sessions.some((s) => !s.closedAt)) throw AppException.conflict('CASH_SESSION_OPEN', 'Une des caisses n’est pas clôturée : clôturez-la avant de déposer');
      if (await tx.bankDepositSession.findFirst({ where: { cashSessionId: { in: ids } }, select: { cashSessionId: true } })) throw AppException.conflict('ALREADY_DEPOSITED', 'Une des caisses a déjà été déposée');
      const currencies = new Set(sessions.map((s) => s.currency));
      if (currencies.size > 1) throw new AppException(409, 'CURRENCY_MISMATCH', 'Un dépôt ne mélange pas les devises', { currencies: [...currencies] });
      const currency = [...currencies][0];
      const expected = sessions.reduce((acc, s) => acc.add(this.depositable(s)), new D(0));
      const deposited = new D(String(input.depositedAmount));
      const year = Number(input.depositDate.slice(0, 4));
      const sequence = await this.counters.next(tx, auth.companyId, 'bank-deposit', year);
      const deposit = await tx.bankDeposit.create({
        data: {
          companyId: auth.companyId,
          number: `DEP-${year}-${String(sequence).padStart(6, '0')}`,
          depositDate: new Date(input.depositDate),
          bank: input.bank,
          accountLast4: input.accountLast4?.toUpperCase(),
          slipRef: input.slipRef,
          currency,
          expectedAmount: expected,
          depositedAmount: deposited,
          difference: deposited.sub(expected),
          note: input.note,
          createdBy: auth.userId,
        },
      });
      await tx.bankDepositSession.createMany({ data: ids.map((cashSessionId) => ({ companyId: auth.companyId, depositId: deposit.id, cashSessionId })) });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'bank_deposit.created',
        entityType: 'bank_deposit',
        entityId: deposit.id,
        after: { number: deposit.number, expected: expected.toFixed(2), deposited: deposited.toFixed(2), difference: deposited.sub(expected).toFixed(2), currency, sessions: ids.length },
      });
      return this.depositDto(deposit, ids);
    });
  }

  private depositDto(d: { id: string; number: string; depositDate: Date; bank: string; accountLast4: string | null; slipRef: string; currency: string; expectedAmount: Prisma.Decimal; depositedAmount: Prisma.Decimal; difference: Prisma.Decimal; note: string | null }, sessionIds: string[]) {
    return {
      id: d.id,
      number: d.number,
      depositDate: day(d.depositDate),
      bank: d.bank,
      accountLast4: d.accountLast4,
      slipRef: d.slipRef,
      currency: d.currency,
      expected: d.expectedAmount.toFixed(2),
      deposited: d.depositedAmount.toFixed(2),
      difference: d.difference.toFixed(2),
      note: d.note,
      sessionIds,
    };
  }

  async listDeposits(auth: AuthContext, limit: number) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const rows = await tx.bankDeposit.findMany({ orderBy: [{ depositDate: 'desc' }, { number: 'desc' }], take: limit, include: { sessions: { select: { cashSessionId: true } } } });
      return { items: rows.map((d) => this.depositDto(d, d.sessions.map((s) => s.cashSessionId))) };
    });
  }

  async getDeposit(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const d = await tx.bankDeposit.findUnique({ where: { id }, include: { sessions: { select: { cashSessionId: true } } } });
      if (!d) throw AppException.notFound('DEPOSIT_NOT_FOUND', 'Dépôt introuvable');
      return { deposit: this.depositDto(d, d.sessions.map((s) => s.cashSessionId)), company: (await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { name: true } })).name };
    });
  }
}
