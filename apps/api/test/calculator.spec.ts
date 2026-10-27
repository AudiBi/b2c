import { Prisma } from '@prisma/client';
import { calculate, PricingError, roundWeight, toDimensionUnit, toWeightUnit, type CardData, type RuleData, type SurchargeData } from '../src/pricing/calculator';

const D = (value: string | number) => new Prisma.Decimal(String(value));

const rule = (o: Partial<Record<keyof RuleData, string | number | null>> & { categoryCode?: string | null }): RuleData => ({
  categoryCode: o.categoryCode ?? null,
  weightFrom: D(o.weightFrom ?? 0),
  weightTo: o.weightTo === undefined || o.weightTo === null ? null : D(o.weightTo),
  pricePerUnit: D(o.pricePerUnit ?? 0),
  flatFee: D(o.flatFee ?? 0),
  minCharge: D(o.minCharge ?? 0),
});

const surcharge = (o: Partial<Omit<SurchargeData, 'value'>> & { value: string | number }): SurchargeData => ({
  code: o.code ?? 'HANDLING',
  name: o.name ?? { fr: 'Manutention', ht: 'Manitansyon', en: 'Handling' },
  kind: o.kind ?? 'SURCHARGE',
  method: o.method ?? 'FLAT',
  value: D(o.value),
  optional: o.optional ?? false,
});

/** Grille de référence : kg / cm, diviseur 5000, minimum 0,5 kg, arrondi au demi-kilo supérieur. */
function card(overrides: Partial<CardData> = {}): CardData {
  return {
    id: 'card-1',
    name: 'Test',
    version: 1,
    currency: 'USD',
    weightUnit: 'KG',
    dimensionUnit: 'CM',
    volumetricDivisor: D(5000),
    minBillableWeight: D('0.5'),
    roundingMode: 'UP',
    roundingStep: D('0.5'),
    rules: [rule({ weightFrom: 0, weightTo: 5, pricePerUnit: 4, minCharge: 3 }), rule({ weightFrom: 5, pricePerUnit: '3.5' })],
    surcharges: [],
    ...overrides,
  };
}

const kg = (value: number) => ({ value, unit: 'KG' as const });

describe('Calculateur de frais (fonction pure)', () => {
  describe('conversions exactes', () => {
    it('1 lb = 0,45359237 kg et 1 in = 2,54 cm', () => {
      expect(toWeightUnit(D(1), 'LB', 'KG').toString()).toBe('0.45359237');
      expect(toDimensionUnit(D(1), 'IN', 'CM').toString()).toBe('2.54');
      expect(toWeightUnit(D(5), 'KG', 'KG').toString()).toBe('5');
    });

    it("l'aller-retour kg → lb → kg ne perd rien d'utile (à 1e-9 près)", () => {
      const back = toWeightUnit(toWeightUnit(D('12.345'), 'KG', 'LB'), 'LB', 'KG');
      expect(back.minus('12.345').abs().lt('1e-9')).toBe(true);
    });
  });

  describe("règle d'arrondi du poids", () => {
    it('NONE garde 3 décimales', () => {
      expect(roundWeight(D('2.3456'), 'NONE', D(1)).toString()).toBe('2.346');
    });
    it('UP monte au multiple du pas, sans bouger un multiple exact', () => {
      expect(roundWeight(D('2.01'), 'UP', D('0.5')).toString()).toBe('2.5');
      expect(roundWeight(D('2.5'), 'UP', D('0.5')).toString()).toBe('2.5');
      expect(roundWeight(D('2.0'), 'UP', D(1)).toString()).toBe('2');
      expect(roundWeight(D('2.001'), 'UP', D(1)).toString()).toBe('3');
    });
    it('NEAREST arrondit au multiple le plus proche, 0,5 vers le haut', () => {
      expect(roundWeight(D('2.2'), 'NEAREST', D('0.5')).toString()).toBe('2');
      expect(roundWeight(D('2.3'), 'NEAREST', D('0.5')).toString()).toBe('2.5');
      expect(roundWeight(D('2.25'), 'NEAREST', D('0.5')).toString()).toBe('2.5');
      expect(roundWeight(D('2.5'), 'NEAREST', D(1)).toString()).toBe('3');
    });
  });

  describe('poids facturable', () => {
    it('poids réel seul : arrondi vers le haut puis tarif de la tranche', () => {
      const r = calculate(card(), { weight: kg(2.3) });
      expect(r.actualWeight).toBe('2.300');
      expect(r.volumetricWeight).toBeNull();
      expect(r.roundedWeight).toBe('2.500');
      expect(r.billableWeight).toBe('2.500');
      expect(r.freight).toBe('10.00');
      expect(r.total).toBe('10.00');
    });

    it('le minimum facturable et le minimum de perception s’appliquent', () => {
      const r = calculate(card(), { weight: kg(0.1) });
      expect(r.billableWeight).toBe('0.500');
      // 4 × 0,5 = 2,00 < minimum de perception 3,00
      expect(r.freight).toBe('3.00');
    });

    it('le poids volumétrique l’emporte quand il est supérieur au poids réel', () => {
      // 40 × 30 × 20 = 24 000 cm³ / 5000 = 4,8 kg > 2 kg réels
      const r = calculate(card(), { weight: kg(2), dimensions: { length: 40, width: 30, height: 20, unit: 'CM' } });
      expect(r.volumetricWeight).toBe('4.800');
      expect(r.chargeableBeforeRounding).toBe('4.800');
      expect(r.billableWeight).toBe('5.000');
      // 5 kg tombe dans la deuxième tranche (borne basse incluse) : 3,5 × 5
      expect(r.freight).toBe('17.50');
      expect(r.appliedRule.weightFrom).toBe('5');
    });

    it('le poids réel l’emporte quand le colis est dense', () => {
      const r = calculate(card(), { weight: kg(8), dimensions: { length: 10, width: 10, height: 10, unit: 'CM' } });
      expect(r.volumetricWeight).toBe('0.200');
      expect(r.billableWeight).toBe('8.000');
      expect(r.freight).toBe('28.00');
    });

    it('livres : 10 lb = 4,536 kg réels, facturés 5 kg', () => {
      const r = calculate(card(), { weight: { value: 10, unit: 'LB' } });
      expect(r.actualWeight).toBe('4.536');
      expect(r.billableWeight).toBe('5.000');
      expect(r.freight).toBe('17.50');
    });

    it('pouces : 10 × 10 × 10 in = 3,277 kg volumétriques', () => {
      const r = calculate(card(), { weight: kg(1), dimensions: { length: 10, width: 10, height: 10, unit: 'IN' } });
      expect(r.volumetricWeight).toBe('3.277');
      expect(r.billableWeight).toBe('3.500');
      expect(r.freight).toBe('14.00');
    });

    it('grille en livres : le poids saisi en kg est converti dans l’unité de la grille', () => {
      const lbCard = card({ weightUnit: 'LB', rules: [rule({ weightFrom: 0, pricePerUnit: 2 })], roundingMode: 'NONE', minBillableWeight: D(0) });
      const r = calculate(lbCard, { weight: kg(1) });
      expect(r.weightUnit).toBe('LB');
      expect(r.actualWeight).toBe('2.205');
      expect(r.freight).toBe('4.41');
    });

    it('sans arrondi, le poids est utilisé tel quel', () => {
      const r = calculate(card({ roundingMode: 'NONE' }), { weight: kg(2.3) });
      expect(r.billableWeight).toBe('2.300');
      expect(r.freight).toBe('9.20');
    });
  });

  describe('tranches', () => {
    it('la borne haute est exclue, la borne basse incluse', () => {
      expect(calculate(card({ roundingMode: 'NONE' }), { weight: kg(4.999) }).appliedRule.weightTo).toBe('5');
      expect(calculate(card({ roundingMode: 'NONE' }), { weight: kg(5) }).appliedRule.weightFrom).toBe('5');
    });

    it('sans tranche pour le poids : erreur, jamais de prix par défaut', () => {
      const bounded = card({ rules: [rule({ weightFrom: 0, weightTo: 5, pricePerUnit: 4 })] });
      expect(() => calculate(bounded, { weight: kg(7) })).toThrow(PricingError);
      try {
        calculate(bounded, { weight: kg(7) });
      } catch (error) {
        expect((error as PricingError).code).toBe('NO_RULE_FOR_WEIGHT');
      }
    });

    it('frais fixes + prix unitaire, puis minimum de perception', () => {
      const flat = card({ roundingMode: 'NONE', rules: [rule({ weightFrom: 0, pricePerUnit: 1, flatFee: 2 })] });
      expect(calculate(flat, { weight: kg(3) }).freight).toBe('5.00');
    });

    it('une règle propre à la catégorie remplace la règle générale ; sans règle de catégorie, la générale s’applique', () => {
      const withCategory = card({
        rules: [rule({ weightFrom: 0, pricePerUnit: 4 }), rule({ categoryCode: 'ELEC', weightFrom: 0, pricePerUnit: 6 })],
      });
      expect(calculate(withCategory, { weight: kg(2.5), categoryCode: 'ELEC' }).freight).toBe('15.00');
      expect(calculate(withCategory, { weight: kg(2.5), categoryCode: 'elec' }).appliedRule.categoryCode).toBe('ELEC');
      expect(calculate(withCategory, { weight: kg(2.5), categoryCode: 'CLOTHES' }).freight).toBe('10.00');
      expect(calculate(withCategory, { weight: kg(2.5) }).freight).toBe('10.00');
    });
  });

  describe('suppléments, assurance et taxes', () => {
    const surcharged = () =>
      card({
        surcharges: [
          surcharge({ code: 'HANDLING', method: 'FLAT', value: '1.5' }),
          surcharge({ code: 'INSURANCE', kind: 'INSURANCE', method: 'PERCENT_OF_DECLARED_VALUE', value: 2, optional: true }),
        ],
      });

    it('un supplément obligatoire est toujours appliqué, un service optionnel seulement s’il est choisi', () => {
      const without = calculate(surcharged(), { weight: kg(2.3) });
      expect(without.lines.map((l) => l.code)).toEqual(['FREIGHT', 'HANDLING']);
      expect(without.total).toBe('11.50');

      const withInsurance = calculate(surcharged(), { weight: kg(2.3), declaredValue: 100, optionalSurcharges: ['insurance'] });
      expect(withInsurance.lines.map((l) => [l.code, l.amount])).toEqual([
        ['FREIGHT', '10.00'],
        ['HANDLING', '1.50'],
        ['INSURANCE', '2.00'],
      ]);
      expect(withInsurance.total).toBe('13.50');
    });

    it('l’assurance sans valeur déclarée est refusée', () => {
      expect(() => calculate(surcharged(), { weight: kg(2), optionalSurcharges: ['INSURANCE'] })).toThrow(/valeur déclarée/);
    });

    it('un service inconnu, ou obligatoire, ne peut pas être « choisi »', () => {
      for (const code of ['NOPE', 'HANDLING']) {
        try {
          calculate(surcharged(), { weight: kg(2), optionalSurcharges: [code] });
          throw new Error('aurait dû échouer');
        } catch (error) {
          expect((error as PricingError).code).toBe('UNKNOWN_SURCHARGE');
        }
      }
    });

    it('pourcentage du fret', () => {
      const c = card({ surcharges: [surcharge({ code: 'FUEL', method: 'PERCENT_OF_FREIGHT', value: 10 })] });
      const r = calculate(c, { weight: kg(2.3) });
      expect(r.lines.find((l) => l.code === 'FUEL')?.amount).toBe('1.00');
      expect(r.total).toBe('11.00');
    });

    it('la taxe s’applique au sous-total (fret + suppléments), après eux', () => {
      const c = card({
        surcharges: [surcharge({ code: 'HANDLING', value: '1.5' }), surcharge({ code: 'VAT', kind: 'TAX', method: 'PERCENT_OF_SUBTOTAL', value: 10 })],
      });
      const r = calculate(c, { weight: kg(2.3) });
      expect(r.subtotal).toBe('11.50');
      expect(r.lines.map((l) => l.code)).toEqual(['FREIGHT', 'HANDLING', 'VAT']);
      expect(r.lines[2].amount).toBe('1.15');
      expect(r.total).toBe('12.65');
    });

    it('le total est la somme exacte des lignes affichées', () => {
      const c = card({
        surcharges: [
          surcharge({ code: 'A', method: 'PERCENT_OF_FREIGHT', value: '3.333' }),
          surcharge({ code: 'B', method: 'PERCENT_OF_FREIGHT', value: '6.667' }),
          surcharge({ code: 'T', kind: 'TAX', method: 'PERCENT_OF_SUBTOTAL', value: '7.5' }),
        ],
      });
      for (const w of [0.7, 1.9, 3.1, 4.4, 9.9]) {
        const r = calculate(c, { weight: kg(w) });
        const sum = r.lines.reduce((acc, l) => acc.add(l.amount), D(0));
        expect(sum.toFixed(2)).toBe(r.total);
      }
    });
  });

  describe('arithmétique décimale', () => {
    it('arrondit à 2 décimales avec 0,5 vers le haut (1,005 → 1,01 ; en flottant, on obtiendrait 1,00)', () => {
      const c = card({ roundingMode: 'NONE', minBillableWeight: D(0), rules: [rule({ weightFrom: 0, pricePerUnit: '1.005' })] });
      expect(calculate(c, { weight: kg(1) }).freight).toBe('1.01');
    });

    it('0,1 × 3 = 0,30 exactement', () => {
      const c = card({ roundingMode: 'NONE', minBillableWeight: D(0), rules: [rule({ weightFrom: 0, pricePerUnit: '0.1' })] });
      expect(calculate(c, { weight: kg(3) }).freight).toBe('0.30');
    });

    it('est déterministe : mêmes entrées, même résultat', () => {
      const input = { weight: kg(3.7), dimensions: { length: 33, width: 21, height: 18, unit: 'CM' as const } };
      expect(calculate(card(), input)).toEqual(calculate(card(), input));
    });
  });
});
