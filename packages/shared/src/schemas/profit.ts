import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month_format');

export const EXPENSE_CATEGORIES = ['RENT', 'ELECTRICITY', 'TRANSPORT', 'FREIGHT_CUSTOMS', 'MARKETING', 'SALARIES', 'SUPPLIES', 'OTHER'] as const;

export const createExpenseSchema = z.strictObject({
  spentOn: isoDate,
  category: z.enum(EXPENSE_CATEGORIES),
  agency: z.string().trim().max(80).optional(),
  description: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(100_000_000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'currency_format'),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial().refine((v) => Object.keys(v).length > 0, 'no_changes');
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.strictObject({
  month: month.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const profitQuerySchema = z.strictObject({
  /** Mois de référence (AAAA-MM) ; le rapport couvre ce mois et les 11 précédents. */
  month: month.optional(),
});
export type ProfitQuery = z.infer<typeof profitQuerySchema>;
