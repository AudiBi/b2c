import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format');
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'currency_format');
const money = z.number().positive().max(100_000_000);

export const PETTY_CASH_CATEGORIES = ['TRANSPORT', 'FUEL', 'CLEANING', 'MEALS', 'SUPPLIES', 'REPAIRS', 'OTHER'] as const;

/** Écriture de petite caisse : une dépense (catégorie obligatoire) ou un approvisionnement. Une erreur se corrige par une écriture inverse. */
export const createPettyCashSchema = z
  .strictObject({
    entryDate: isoDate,
    kind: z.enum(['EXPENSE', 'FUNDING']),
    category: z.enum(PETTY_CASH_CATEGORIES).optional(),
    description: z.string().trim().min(1).max(200),
    counterparty: z.string().trim().max(120).optional(),
    receiptRef: z.string().trim().max(60).optional(),
    amount: money,
    currency,
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'EXPENSE' && !value.category) ctx.addIssue({ code: 'custom', path: ['category'], message: 'category_required' });
  });
export type CreatePettyCashInput = z.infer<typeof createPettyCashSchema>;

export const listPettyCashQuerySchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month_format').optional(),
  currency: currency.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Seuils d'alerte de solde bas par devise. */
export const pettyCashThresholdSchema = z.strictObject({ thresholds: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().min(0).max(100_000_000)) });
export type PettyCashThresholdInput = z.infer<typeof pettyCashThresholdSchema>;

/** Dépôt en banque des caisses clôturées (une seule devise par dépôt). */
export const createDepositSchema = z.strictObject({
  sessionIds: z.array(z.uuid()).min(1).max(50),
  depositDate: isoDate,
  bank: z.string().trim().min(1).max(80),
  /** Quatre derniers caractères du compte seulement. */
  accountLast4: z.string().trim().regex(/^[A-Za-z0-9]{4}$/, 'id_last4_format').optional(),
  slipRef: z.string().trim().min(1).max(60),
  depositedAmount: z.number().min(0).max(100_000_000),
  note: z.string().trim().max(300).optional(),
});
export type CreateDepositInput = z.infer<typeof createDepositSchema>;

export const listDepositsQuerySchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(50) });
