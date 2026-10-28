import { z } from 'zod';
import { CURRENCIES, moneySchema } from './packages';
import { isoDateSchema } from './customer';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'CREDITED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_LINE_KINDS = ['FREIGHT', 'STORAGE', 'HANDLING', 'INSURANCE', 'TAX', 'CUSTOMS', 'DISCOUNT', 'OTHER'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

/** Lignes que le personnel peut ajouter à la main (le fret calculé et la remise ont leurs propres chemins). */
export const MANUAL_LINE_KINDS = ['FREIGHT', 'STORAGE', 'HANDLING', 'INSURANCE', 'CUSTOMS', 'OTHER'] as const;

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD_ONLINE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED_PARTIAL', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Plafond de remise par défaut (en % du sous-total) ; l'entreprise peut le modifier. */
export const DEFAULT_MAX_DISCOUNT_PERCENT = 10;

/** Statuts d'un paiement qui comptent dans le solde d'une facture (réservé ou encaissé). */
export const OPEN_PAYMENT_STATUSES: readonly PaymentStatus[] = ['PENDING', 'CONFIRMED', 'REFUNDED_PARTIAL'];

export const invoiceNumber = (year: number, sequence: number) => `INV-${year}-${String(sequence).padStart(6, '0')}`;
export const creditNoteNumber = (year: number, sequence: number) => `CN-${year}-${String(sequence).padStart(6, '0')}`;
export const receiptNumber = (year: number, sequence: number) => `RCT-${year}-${String(sequence).padStart(6, '0')}`;

const paymentReference = z.string().trim().min(4).max(60).regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'reference_format');

// ---------------------------------------------------------------------------------------------
// Factures
// ---------------------------------------------------------------------------------------------

export const extraLineSchema = z.strictObject({
  kind: z.enum(MANUAL_LINE_KINDS),
  description: text(200),
  amount: moneySchema,
  /** Pour le fret d'un colis qui n'a pas de tarif calculé. */
  packageId: z.uuid().optional(),
});

export const createInvoiceSchema = z
  .strictObject({
    customerId: z.uuid(),
    packageIds: z.array(z.uuid()).max(50).default([]),
    extraLines: z.array(extraLineSchema).max(20).default([]),
    /** Remise en pourcentage du sous-total, soumise à la permission et au plafond de l'entreprise. */
    discountPercent: z.number().min(0).max(100).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'percent_decimals').optional(),
    dueDate: isoDateSchema.optional(),
    notes: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.packageIds.length === 0 && value.extraLines.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['packageIds'], message: 'invoice_empty' });
    }
    if (new Set(value.packageIds).size !== value.packageIds.length) {
      ctx.addIssue({ code: 'custom', path: ['packageIds'], message: 'duplicate_packages' });
    }
  });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const voidInvoiceSchema = z.strictObject({ reason: text(300) });
export const creditNoteSchema = z.strictObject({ amount: moneySchema, reason: text(300) });

export const listInvoicesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.uuid().optional(),
  q: z.string().trim().min(1).max(40).optional(),
});

// ---------------------------------------------------------------------------------------------
// Paiements
// ---------------------------------------------------------------------------------------------

export const recordCashPaymentSchema = z.strictObject({
  invoiceId: z.uuid(),
  amount: moneySchema,
  reference: paymentReference.optional(),
  /** Agence où l'argent est encaissé (droit vérifié pour cette agence) ; absent : caisse de l'entreprise. */
  agencyId: z.uuid().optional(),
});

export const declarePaymentSchema = z.strictObject({
  method: z.enum(['BANK_TRANSFER', 'MOBILE_MONEY']),
  amount: moneySchema,
  reference: paymentReference,
});

export const rejectPaymentSchema = z.strictObject({ reason: text(300) });
export const confirmPaymentSchema = z.strictObject({ note: optionalText(300) });
export const refundSchema = z.strictObject({ amount: moneySchema, reason: text(300) });

export const listPaymentsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  invoiceId: z.uuid().optional(),
});

export const openCashSessionSchema = z.strictObject({ agencyId: z.uuid().optional(), openingAmount: z.number().min(0).max(10_000_000).optional() });
export const closeCashSessionSchema = z.strictObject({ countedAmount: z.number().min(0).max(100_000_000) });

export const exportQuerySchema = z
  .strictObject({ from: isoDateSchema, to: isoDateSchema })
  .superRefine((value, ctx) => {
    if (value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'date_order' });
    const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
    if (days > 366) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_too_long' });
  });

// Pas de valeur par défaut : modifier un champ ne doit pas remettre l'autre à sa valeur initiale.
export const financeSettingsSchema = z
  .strictObject({
    maxDiscountPercent: z.number().min(0).max(100).optional(),
    paymentInstructions: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'no_changes');

export const webhookEventSchema = z.strictObject({
  eventId: z.string().trim().min(8).max(100),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  /** Référence du prestataire, telle que déclarée sur le paiement en attente. */
  providerRef: paymentReference,
  amount: moneySchema,
  currency: z.enum(CURRENCIES),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
