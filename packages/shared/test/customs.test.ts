import { DEFAULT_CUSTOMS_ITEMS, customsFee, customsItemSchema, CustomsFeeError } from '../src';

describe('frais CONATEL', () => {
  const fixed = { kind: 'FIXED' as const, normalPrice: 25, vipPrice: 15, rate: null };

  it('fixe : prix normal ou VIP, multiplié par la quantité', () => {
    expect(customsFee(fixed, { quantity: 1, vip: false })).toBe(25);
    expect(customsFee(fixed, { quantity: 2, vip: true })).toBe(30);
  });

  it('pourcentage de la valeur (20 %) et par watt (2 $)', () => {
    expect(customsFee({ kind: 'PERCENT_OF_VALUE', normalPrice: null, vipPrice: null, rate: 20 }, { quantity: 1, vip: false, declaredValue: 500 })).toBe(100);
    expect(customsFee({ kind: 'PER_WATT', normalPrice: null, vipPrice: null, rate: 2 }, { quantity: 2, vip: false, watts: 150 })).toBe(600);
  });

  it('refuse sans valeur, sans watts, ou quand le prix est à confirmer', () => {
    expect(() => customsFee({ kind: 'PERCENT_OF_VALUE', normalPrice: null, vipPrice: null, rate: 20 }, { quantity: 1, vip: false })).toThrow(CustomsFeeError);
    expect(() => customsFee({ kind: 'PER_WATT', normalPrice: null, vipPrice: null, rate: 2 }, { quantity: 1, vip: false })).toThrow(CustomsFeeError);
    expect(() => customsFee({ kind: 'TO_CONFIRM', normalPrice: null, vipPrice: null, rate: null }, { quantity: 1, vip: false })).toThrow(/confirmer/);
  });

  it('la table de départ compte 21 articles, tous valides', () => {
    expect(DEFAULT_CUSTOMS_ITEMS).toHaveLength(21);
    for (const item of DEFAULT_CUSTOMS_ITEMS) expect(customsItemSchema.safeParse(item).success).toBe(true);
  });
});
