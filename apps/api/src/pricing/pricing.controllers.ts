import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  categorySchema,
  createRateCardSchema,
  idParamSchema,
  listRateCardsQuerySchema,
  publicCompanySlugParamSchema,
  quoteInputSchema,
  updateCategorySchema,
} from '@b2c/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import { CustomersService } from '../customers/customers.service';
import { DbService } from '../database/db.service';
import { CompanyDirectory } from '../platform/company-directory.service';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, Public, RateLimit, RequirePermission } from '../security/decorators';
import { PricingService } from './pricing.service';

type Id = z.infer<typeof idParamSchema>;
type Slug = z.infer<typeof publicCompanySlugParamSchema>;

@ApiTags('Administration : tarifs')
@ApiBearerAuth()
@Controller('admin/rate-cards')
export class RateCardsController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @RequirePermission('rate:read')
  @Validate({ query: listRateCardsQuerySchema })
  @ApiOperation({ summary: 'Liste des grilles tarifaires' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listRateCardsQuerySchema>) {
    return this.pricing.listCards(auth, query);
  }

  @Get(':id')
  @RequirePermission('rate:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Détail d'une grille (tranches, suppléments)" })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.pricing.getCard(auth, params.id);
  }

  @Post()
  @RequirePermission('rate:manage')
  @Validate({ body: createRateCardSchema })
  @ApiOperation({
    summary: 'Crée une grille EN BROUILLON',
    description:
      "Poids volumétrique = L × l × h / diviseur (unités et diviseur propres à la grille). Une grille active est immuable : pour la modifier, la dupliquer.",
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createRateCardSchema>) {
    return this.pricing.createCard(auth, body);
  }

  @Put(':id')
  @RequirePermission('rate:manage')
  @Validate({ params: idParamSchema, body: createRateCardSchema })
  @ApiOperation({ summary: 'Remplace une grille en brouillon' })
  replace(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof createRateCardSchema>) {
    return this.pricing.replaceDraft(auth, params.id, body);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('rate:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({
    summary: 'Active une grille',
    description: 'Refusé (409) si une autre grille active couvre le même trajet, le même mode et la même période.',
  })
  activate(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.pricing.activate(auth, params.id);
  }

  @Post(':id/retire')
  @HttpCode(200)
  @RequirePermission('rate:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Retire une grille active (les estimations déjà faites gardent leur grille)' })
  retire(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.pricing.retire(auth, params.id);
  }

  @Post(':id/duplicate')
  @RequirePermission('rate:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Copie une grille en nouveau brouillon' })
  duplicate(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.pricing.duplicate(auth, params.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('rate:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Supprime une grille en brouillon' })
  async remove(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    await this.pricing.deleteDraft(auth, params.id);
  }
}

@ApiTags('Administration : catégories de marchandises')
@ApiBearerAuth()
@Controller('admin/categories')
export class CategoriesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('rate:read')
  @ApiOperation({ summary: 'Catégories de marchandises' })
  async list(@CurrentAuth() auth: AuthContext) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) => tx.packageCategory.findMany({ orderBy: { code: 'asc' } }));
    return { items: rows.map((c) => ({ id: c.id, code: c.code, name: c.name, restricted: c.restricted, active: c.active })) };
  }

  @Post()
  @RequirePermission('rate:manage')
  @Validate({ body: categorySchema })
  @ApiOperation({ summary: 'Crée une catégorie (restreinte : exclue du calculateur public)' })
  async create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof categorySchema>) {
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const row = await tx.packageCategory.create({ data: { companyId: auth.companyId, code: body.code, name: body.name, restricted: body.restricted } });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'category.created', entityType: 'package_category', entityId: row.id, after: { code: row.code } });
        return { id: row.id, code: row.code, name: row.name, restricted: row.restricted, active: row.active };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('CATEGORY_CODE_USED', 'Ce code existe déjà');
      throw error;
    }
  }

  @Patch(':id')
  @RequirePermission('rate:manage')
  @Validate({ params: idParamSchema, body: updateCategorySchema })
  @ApiOperation({ summary: 'Modifie une catégorie' })
  async update(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof updateCategorySchema>) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const existing = await tx.packageCategory.findUnique({ where: { id: params.id } });
      if (!existing) throw AppException.notFound('CATEGORY_NOT_FOUND', 'Catégorie introuvable');
      const row = await tx.packageCategory.update({ where: { id: params.id }, data: body });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'category.updated', entityType: 'package_category', entityId: row.id, after: { fields: Object.keys(body) } });
      return { id: row.id, code: row.code, name: row.name, restricted: row.restricted, active: row.active };
    });
  }
}

/** Calculateur public : aucune donnée personnelle, aucun enregistrement, aucun tarif négocié. */
@ApiTags('Public')
@Controller('public/companies/:slug')
export class PublicPricingController {
  constructor(
    private readonly db: DbService,
    private readonly pricing: PricingService,
    private readonly companies: CompanyDirectory,
  ) {}

  @Get('rates')
  @Public()
  @RateLimit({ name: 'public-rates', limit: 120, windowSeconds: 60 })
  @Validate({ params: publicCompanySlugParamSchema })
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Trajets tarifés disponibles et catégories (pour le calculateur)',
    description: 'Ne liste que les grilles actives aujourd\'hui ; liste vide si aucune grille n\'est publiée.',
  })
  async options(@VParams() params: Slug) {
    const company = await this.companies.requirePublic(params.slug);
    return this.db.run({ companyId: company.id }, (tx) => this.pricing.publicOptions(tx));
  }

  @Post('quote')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'public-quote', limit: 60, windowSeconds: 60 })
  @Validate({ params: publicCompanySlugParamSchema, body: quoteInputSchema })
  @ApiOperation({
    summary: 'Estimation des frais d\'expédition',
    description: 'Résultat toujours marqué estimation (isEstimate). 422 TARIFF_UNAVAILABLE si aucun tarif ne s\'applique : aucun prix n\'est jamais inventé.',
  })
  async quote(@VParams() params: Slug, @VBody() body: z.infer<typeof quoteInputSchema>) {
    const company = await this.companies.requirePublic(params.slug);
    return this.db.run({ companyId: company.id }, (tx) => this.pricing.quote(tx, body));
  }
}

/** Estimations du client connecté (historique). */
@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me/quotes')
export class PortalQuotesController {
  constructor(
    private readonly db: DbService,
    private readonly pricing: PricingService,
    private readonly customers: CustomersService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('quote:create')
  @Validate({ body: quoteInputSchema })
  @ApiOperation({ summary: 'Calcule et enregistre une estimation dans mon historique' })
  async create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof quoteInputSchema>) {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      const customer = await this.customers.ensureCustomer(tx, user);
      const response = await this.pricing.quote(tx, body);
      const saved = await this.pricing.saveQuote(tx, auth.companyId, customer.id, body, response);
      return { id: saved.id, createdAt: saved.createdAt, ...response };
    });
  }

  @Get()
  @RequirePermission('quote:create')
  @ApiOperation({ summary: 'Mes 20 dernières estimations' })
  async list(@CurrentAuth() auth: AuthContext) {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await tx.customer.findUnique({ where: { userId: auth.userId } });
      if (!customer) return { items: [] };
      const rows = await tx.quote.findMany({ where: { customerId: customer.id }, orderBy: { id: 'desc' }, take: 20 });
      return { items: rows.map((row) => ({ id: row.id, createdAt: row.createdAt, input: row.input, ...(row.result as object) })) };
    });
  }
}
