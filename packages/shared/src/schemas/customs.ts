import { z } from 'zod';

/** Frais CONATEL : fixes (prix normal ou VIP), en pourcentage de la valeur, par watt, ou à confirmer auprès de l'organisme. */
export const CUSTOMS_FEE_KINDS = ['FIXED', 'PERCENT_OF_VALUE', 'PER_WATT', 'TO_CONFIRM'] as const;
export type CustomsFeeKind = (typeof CUSTOMS_FEE_KINDS)[number];

const price = z.number().min(0).max(1_000_000);

export const customsItemSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    size: z.string().trim().max(60).default(''),
    kind: z.enum(CUSTOMS_FEE_KINDS),
    normalPrice: price.optional(),
    vipPrice: price.optional(),
    /** Pourcentage de la valeur (PERCENT_OF_VALUE) ou prix par watt (PER_WATT). */
    rate: z.number().positive().max(1000).optional(),
    requiresAuthorization: z.boolean().default(false),
  })
  .superRefine((item, ctx) => {
    if (item.kind === 'FIXED' && (item.normalPrice === undefined || item.vipPrice === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['normalPrice'], message: 'prices_required' });
    }
    if ((item.kind === 'PERCENT_OF_VALUE' || item.kind === 'PER_WATT') && item.rate === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: 'rate_required' });
    }
  });
export type CustomsItemInput = z.infer<typeof customsItemSchema>;

export const updateCustomsItemSchema = z
  .strictObject({
    normalPrice: price.optional(),
    vipPrice: price.optional(),
    rate: z.number().positive().max(1000).optional(),
    requiresAuthorization: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'no_changes');
export type UpdateCustomsItemInput = z.infer<typeof updateCustomsItemSchema>;

export const addCustomsLineSchema = z.strictObject({
  itemId: z.uuid(),
  quantity: z.number().int().min(1).max(1000).default(1),
  vip: z.boolean().default(false),
  /** Valeur de l'article (obligatoire pour un frais en pourcentage). */
  declaredValue: z.number().min(0).max(10_000_000).optional(),
  /** Puissance en watts (obligatoire pour un frais par watt). */
  watts: z.number().positive().max(100_000_000).optional(),
});
export type AddCustomsLineInput = z.infer<typeof addCustomsLineSchema>;

export class CustomsFeeError extends Error {
  constructor(
    readonly code: 'PRICE_TO_CONFIRM' | 'VALUE_REQUIRED' | 'WATTS_REQUIRED',
    message: string,
  ) {
    super(message);
  }
}

export interface CustomsItemData {
  kind: CustomsFeeKind;
  normalPrice: number | null;
  vipPrice: number | null;
  rate: number | null;
}

/** Frais pour une ligne : fixe (prix normal ou VIP × quantité), % de la valeur × quantité, ou watts × prix par watt × quantité. Arrondi au centime. */
export function customsFee(item: CustomsItemData, input: { quantity: number; vip: boolean; declaredValue?: number; watts?: number }): number {
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  switch (item.kind) {
    case 'FIXED':
      return round((input.vip ? (item.vipPrice ?? 0) : (item.normalPrice ?? 0)) * input.quantity);
    case 'PERCENT_OF_VALUE':
      if (!input.declaredValue) throw new CustomsFeeError('VALUE_REQUIRED', "La valeur de l'article est nécessaire");
      return round(input.declaredValue * ((item.rate ?? 0) / 100) * input.quantity);
    case 'PER_WATT':
      if (!input.watts) throw new CustomsFeeError('WATTS_REQUIRED', 'La puissance en watts est nécessaire');
      return round(input.watts * (item.rate ?? 0) * input.quantity);
    case 'TO_CONFIRM':
      throw new CustomsFeeError('PRICE_TO_CONFIRM', 'Prix à confirmer auprès de la CONATEL : fixez-le dans la table avant de facturer');
  }
}

/** Table de départ (reprise de l'outil de gestion) : à faire vérifier par l'administrateur, les prix sont fixés « jusqu'à nouvel ordre » par l'organisme. */
export const DEFAULT_CUSTOMS_ITEMS: readonly CustomsItemInput[] = [
  { name: 'IPHONE', size: '5 à 11', kind: 'FIXED', normalPrice: 25, vipPrice: 15, requiresAuthorization: false },
  { name: 'IPHONE', size: '12 à 17', kind: 'FIXED', normalPrice: 30, vipPrice: 25, requiresAuthorization: false },
  { name: 'SMART TV', size: '10" à 32"', kind: 'FIXED', normalPrice: 50, vipPrice: 40, requiresAuthorization: false },
  { name: 'SMART TV', size: '33" à 65"', kind: 'FIXED', normalPrice: 80, vipPrice: 50, requiresAuthorization: false },
  { name: 'SMART TV', size: '65" et plus', kind: 'FIXED', normalPrice: 250, vipPrice: 250, requiresAuthorization: false },
  { name: 'IPAD', size: '', kind: 'FIXED', normalPrice: 40, vipPrice: 40, requiresAuthorization: false },
  { name: 'TABLETTE', size: '', kind: 'FIXED', normalPrice: 30, vipPrice: 25, requiresAuthorization: false },
  { name: 'LAPTOP', size: 'Mini', kind: 'FIXED', normalPrice: 40, vipPrice: 30, requiresAuthorization: false },
  { name: 'LAPTOP', size: 'Grand', kind: 'FIXED', normalPrice: 70, vipPrice: 40, requiresAuthorization: false },
  { name: 'MAC BOOK', size: '', kind: 'FIXED', normalPrice: 80, vipPrice: 40, requiresAuthorization: false },
  { name: 'SMART WATCH', size: '', kind: 'TO_CONFIRM', requiresAuthorization: false },
  { name: 'ACCESS POINT', size: '', kind: 'FIXED', normalPrice: 10, vipPrice: 10, requiresAuthorization: false },
  { name: 'KIT STARLINK', size: '', kind: 'FIXED', normalPrice: 40, vipPrice: 30, requiresAuthorization: false },
  { name: 'KIT STARLINK PREMIUM', size: '', kind: 'FIXED', normalPrice: 150, vipPrice: 150, requiresAuthorization: false },
  { name: 'PRINTER WIFI', size: '', kind: 'FIXED', normalPrice: 70, vipPrice: 40, requiresAuthorization: false },
  { name: 'CAMÉRA', size: '', kind: 'FIXED', normalPrice: 30, vipPrice: 20, requiresAuthorization: false },
  { name: 'ROUTER', size: '', kind: 'FIXED', normalPrice: 40, vipPrice: 40, requiresAuthorization: false },
  { name: 'IMPRIMANTE THERMIQUE', size: '', kind: 'FIXED', normalPrice: 20, vipPrice: 20, requiresAuthorization: false },
  { name: 'DRONE', size: '', kind: 'PERCENT_OF_VALUE', rate: 20, requiresAuthorization: true },
  { name: 'TÉLÉPHONE SATELLITE', size: '', kind: 'PERCENT_OF_VALUE', rate: 20, requiresAuthorization: false },
  { name: 'ÉMETTEUR AM/FM/TV', size: '', kind: 'PER_WATT', rate: 2, requiresAuthorization: true },
];
