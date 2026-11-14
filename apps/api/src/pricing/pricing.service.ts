import { Injectable } from '@nestjs/common';
import { Prisma, type RateCard, type RateRule, type RateSurcharge } from '@prisma/client';
import type { CreateRateCardInput, QuoteInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { calculate, PricingError, type CalcResult, type CardData } from './calculator';

const D = Prisma.Decimal;

type CardWithChildren = RateCard & { rules: (RateRule & { category: { code: string } | null })[]; surcharges: RateSurcharge[] };
const include = { rules: { include: { category: { select: { code: true } } } }, surcharges: true } satisfies Prisma.RateCardInclude;

const today = () => new Date(new Date().toISOString().slice(0, 10));

/** Nom de la contrainte violée, si l'erreur vient d'une contrainte PostgreSQL. */
export function violatedConstraint(error: unknown): string | null {
  const message = String((error as { message?: string })?.message ?? '');
  const match = /constraint "?([a-z0-9_]+)"?/i.exec(message) ?? /\b(rate_[a-z_]+|packages_[a-z_]+)\b/.exec(message);
  return match ? match[1] : null;
}

export function toCardData(card: CardWithChildren): CardData {
  return {
    id: card.id,
    name: card.name,
    version: card.version,
    currency: card.currency,
    weightUnit: card.weightUnit,
    dimensionUnit: card.dimensionUnit,
    volumetricDivisor: card.volumetricDivisor,
    minBillableWeight: card.minBillableWeight,
    roundingMode: card.roundingMode,
    roundingStep: card.roundingStep,
    rules: card.rules.map((rule) => ({
      categoryCode: rule.category?.code ?? null,
      weightFrom: rule.weightFrom,
      weightTo: rule.weightTo,
      pricePerUnit: rule.pricePerUnit,
      flatFee: rule.flatFee,
      minCharge: rule.minCharge,
      basis: rule.basis,
      volumetricDivisor: rule.volumetricDivisor,
      unitCost: rule.unitCost,
    })),
    surcharges: card.surcharges.map((s) => ({
      code: s.code,
      name: s.name as Record<string, string>,
      kind: s.kind,
      method: s.method,
      value: s.value,
      optional: s.optional,
    })),
  };
}

export function cardDto(card: CardWithChildren) {
  return {
    id: card.id,
    name: card.name,
    status: card.status,
    version: card.version,
    transportMode: card.transportMode,
    originCountry: card.originCountry,
    destinationCountry: card.destinationCountry,
    currency: card.currency,
    weightUnit: card.weightUnit,
    dimensionUnit: card.dimensionUnit,
    volumetricDivisor: card.volumetricDivisor.toString(),
    minBillableWeight: card.minBillableWeight.toString(),
    roundingMode: card.roundingMode,
    roundingStep: card.roundingStep.toString(),
    validFrom: card.validFrom.toISOString().slice(0, 10),
    validTo: card.validTo ? card.validTo.toISOString().slice(0, 10) : null,
    rules: card.rules
      .slice()
      .sort((a, b) => (a.category?.code ?? '').localeCompare(b.category?.code ?? '') || a.weightFrom.cmp(b.weightFrom))
      .map((rule) => ({
        categoryCode: rule.category?.code ?? null,
        weightFrom: rule.weightFrom.toString(),
        weightTo: rule.weightTo?.toString() ?? null,
        pricePerUnit: rule.pricePerUnit.toString(),
        flatFee: rule.flatFee.toString(),
        minCharge: rule.minCharge.toString(),
        basis: rule.basis,
        volumetricDivisor: rule.volumetricDivisor?.toString() ?? null,
      })),
    surcharges: card.surcharges.map((s) => ({
      code: s.code,
      name: s.name,
      kind: s.kind,
      method: s.method,
      value: s.value.toString(),
      optional: s.optional,
    })),
  };
}

export interface QuoteResponse {
  isEstimate: true;
  card: { id: string; name: string; version: number };
  result: CalcResult;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Choix de la grille et calcul
  // ---------------------------------------------------------------------------------------------

  /** Grille ACTIVE applicable aujourd'hui (ou à `on`) pour ce couloir et ce mode ; null s'il n'y en a pas. */
  async findActiveCard(
    tx: Tx,
    params: { transportMode: 'AIR' | 'SEA'; originCountry: string; destinationCountry: string },
    on: Date = today(),
  ): Promise<CardWithChildren | null> {
    return tx.rateCard.findFirst({
      where: {
        status: 'ACTIVE',
        transportMode: params.transportMode,
        originCountry: params.originCountry,
        destinationCountry: params.destinationCountry,
        validFrom: { lte: on },
        OR: [{ validTo: null }, { validTo: { gt: on } }],
      },
      include,
    });
  }

  /**
   * Calcule une estimation. Ne renvoie JAMAIS un prix inventé : sans grille active ou sans tranche pour le poids,
   * l'erreur TARIFF_UNAVAILABLE est levée.
   */
  async quote(tx: Tx, input: QuoteInput): Promise<QuoteResponse> {
    if (input.categoryCode) {
      const category = await tx.packageCategory.findFirst({ where: { code: input.categoryCode, active: true } });
      if (!category) throw AppException.badRequest('CATEGORY_UNKNOWN', 'Catégorie de marchandise inconnue');
      if (category.restricted) {
        throw AppException.unprocessable('CATEGORY_RESTRICTED', "Cette catégorie est soumise à restriction : contactez l'assistance");
      }
    }
    const card = await this.findActiveCard(tx, input);
    if (!card) {
      throw AppException.unprocessable('TARIFF_UNAVAILABLE', "Aucune grille tarifaire n'est publiée pour ce trajet et ce mode de transport");
    }
    try {
      const result = calculate(toCardData(card), {
        weight: input.weight,
        dimensions: input.dimensions,
        categoryCode: input.categoryCode,
        declaredValue: input.declaredValue,
        optionalSurcharges: input.optionalSurcharges,
        quantity: input.quantity,
      });
      return { isEstimate: true, card: { id: card.id, name: card.name, version: card.version }, result };
    } catch (error) {
      if (error instanceof PricingError) {
        if (error.code === 'NO_RULE_FOR_WEIGHT') throw AppException.unprocessable('TARIFF_UNAVAILABLE', "Aucun tarif n'est défini pour ce poids");
        throw AppException.badRequest(error.code, error.message);
      }
      throw error;
    }
  }

  /** Enregistre l'estimation d'un client connecté (jamais celle d'un visiteur anonyme). */
  async saveQuote(tx: Tx, companyId: string, customerId: string, input: QuoteInput, response: QuoteResponse) {
    return tx.quote.create({
      data: {
        companyId,
        customerId,
        rateCardId: response.card.id,
        input: input as unknown as Prisma.InputJsonValue,
        result: response as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Administration des grilles
  // ---------------------------------------------------------------------------------------------

  private async resolveRuleCategories(tx: Tx, codes: (string | undefined)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(codes.filter((c): c is string => !!c).map((c) => c.toUpperCase()))];
    if (wanted.length === 0) return new Map();
    const rows = await tx.packageCategory.findMany({ where: { code: { in: wanted } } });
    const found = new Map(rows.map((row) => [row.code, row.id]));
    const missing = wanted.filter((code) => !found.has(code));
    if (missing.length > 0) throw AppException.badRequest('CATEGORY_UNKNOWN', `Catégorie(s) inconnue(s) : ${missing.join(', ')}`);
    return found;
  }

  private validateSurcharges(input: CreateRateCardInput): void {
    for (const s of input.surcharges) {
      if (s.method === 'PERCENT_OF_SUBTOTAL' && s.kind !== 'TAX') {
        throw AppException.badRequest('INVALID_SURCHARGE', `${s.code} : « % du sous-total » est réservé aux taxes`);
      }
      if (s.kind === 'TAX' && s.method === 'PERCENT_OF_FREIGHT') {
        throw AppException.badRequest('INVALID_SURCHARGE', `${s.code} : une taxe s'applique au sous-total ou en montant fixe`);
      }
      if (s.optional && s.kind === 'TAX') {
        throw AppException.badRequest('INVALID_SURCHARGE', `${s.code} : une taxe ne peut pas être optionnelle`);
      }
    }
  }

  /** Les coûts d'achat se règlent avec `cost:manage` ; sans ce droit, ni saisie, ni perte des coûts déjà en place (remplacement d'un brouillon). */
  private assertCostRights(auth: AuthContext, input: CreateRateCardInput) {
    if (input.rules.some((r) => r.unitCost !== undefined) && !auth.permissions.can('cost:manage')) {
      throw AppException.forbidden('COST_NOT_ALLOWED', "Vous n'avez pas le droit de fixer les coûts d'achat");
    }
  }

  private async writeChildren(tx: Tx, auth: AuthContext, cardId: string, input: CreateRateCardInput, keepCosts?: Map<string, Prisma.Decimal | null>): Promise<void> {
    const categories = await this.resolveRuleCategories(tx, input.rules.map((r) => r.categoryCode));
    try {
      await tx.rateRule.createMany({
        data: input.rules.map((rule) => ({
          companyId: auth.companyId,
          rateCardId: cardId,
          categoryId: rule.categoryCode ? categories.get(rule.categoryCode.toUpperCase()) : null,
          weightFrom: new D(String(rule.weightFrom)),
          weightTo: rule.weightTo !== undefined ? new D(String(rule.weightTo)) : null,
          pricePerUnit: new D(String(rule.pricePerUnit)),
          flatFee: new D(String(rule.flatFee)),
          minCharge: new D(String(rule.minCharge)),
          basis: rule.basis,
          volumetricDivisor: rule.volumetricDivisor !== undefined ? new D(String(rule.volumetricDivisor)) : null,
          unitCost:
            rule.unitCost !== undefined
              ? new D(String(rule.unitCost))
              : (keepCosts?.get(`${rule.categoryCode?.toUpperCase() ?? ''}|${new D(String(rule.weightFrom)).toString()}`) ?? null),
        })),
      });
    } catch (error) {
      if (violatedConstraint(error) === 'rate_rules_no_overlap') {
        throw AppException.badRequest('RULES_OVERLAP', 'Deux tranches de poids se chevauchent pour la même catégorie');
      }
      throw error;
    }
    if (input.surcharges.length > 0) {
      await tx.rateSurcharge.createMany({
        data: input.surcharges.map((s) => ({
          companyId: auth.companyId,
          rateCardId: cardId,
          code: s.code,
          name: s.name,
          kind: s.kind,
          method: s.method,
          value: new D(String(s.value)),
          optional: s.optional,
        })),
      });
    }
  }

  private cardData(auth: AuthContext, input: CreateRateCardInput) {
    return {
      companyId: auth.companyId,
      name: input.name,
      transportMode: input.transportMode,
      originCountry: input.originCountry,
      destinationCountry: input.destinationCountry,
      currency: input.currency,
      weightUnit: input.weightUnit,
      dimensionUnit: input.dimensionUnit,
      volumetricDivisor: new D(String(input.volumetricDivisor)),
      minBillableWeight: new D(String(input.minBillableWeight)),
      roundingMode: input.roundingMode,
      roundingStep: new D(String(input.roundingStep)),
      validFrom: new Date(input.validFrom),
      validTo: input.validTo ? new Date(input.validTo) : null,
      createdBy: auth.userId,
    };
  }

  async createCard(auth: AuthContext, input: CreateRateCardInput) {
    this.validateSurcharges(input);
    this.assertCostRights(auth, input);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const card = await tx.rateCard.create({ data: this.cardData(auth, input) });
      await this.writeChildren(tx, auth, card.id, input);
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'ratecard.created',
        entityType: 'rate_card',
        entityId: card.id,
        after: { name: card.name, transportMode: card.transportMode, route: `${card.originCountry}>${card.destinationCountry}` },
      });
      return cardDto(await tx.rateCard.findUniqueOrThrow({ where: { id: card.id }, include }));
    });
  }

  /** Remplace entièrement une grille EN BROUILLON (une grille active n'est jamais modifiée). */
  async replaceDraft(auth: AuthContext, cardId: string, input: CreateRateCardInput) {
    this.validateSurcharges(input);
    this.assertCostRights(auth, input);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const existing = await tx.rateCard.findUnique({ where: { id: cardId } });
      if (!existing) throw AppException.notFound('RATE_CARD_NOT_FOUND', 'Grille introuvable');
      if (existing.status !== 'DRAFT') {
        throw AppException.conflict('RATE_CARD_IMMUTABLE', 'Une grille active ou retirée ne se modifie pas : dupliquez-la');
      }
      const oldRules = await tx.rateRule.findMany({ where: { rateCardId: cardId }, include: { category: { select: { code: true } } } });
      const keepCosts = new Map(oldRules.map((r) => [`${r.category?.code ?? ''}|${r.weightFrom.toString()}`, r.unitCost]));
      await tx.rateRule.deleteMany({ where: { rateCardId: cardId } });
      await tx.rateSurcharge.deleteMany({ where: { rateCardId: cardId } });
      const { companyId: _c, createdBy: _b, ...data } = this.cardData(auth, input);
      await tx.rateCard.update({ where: { id: cardId }, data: { ...data, version: { increment: 1 } } });
      await this.writeChildren(tx, auth, cardId, input, keepCosts);
      await this.audit.record(tx, { companyId: auth.companyId, action: 'ratecard.updated', entityType: 'rate_card', entityId: cardId });
      return cardDto(await tx.rateCard.findUniqueOrThrow({ where: { id: cardId }, include }));
    });
  }

  async listCards(auth: AuthContext, filter: { status?: 'DRAFT' | 'ACTIVE' | 'RETIRED'; transportMode?: 'AIR' | 'SEA' }) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.rateCard.findMany({ where: filter, include, orderBy: [{ originCountry: 'asc' }, { destinationCountry: 'asc' }, { validFrom: 'desc' }] }),
    );
    return { items: rows.map(cardDto) };
  }

  /** Coûts d'achat par tranche : jamais dans le détail d'une grille, seulement pour ceux qui ont `cost:read`. */
  async listCosts(auth: AuthContext, cardId: string) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.rateRule.findMany({ where: { rateCardId: cardId }, include: { category: { select: { code: true } } }, orderBy: [{ weightFrom: 'asc' }] }),
    );
    return { items: rows.map((r) => ({ categoryCode: r.category?.code ?? null, weightFrom: r.weightFrom.toString(), basis: r.basis, unitCost: r.unitCost?.toString() ?? null })) };
  }

  async getCard(auth: AuthContext, cardId: string) {
    const row = await this.db.run({ companyId: auth.companyId }, (tx) => tx.rateCard.findUnique({ where: { id: cardId }, include }));
    if (!row) throw AppException.notFound('RATE_CARD_NOT_FOUND', 'Grille introuvable');
    return cardDto(row);
  }

  async activate(auth: AuthContext, cardId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const existing = await tx.rateCard.findUnique({ where: { id: cardId }, include });
      if (!existing) throw AppException.notFound('RATE_CARD_NOT_FOUND', 'Grille introuvable');
      if (existing.status !== 'DRAFT') throw AppException.conflict('RATE_CARD_NOT_DRAFT', 'Seule une grille en brouillon peut être activée');
      if (existing.rules.length === 0) throw AppException.badRequest('RATE_CARD_EMPTY', 'La grille ne contient aucune tranche');
      try {
        await tx.rateCard.update({ where: { id: cardId }, data: { status: 'ACTIVE' } });
      } catch (error) {
        if (violatedConstraint(error) === 'rate_cards_no_active_overlap') {
          throw AppException.conflict('RATE_CARD_PERIOD_OVERLAP', 'Une autre grille active couvre déjà ce trajet, ce mode et cette période : retirez-la ou changez les dates');
        }
        throw error;
      }
      await this.audit.record(tx, { companyId: auth.companyId, action: 'ratecard.activated', entityType: 'rate_card', entityId: cardId });
      return cardDto(await tx.rateCard.findUniqueOrThrow({ where: { id: cardId }, include }));
    });
  }

  async retire(auth: AuthContext, cardId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const existing = await tx.rateCard.findUnique({ where: { id: cardId } });
      if (!existing) throw AppException.notFound('RATE_CARD_NOT_FOUND', 'Grille introuvable');
      if (existing.status !== 'ACTIVE') throw AppException.conflict('RATE_CARD_NOT_ACTIVE', 'Seule une grille active peut être retirée');
      const now = today();
      const closeToday = (!existing.validTo || existing.validTo > now) && now > existing.validFrom;
      await tx.rateCard.update({ where: { id: cardId }, data: { status: 'RETIRED', ...(closeToday ? { validTo: now } : {}) } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'ratecard.retired', entityType: 'rate_card', entityId: cardId });
      return cardDto(await tx.rateCard.findUniqueOrThrow({ where: { id: cardId }, include }));
    });
  }

  async deleteDraft(auth: AuthContext, cardId: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const existing = await tx.rateCard.findUnique({ where: { id: cardId } });
      if (!existing) throw AppException.notFound('RATE_CARD_NOT_FOUND', 'Grille introuvable');
      if (existing.status !== 'DRAFT') throw AppException.conflict('RATE_CARD_NOT_DRAFT', 'Seule une grille en brouillon peut être supprimée');
      await tx.rateRule.deleteMany({ where: { rateCardId: cardId } });
      await tx.rateSurcharge.deleteMany({ where: { rateCardId: cardId } });
      await tx.rateCard.delete({ where: { id: cardId } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'ratecard.deleted', entityType: 'rate_card', entityId: cardId });
    });
  }

  /** Copie une grille (de n'importe quel statut) en nouveau brouillon : c'est ainsi qu'on « modifie » une grille active. */
  async duplicate(auth: AuthContext, cardId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const source = await tx.rateCard.findUnique({ where: { id: cardId }, include });
      if (!source) throw AppException.notFound('RATE_CARD_NOT_FOUND', 'Grille introuvable');
      const copy = await tx.rateCard.create({
        data: {
          companyId: auth.companyId,
          name: `${source.name} (copie)`.slice(0, 120),
          transportMode: source.transportMode,
          originCountry: source.originCountry,
          destinationCountry: source.destinationCountry,
          currency: source.currency,
          weightUnit: source.weightUnit,
          dimensionUnit: source.dimensionUnit,
          volumetricDivisor: source.volumetricDivisor,
          minBillableWeight: source.minBillableWeight,
          roundingMode: source.roundingMode,
          roundingStep: source.roundingStep,
          validFrom: today(),
          validTo: null,
          version: source.version + 1,
          createdBy: auth.userId,
        },
      });
      await tx.rateRule.createMany({
        data: source.rules.map((r) => ({
          companyId: auth.companyId,
          rateCardId: copy.id,
          categoryId: r.categoryId,
          weightFrom: r.weightFrom,
          weightTo: r.weightTo,
          pricePerUnit: r.pricePerUnit,
          flatFee: r.flatFee,
          minCharge: r.minCharge,
          basis: r.basis,
          volumetricDivisor: r.volumetricDivisor,
          unitCost: r.unitCost,
        })),
      });
      if (source.surcharges.length > 0) {
        await tx.rateSurcharge.createMany({
          data: source.surcharges.map((s) => ({
            companyId: auth.companyId,
            rateCardId: copy.id,
            code: s.code,
            name: s.name as Prisma.InputJsonValue,
            kind: s.kind,
            method: s.method,
            value: s.value,
            optional: s.optional,
          })),
        });
      }
      await this.audit.record(tx, { companyId: auth.companyId, action: 'ratecard.duplicated', entityType: 'rate_card', entityId: copy.id, after: { from: cardId } });
      return cardDto(await tx.rateCard.findUniqueOrThrow({ where: { id: copy.id }, include }));
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Informations publiques pour le calculateur
  // ---------------------------------------------------------------------------------------------

  async publicOptions(tx: Tx) {
    const now = today();
    const cards = await tx.rateCard.findMany({
      where: { status: 'ACTIVE', validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
      include: { surcharges: true },
      orderBy: [{ originCountry: 'asc' }, { destinationCountry: 'asc' }, { transportMode: 'asc' }],
    });
    const categories = await tx.packageCategory.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
    return {
      corridors: cards.map((card) => ({
        transportMode: card.transportMode,
        originCountry: card.originCountry,
        destinationCountry: card.destinationCountry,
        currency: card.currency,
        weightUnit: card.weightUnit,
        dimensionUnit: card.dimensionUnit,
        optionalSurcharges: card.surcharges
          .filter((s) => s.optional)
          .map((s) => ({ code: s.code, name: s.name, method: s.method, value: s.value.toString() })),
      })),
      categories: categories.map((c) => ({ code: c.code, name: c.name, restricted: c.restricted })),
    };
  }
}
