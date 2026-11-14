import { z } from 'zod';
import { countryCodeSchema, TRANSPORT_MODES } from './customer';
import { HOLD_REASON_CODES, PACKAGE_STATUSES } from '../package-status';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

/** Montant avec au plus 2 décimales (les calculs se font en décimal exact côté serveur). */
export const moneySchema = z
  .number()
  .positive()
  .max(10_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'money_decimals');

export const CURRENCIES = ['USD', 'HTG', 'EUR'] as const;
export const currencySchema = z.enum(CURRENCIES);

export const WEIGHT_UNITS = ['KG', 'LB'] as const;
export const DIMENSION_UNITS = ['CM', 'IN'] as const;

export const weightSchema = z.strictObject({
  value: z.number().positive().max(100_000).refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'weight_decimals'),
  unit: z.enum(WEIGHT_UNITS),
});
export type WeightInput = z.infer<typeof weightSchema>;

const dimension = z.number().positive().max(1_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'dimension_decimals');
export const dimensionsSchema = z.strictObject({
  length: dimension,
  width: dimension,
  height: dimension,
  unit: z.enum(DIMENSION_UNITS),
});
export type DimensionsInput = z.infer<typeof dimensionsSchema>;

const referenceSchema = z.string().trim().min(4).max(60).regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'reference_format');

// ---------------------------------------------------------------------------------------------
// Préalertes (déclaration d'un achat)
// ---------------------------------------------------------------------------------------------

export const createPrealertSchema = z.strictObject({
  storeName: text(120),
  orderNumber: referenceSchema.optional(),
  supplierTracking: referenceSchema.optional(),
  warehouseId: z.uuid(),
  transportMode: z.enum(TRANSPORT_MODES),
  purchaseAmount: moneySchema,
  purchaseCurrency: currencySchema.default('USD'),
  description: text(500),
  destinationCity: optionalText(80),
});
export type CreatePrealertInput = z.infer<typeof createPrealertSchema>;

// Pas de valeur par défaut ici : un PATCH qui ne cite pas la devise ne doit pas la remettre à USD.
export const updatePrealertSchema = z
  .strictObject({
    storeName: text(120).optional(),
    orderNumber: referenceSchema.optional(),
    supplierTracking: referenceSchema.optional(),
    transportMode: z.enum(TRANSPORT_MODES).optional(),
    purchaseAmount: moneySchema.optional(),
    purchaseCurrency: currencySchema.optional(),
    description: text(500).optional(),
    destinationCity: optionalText(80),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), 'no_changes');
export type UpdatePrealertInput = z.infer<typeof updatePrealertSchema>;

// ---------------------------------------------------------------------------------------------
// Opérations du personnel sur les colis
// ---------------------------------------------------------------------------------------------

export const customerCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}-\d{6,}$/, 'customer_code_format');

export const receivePackageSchema = z
  .strictObject({
    warehouseId: z.uuid(),
    /** Colis attendu choisi par l'agent (rapprochement manuel). */
    expectedPackageId: z.uuid().optional(),
    supplierTracking: referenceSchema.optional(),
    customerCode: customerCodeSchema.optional(),
    /** Obligatoire seulement pour un colis sans préalerte (le mode est alors inconnu). */
    transportMode: z.enum(TRANSPORT_MODES).optional(),
    senderName: optionalText(120),
    notes: optionalText(500),
  })
  .strict();
export type ReceivePackageInput = z.infer<typeof receivePackageSchema>;

export const registerPackageSchema = z.strictObject({
  weight: weightSchema,
  dimensions: dimensionsSchema,
  contentDescription: optionalText(500),
  categoryCode: optionalText(40),
  declaredValue: moneySchema.optional(),
  declaredCurrency: currencySchema.optional(),
  insured: z.boolean().default(false),
  /** Nombre de colis identiques (boîtes, barils) : sert aux tarifs au volume et à l'unité. */
  quantity: z.number().int().min(1).max(10000).default(1),
  /** Seulement si le mode n'est pas encore connu (colis reçu sans préalerte). */
  transportMode: z.enum(TRANSPORT_MODES).optional(),
});
export type RegisterPackageInput = z.infer<typeof registerPackageSchema>;

export const transitionSchema = z.strictObject({
  to: z.enum(PACKAGE_STATUSES),
  reason: optionalText(500),
  holdReasonCode: z.enum(HOLD_REASON_CODES).optional(),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const identifyPackageSchema = z.strictObject({
  customerCode: customerCodeSchema,
  /** Colis attendu du client auquel rattacher ce colis (le colis physique est fusionné dans le colis attendu). */
  mergeIntoPackageId: z.uuid().optional(),
  transportMode: z.enum(TRANSPORT_MODES).optional(),
});

export const groupPackagesSchema = z.strictObject({
  packageIds: z.array(z.uuid()).min(2).max(50),
});

export const addNoteSchema = z.strictObject({ note: text(500) });

export const listPackagesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(PACKAGE_STATUSES).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  customerId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  unidentified: z.enum(['true', 'false']).optional(),
});

export const listExpectedQuerySchema = z.strictObject({
  q: z.string().trim().min(2).max(80).optional(),
  customerCode: customerCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const legacyTrackingParamSchema = z.strictObject({
  slug: z.string().trim().min(2).max(40),
  code: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9-]+$/, 'legacy_code_format'),
});

export const trackingParamSchema = z.strictObject({ trackingNumber: z.string().trim().min(8).max(40) });

// ---------------------------------------------------------------------------------------------
// Fichiers joints
// ---------------------------------------------------------------------------------------------

export const FILE_OWNER_TYPES = ['PREALERT', 'PACKAGE'] as const;
export const FILE_KINDS = ['PHOTO', 'INVOICE', 'DOCUMENT'] as const;
export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const uploadFileQuerySchema = z.strictObject({
  ownerType: z.enum(FILE_OWNER_TYPES),
  ownerId: z.uuid(),
  kind: z.enum(FILE_KINDS),
  filename: z.string().trim().min(1).max(120),
});

/** Colis créé au comptoir : l'expéditeur est le client, le destinataire peut être une autre personne. */
export const createCounterPackageSchema = z.strictObject({
  warehouseId: z.uuid(),
  customerId: z.uuid(),
  transportMode: z.enum(TRANSPORT_MODES),
  recipientName: z.string().trim().min(1).max(120),
  recipientPhone: z.string().trim().max(30).optional(),
  recipientCity: z.string().trim().max(80).optional(),
  /** Pays de destination (défaut : Haïti) ; l'entrepôt d'origine peut être en Haïti pour un envoi vers l'étranger. */
  destinationCountry: countryCodeSchema.optional(),
  destinationAgencyId: z.uuid().optional(),
  contentDescription: optionalText(500),
  legacyTrackingNumber: z.string().trim().max(60).optional(),
  notes: optionalText(500),
});
export type CreateCounterPackageInput = z.infer<typeof createCounterPackageSchema>;
