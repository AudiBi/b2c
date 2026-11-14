import { z } from 'zod';
import { emailSchema, phoneSchema } from './auth';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month_format');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format');

export const createReferrerSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  /** Pourcentage du profit versé au référent (0 à 100). */
  rate: z.number().min(0).max(100),
});
export type CreateReferrerInput = z.infer<typeof createReferrerSchema>;

export const updateReferrerSchema = z
  .strictObject({
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    rate: z.number().min(0).max(100).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'no_changes');
export type UpdateReferrerInput = z.infer<typeof updateReferrerSchema>;

export const assignReferrerSchema = z.strictObject({ referrerId: z.uuid().nullable() });
export const statementQuerySchema = z.strictObject({ month: month.optional() });

export const payCommissionSchema = z.strictObject({ month, paidOn: isoDate, note: z.string().trim().max(200).optional() });
export type PayCommissionInput = z.infer<typeof payCommissionSchema>;

/** Indemnité payée au client et remboursement obtenu du transporteur pour un incident (réclamation). */
export const compensationSchema = z.strictObject({
  indemnity: z.number().min(0).max(100_000_000).default(0),
  reimbursement: z.number().min(0).max(100_000_000).default(0),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'currency_format'),
  paidOn: isoDate.optional(),
  note: z.string().trim().max(300).optional(),
});
export type CompensationInput = z.infer<typeof compensationSchema>;
