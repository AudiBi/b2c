import { Prisma } from '@prisma/client';
import { calculate, PricingError, type CardData, type RuleData } from '../src/pricing/calculator';

const D = (value: string | number) => new Prisma.Decimal(String(value));

const rule = (o: Partial<Omit<RuleData, 'pricePerUnit'>> & { pricePerUnit: number }): RuleData => ({
  categoryCode: o.categoryCode ?? null,
  weightFrom: D(0),
  weightTo: null,
  pricePerUnit: D(o.pricePerUnit),
  flatFee: D(0),
  minCharge: D(0),
  basis: o.basis,
  volumetricDivisor: o.volumetricDivisor ?? null,
});

/**
 * Grille reproduisant l'outil de gestion (annexe 8.3 de docs/COMPARAISON_PROTOTYPE.md) : livres et pouces, sans arrondi ni minimum.
 * Aérien : 5 $/lb, diviseur 166 (132 pour l'e-conteneur). Maritime : 18 $/pi³ ; baril : 220 $ l'unité.
 */
const air = (): CardData => ({
  id: 'air', name: 'Aérien', version: 1, currency: 'USD', weightUnit: 'LB', dimensionUnit: 'IN', volumetricDivisor: D(166),
  minBillableWeight: D(0), roundingMode: 'NONE', roundingStep: D(1),
  rules: [rule({ pricePerUnit: 5 }), rule({ categoryCode: 'E_CONTAINER', pricePerUnit: 5, volumetricDivisor: D(132) })],
  surcharges: [],
});
const sea = (): CardData => ({
  id: 'sea', name: 'Maritime', version: 1, currency: 'USD', weightUnit: 'LB', dimensionUnit: 'IN', volumetricDivisor: D(166),
  minBillableWeight: D(0), roundingMode: 'NONE', roundingStep: D(1),
  rules: [rule({ pricePerUnit: 18, basis: 'VOLUME' }), rule({ categoryCode: 'DRUM', pricePerUnit: 220, basis: 'UNIT' })],
  surcharges: [],
});
const lb = (value: number) => ({ value, unit: 'LB' as const });
const inches = (length: number, width: number, height: number) => ({ length, width, height, unit: 'IN' as const });

describe("Tarification métier : les 6 cas de l'annexe 8.3", () => {
  it('aérien, boîte volumineuse : 12 lb, 20×16×12 po → 115,67 $ (115,65 $ dans le prototype, écart d’arrondi toléré de 2 centimes)', () => {
    const r = calculate(air(), { weight: lb(12), dimensions: inches(20, 16, 12) });
    expect(r.total).toBe('115.67');
    expect(Math.abs(Number(r.total) - 115.65)).toBeLessThanOrEqual(0.02);
    expect(r.basis).toBe('WEIGHT');
  });

  it('aérien, petit colis dense : 30 lb → 150,00 $', () => {
    expect(calculate(air(), { weight: lb(30), dimensions: inches(12, 10, 8) }).total).toBe('150.00');
  });

  it('aérien, e-conteneur : diviseur 132 propre à la tranche → 145,46 $ (145,45 $ dans le prototype)', () => {
    const r = calculate(air(), { weight: lb(10), dimensions: inches(20, 16, 12), categoryCode: 'E_CONTAINER' });
    expect(r.total).toBe('145.46');
    expect(Math.abs(Number(r.total) - 145.45)).toBeLessThanOrEqual(0.02);
  });

  it('aérien, colis léger : 2,3 lb, 14×10×6 po → 25,30 $', () => {
    expect(calculate(air(), { weight: lb(2.3), dimensions: inches(14, 10, 6) }).total).toBe('25.30');
  });

  it('maritime au pied cube : 24×18×16 po = 4 pi³ × 18 $ = 72,00 $', () => {
    const r = calculate(sea(), { weight: lb(1), dimensions: inches(24, 18, 16) });
    expect(r.total).toBe('72.00');
    expect(r.basis).toBe('VOLUME');
    expect(r.billableUnit).toBe('FT3');
    expect(r.billableWeight).toBe('4.000');
  });

  it('maritime : la quantité multiplie le volume (10 boîtes de 18×18×18 po)', () => {
    const r = calculate(sea(), { weight: lb(1), dimensions: inches(18, 18, 18), quantity: 10 });
    expect(r.billableWeight).toBe('33.750');
    expect(r.total).toBe('607.50');
  });

  it('baril : 2 × (220 − 20) = 400,00 $ avec un rabais de 20 $ par baril, en ligne séparée', () => {
    const r = calculate(sea(), { weight: lb(1), categoryCode: 'DRUM', quantity: 2, unitDiscount: 20 });
    expect(r.total).toBe('400.00');
    expect(r.freight).toBe('440.00');
    expect(r.lines.find((l) => l.kind === 'DISCOUNT')?.amount).toBe('-40.00');
    expect(r.billableUnit).toBe('UNIT');
  });

  it('refuse un rabais supérieur au prix unitaire, ou sur un tarif qui n’est pas à l’unité', () => {
    expect(() => calculate(sea(), { weight: lb(1), categoryCode: 'DRUM', quantity: 1, unitDiscount: 300 })).toThrow(PricingError);
    expect(() => calculate(air(), { weight: lb(10), unitDiscount: 5 })).toThrow(PricingError);
  });

  it('refuse un tarif au volume sans dimensions', () => {
    expect(() => calculate(sea(), { weight: lb(1) })).toThrow(/dimensions/);
  });

  it('une catégorie sans tranche propre retombe sur la tranche générale', () => {
    const r = calculate(air(), { weight: lb(30), dimensions: inches(12, 10, 8), categoryCode: 'AUTRE' });
    expect(r.total).toBe('150.00');
  });
});
