import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** 1 lb = 0,453 592 37 kg et 1 in = 2,54 cm : définitions exactes. */
const KG_PER_LB = new D('0.45359237');
const CM_PER_IN = new D('2.54');

export type WeightUnit = 'KG' | 'LB';
export type DimensionUnit = 'CM' | 'IN';
export type RoundingMode = 'NONE' | 'UP' | 'NEAREST';
export type PricingBasis = 'WEIGHT' | 'VOLUME' | 'UNIT';
export type SurchargeKind = 'SURCHARGE' | 'TAX' | 'INSURANCE';
export type SurchargeMethod = 'FLAT' | 'PERCENT_OF_FREIGHT' | 'PERCENT_OF_DECLARED_VALUE' | 'PERCENT_OF_SUBTOTAL';

export interface RuleData {
  categoryCode: string | null;
  weightFrom: Decimal;
  weightTo: Decimal | null;
  pricePerUnit: Decimal;
  flatFee: Decimal;
  minCharge: Decimal;
  /** Absent : poids. VOLUME : pieds cubes ; UNIT : nombre d'unités. */
  basis?: PricingBasis;
  /** Diviseur volumétrique propre à la tranche (ex. e-conteneur) ; sinon celui de la grille. */
  volumetricDivisor?: Decimal | null;
}

export interface SurchargeData {
  code: string;
  name: Record<string, string>;
  kind: SurchargeKind;
  method: SurchargeMethod;
  value: Decimal;
  optional: boolean;
}

export interface CardData {
  id: string;
  name: string;
  version: number;
  currency: string;
  weightUnit: WeightUnit;
  dimensionUnit: DimensionUnit;
  volumetricDivisor: Decimal;
  minBillableWeight: Decimal;
  roundingMode: RoundingMode;
  roundingStep: Decimal;
  rules: RuleData[];
  surcharges: SurchargeData[];
}

export interface CalcInput {
  weight: { value: number | string; unit: WeightUnit };
  dimensions?: { length: number | string; width: number | string; height: number | string; unit: DimensionUnit };
  categoryCode?: string;
  /** Dans la devise de la grille. */
  declaredValue?: number | string;
  optionalSurcharges?: string[];
  /** Nombre de colis identiques (multiplie le volume ou le prix à l'unité). Défaut 1. */
  quantity?: number;
  /** Rabais par unité (barils), dans la devise de la grille : ligne négative, plafonnée au prix unitaire. */
  unitDiscount?: number | string;
}

export interface CalcLine {
  code: string;
  kind: 'FREIGHT' | 'DISCOUNT' | SurchargeKind;
  label: Record<string, string> | null;
  amount: string;
}

export interface CalcResult {
  currency: string;
  weightUnit: WeightUnit;
  basis: PricingBasis;
  quantity: number;
  /** Unité de la quantité facturable : KG ou LB (poids), FT3 (volume) ou UNIT. */
  billableUnit: WeightUnit | 'FT3' | 'UNIT';
  /** Poids réel converti dans l'unité de la grille. */
  actualWeight: string;
  /** Poids volumétrique, ou null si les dimensions ne sont pas fournies. */
  volumetricWeight: string | null;
  /** max(réel, volumétrique) avant arrondi et minimum. */
  chargeableBeforeRounding: string;
  roundedWeight: string;
  /** Poids facturable final = max(minimum, poids arrondi). */
  billableWeight: string;
  appliedRule: { weightFrom: string; weightTo: string | null; categoryCode: string | null };
  freight: string;
  lines: CalcLine[];
  subtotal: string;
  total: string;
}

export type PricingErrorCode = 'NO_RULE_FOR_WEIGHT' | 'MISSING_DECLARED_VALUE' | 'UNKNOWN_SURCHARGE' | 'MISSING_DIMENSIONS' | 'INVALID_DISCOUNT';

export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const toWeightUnit = (value: Decimal, from: WeightUnit, to: WeightUnit): Decimal =>
  from === to ? value : from === 'LB' ? value.mul(KG_PER_LB) : value.div(KG_PER_LB);

export const toDimensionUnit = (value: Decimal, from: DimensionUnit, to: DimensionUnit): Decimal =>
  from === to ? value : from === 'IN' ? value.mul(CM_PER_IN) : value.div(CM_PER_IN);

const money = (value: Decimal) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
const weight3 = (value: Decimal) => value.toDecimalPlaces(3, D.ROUND_HALF_UP);

/** Applique la règle d'arrondi de la grille : UP = vers le haut au multiple du pas, NEAREST = au multiple le plus proche (0,5 vers le haut). */
export function roundWeight(value: Decimal, mode: RoundingMode, step: Decimal): Decimal {
  if (mode === 'NONE') return weight3(value);
  const ratio = value.div(step);
  const multiples = mode === 'UP' ? ratio.ceil() : ratio.toDecimalPlaces(0, D.ROUND_HALF_UP);
  return weight3(multiples.mul(step));
}

/**
 * Calcule poids facturable et frais à partir d'une grille et de mesures. Fonction pure et déterministe,
 * en décimal exact (aucun flottant). Ordre des opérations :
 *   1. conversion dans les unités de la grille ;
 *   2. poids volumétrique = L × l × h / diviseur ;
 *   3. poids retenu = max(réel, volumétrique) ;
 *   4. arrondi selon la grille, puis minimum facturable ;
 *   5. tranche de la grille (règle de la catégorie si elle existe, sinon règle générale) :
 *      fret = max(frais fixes + prix unitaire × poids, minimum de perception) ;
 *   6. suppléments (fixe, % du fret, % de la valeur déclarée), sous-total, puis taxes (fixe, % du sous-total).
 * Chaque montant est arrondi à 2 décimales (0,5 vers le haut) : le total est la somme exacte des lignes.
 */
export function calculate(card: CardData, input: CalcInput): CalcResult {
  const actual = toWeightUnit(new D(String(input.weight.value)), input.weight.unit, card.weightUnit);

  const quantity = new D(String(input.quantity ?? 1));
  const convertDim = (v: number | string, to: DimensionUnit) => toDimensionUnit(new D(String(v)), input.dimensions!.unit, to);
  const category = input.categoryCode?.toUpperCase();
  const general = card.rules.filter((r) => r.categoryCode === null);
  const specific = category ? card.rules.filter((r) => r.categoryCode === category) : [];

  let volumetric: Decimal | null = null;
  let chargeable = actual;
  let rounded = actual;
  let billable = actual;
  let basis: PricingBasis = 'WEIGHT';
  let rule: RuleData | undefined;

  // Les tranches d'une catégorie sont essayées d'abord, puis les générales ; la base (poids, volume, unité) est celle du groupe
  for (const group of [specific, general]) {
    if (group.length === 0) continue;
    basis = group[0].basis ?? 'WEIGHT';
    if (basis === 'WEIGHT') {
      const divisor = group[0].volumetricDivisor ?? card.volumetricDivisor;
      volumetric = input.dimensions
        ? convertDim(input.dimensions.length, card.dimensionUnit).mul(convertDim(input.dimensions.width, card.dimensionUnit)).mul(convertDim(input.dimensions.height, card.dimensionUnit)).div(divisor)
        : null;
      chargeable = volumetric && volumetric.gt(actual) ? volumetric : actual;
      rounded = roundWeight(chargeable, card.roundingMode, card.roundingStep);
      billable = D.max(card.minBillableWeight, rounded);
    } else if (basis === 'VOLUME') {
      if (!input.dimensions) throw new PricingError('MISSING_DIMENSIONS', 'Les dimensions sont nécessaires pour un tarif au volume');
      // Pieds cubes : 1 pi³ = 1 728 po³
      const cubicInches = convertDim(input.dimensions.length, 'IN').mul(convertDim(input.dimensions.width, 'IN')).mul(convertDim(input.dimensions.height, 'IN'));
      volumetric = null;
      chargeable = cubicInches.div(1728).mul(quantity);
      rounded = weight3(chargeable);
      billable = rounded;
    } else {
      volumetric = null;
      chargeable = quantity;
      rounded = quantity;
      billable = quantity;
    }
    const covers = (r: RuleData) => billable.gte(r.weightFrom) && (r.weightTo === null || billable.lt(r.weightTo));
    rule = group.find(covers);
    if (rule) break;
  }
  if (!rule) {
    throw new PricingError('NO_RULE_FOR_WEIGHT', `Aucune tranche de la grille ne couvre ${billable.toString()} ${basis === 'WEIGHT' ? card.weightUnit : basis === 'VOLUME' ? 'pi³' : 'unité(s)'}`);
  }

  const freight = money(D.max(rule.flatFee.add(rule.pricePerUnit.mul(billable)), rule.minCharge));
  const lines: CalcLine[] = [{ code: 'FREIGHT', kind: 'FREIGHT', label: null, amount: freight.toFixed(2) }];
  let discount = new D(0);
  if (input.unitDiscount !== undefined && new D(String(input.unitDiscount)).gt(0)) {
    const perUnit = new D(String(input.unitDiscount));
    if (basis !== 'UNIT' || perUnit.gt(rule.pricePerUnit)) throw new PricingError('INVALID_DISCOUNT', "Le rabais par unité ne s'applique qu'à un tarif à l'unité et ne peut pas dépasser le prix unitaire");
    discount = money(perUnit.mul(quantity));
    lines.push({ code: 'DISCOUNT', kind: 'DISCOUNT', label: null, amount: discount.negated().toFixed(2) });
  }

  const chosen = new Set((input.optionalSurcharges ?? []).map((c) => c.toUpperCase()));
  for (const code of chosen) {
    if (!card.surcharges.some((s) => s.code === code && s.optional)) {
      throw new PricingError('UNKNOWN_SURCHARGE', `Service optionnel inconnu : ${code}`);
    }
  }
  const applicable = card.surcharges.filter((s) => !s.optional || chosen.has(s.code));

  const declared = input.declaredValue !== undefined ? new D(String(input.declaredValue)) : null;
  let subtotal = freight.sub(discount);
  const amountOf = (s: SurchargeData, base: Decimal): Decimal => {
    switch (s.method) {
      case 'FLAT':
        return money(s.value);
      case 'PERCENT_OF_FREIGHT':
        return money(freight.mul(s.value).div(100));
      case 'PERCENT_OF_DECLARED_VALUE':
        if (!declared) throw new PricingError('MISSING_DECLARED_VALUE', `La valeur déclarée est nécessaire pour ${s.code}`);
        return money(declared.mul(s.value).div(100));
      case 'PERCENT_OF_SUBTOTAL':
        return money(base.mul(s.value).div(100));
    }
  };

  for (const s of applicable.filter((x) => x.kind !== 'TAX')) {
    const amount = amountOf(s, freight);
    subtotal = subtotal.add(amount);
    lines.push({ code: s.code, kind: s.kind, label: s.name, amount: amount.toFixed(2) });
  }
  const subtotalBeforeTax = subtotal;
  let total = subtotalBeforeTax;
  for (const s of applicable.filter((x) => x.kind === 'TAX')) {
    const amount = amountOf(s, subtotalBeforeTax);
    total = total.add(amount);
    lines.push({ code: s.code, kind: s.kind, label: s.name, amount: amount.toFixed(2) });
  }

  return {
    currency: card.currency,
    weightUnit: card.weightUnit,
    basis,
    quantity: quantity.toNumber(),
    billableUnit: basis === 'WEIGHT' ? card.weightUnit : basis === 'VOLUME' ? 'FT3' : 'UNIT',
    actualWeight: weight3(actual).toFixed(3),
    volumetricWeight: volumetric ? weight3(volumetric).toFixed(3) : null,
    chargeableBeforeRounding: weight3(chargeable).toFixed(3),
    roundedWeight: rounded.toFixed(3),
    billableWeight: billable.toFixed(3),
    appliedRule: {
      weightFrom: rule.weightFrom.toString(),
      weightTo: rule.weightTo ? rule.weightTo.toString() : null,
      categoryCode: rule.categoryCode,
    },
    freight: freight.toFixed(2),
    lines,
    subtotal: subtotalBeforeTax.toFixed(2),
    total: money(total).toFixed(2),
  };
}
