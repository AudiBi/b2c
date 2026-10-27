import { z } from 'zod';
import { countryCodeSchema, TRANSPORT_MODES } from './customer';
import { currencySchema, dimensionsSchema, DIMENSION_UNITS, moneySchema, weightSchema, WEIGHT_UNITS } from './packages';

const text = (max: number) => z.string().trim().min(1).max(max);
const nonNegative = z.number().min(0).max(10_000_000);

export const ROUNDING_MODES = ['NONE', 'UP', 'NEAREST'] as const;
export const SURCHARGE_KINDS = ['SURCHARGE', 'TAX', 'INSURANCE'] as const;
export const SURCHARGE_METHODS = ['FLAT', 'PERCENT_OF_FREIGHT', 'PERCENT_OF_DECLARED_VALUE', 'PERCENT_OF_SUBTOTAL'] as const;

const localizedName = z.strictObject({ fr: text(120), ht: text(120), en: text(120) });

export const rateRuleSchema = z
  .strictObject({
    /** Absent : règle générale ; présent : règle propre à une catégorie de marchandise. */
    categoryCode: z.string().trim().min(1).max(40).optional(),
    weightFrom: nonNegative,
    /** Borne haute exclue ; absente : sans limite. */
    weightTo: nonNegative.optional(),
    pricePerUnit: nonNegative,
    flatFee: nonNegative.default(0),
    minCharge: nonNegative.default(0),
  })
  .superRefine((rule, ctx) => {
    if (rule.weightTo !== undefined && rule.weightTo <= rule.weightFrom) {
      ctx.addIssue({ code: 'custom', path: ['weightTo'], message: 'weight_range' });
    }
  });

export const surchargeSchema = z.strictObject({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/, 'code_format'),
  name: localizedName,
  kind: z.enum(SURCHARGE_KINDS),
  method: z.enum(SURCHARGE_METHODS),
  value: nonNegative,
  /** Service au choix du client (ex. assurance) ; sinon appliqué systématiquement. */
  optional: z.boolean().default(false),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format');

export const createRateCardSchema = z
  .strictObject({
    name: text(120),
    transportMode: z.enum(TRANSPORT_MODES),
    originCountry: countryCodeSchema,
    destinationCountry: countryCodeSchema,
    currency: currencySchema,
    weightUnit: z.enum(WEIGHT_UNITS),
    dimensionUnit: z.enum(DIMENSION_UNITS),
    /** Poids volumétrique = L × l × h (dans l'unité de dimension) / diviseur, exprimé dans l'unité de poids de la grille. */
    volumetricDivisor: z.number().positive().max(1_000_000),
    minBillableWeight: nonNegative.default(0),
    roundingMode: z.enum(ROUNDING_MODES).default('NONE'),
    roundingStep: z.number().positive().max(1000).default(1),
    validFrom: isoDate,
    validTo: isoDate.optional(),
    rules: z.array(rateRuleSchema).min(1).max(100),
    surcharges: z.array(surchargeSchema).max(30).default([]),
  })
  .superRefine((card, ctx) => {
    if (card.validTo && card.validTo <= card.validFrom) {
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'date_order' });
    }
    const codes = card.surcharges.map((s) => s.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', path: ['surcharges'], message: 'duplicate_codes' });
    }
  });
export type CreateRateCardInput = z.infer<typeof createRateCardSchema>;

export const categorySchema = z.strictObject({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, 'code_format'),
  name: localizedName,
  restricted: z.boolean().default(false),
});
// Pas de valeur par défaut ici : un PATCH qui ne cite pas « restricted » ne doit pas le remettre à faux.
export const updateCategorySchema = z
  .strictObject({ name: localizedName.optional(), restricted: z.boolean().optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'no_changes');

// ---------------------------------------------------------------------------------------------
// Devis / calculateur
// ---------------------------------------------------------------------------------------------

export const quoteInputSchema = z.strictObject({
  transportMode: z.enum(TRANSPORT_MODES),
  originCountry: countryCodeSchema,
  destinationCountry: countryCodeSchema,
  /** Informatifs : la tarification se fait par pays. */
  originCity: z.string().trim().max(80).optional(),
  destinationCity: z.string().trim().max(80).optional(),
  weight: weightSchema,
  dimensions: dimensionsSchema.optional(),
  categoryCode: z.string().trim().toUpperCase().max(40).optional(),
  declaredValue: moneySchema.optional(),
  /** Codes des services optionnels choisis (ex. INSURANCE). */
  optionalSurcharges: z.array(z.string().trim().toUpperCase().max(30)).max(10).default([]),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

export const rateCardParamSchema = z.strictObject({ id: z.uuid() });
export const listRateCardsQuerySchema = z.strictObject({
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional(),
  transportMode: z.enum(TRANSPORT_MODES).optional(),
});
