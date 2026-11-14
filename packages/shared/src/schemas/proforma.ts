import { z } from 'zod';
import { quoteInputSchema } from './pricing';

export const createProformaSchema = z.strictObject({
  customerId: z.uuid(),
  /** Durée de validité en jours (30 par défaut). */
  validDays: z.number().int().min(1).max(180).default(30),
  note: z.string().trim().max(300).optional(),
  quote: quoteInputSchema,
});
export type CreateProformaInput = z.infer<typeof createProformaSchema>;

/** Transformation d'une proforma en colis de comptoir : mêmes champs que la création au comptoir, hors client et mode (repris de la proforma). */
export const convertProformaSchema = z.strictObject({
  warehouseId: z.uuid(),
  recipientName: z.string().trim().min(1).max(120),
  recipientPhone: z.string().trim().max(30).optional(),
  recipientCity: z.string().trim().max(80).optional(),
  destinationAgencyId: z.uuid().optional(),
  contentDescription: z.string().trim().max(500).optional(),
});
export type ConvertProformaInput = z.infer<typeof convertProformaSchema>;

export const listProformasQuerySchema = z.strictObject({
  customerId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
