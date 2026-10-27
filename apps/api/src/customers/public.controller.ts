import { Controller, Get, Header, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { publicCompanySlugParamSchema, publicContactSchema, PLATFORM_COMPANY_ID, type PublicContact } from '@b2c/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { Validate, VBody, VParams } from '../common/validation';
import { DbService } from '../database/db.service';
import { CompanyDirectory } from '../platform/company-directory.service';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, Public, RateLimit, RequirePermission } from '../security/decorators';

const CONTACT_KEY = 'public.contact';
const NO_CONTACT: PublicContact = { phones: [], address: undefined, hours: undefined };

type Params = z.infer<typeof publicCompanySlugParamSchema>;

/** Informations publiques d'une entreprise pour son site (aucune donnée personnelle ni métier). */
@ApiTags('Public')
@Controller('public/companies')
export class PublicController {
  constructor(
    private readonly db: DbService,
    private readonly companies: CompanyDirectory,
  ) {}

  private resolve(slug: string) {
    return this.companies.requirePublic(slug);
  }

  @Get(':slug')
  @Public()
  @RateLimit({ name: 'public-company', limit: 120, windowSeconds: 60 })
  @Validate({ params: publicCompanySlugParamSchema })
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: "Nom, langue, devise et coordonnées publiques d'une entreprise" })
  async company(@VParams() params: Params) {
    const company = await this.resolve(params.slug);
    const row = await this.db.run({ companyId: company.id }, async (tx) => {
      const [details, setting] = await Promise.all([
        tx.company.findUniqueOrThrow({ where: { id: company.id } }),
        tx.companySetting.findUnique({ where: { companyId_key: { companyId: company.id, key: CONTACT_KEY } } }),
      ]);
      return { details, setting };
    });
    const contact = publicContactSchema.safeParse(row.setting?.value);
    return {
      name: row.details.name,
      slug: row.details.slug,
      defaultLocale: row.details.defaultLocale,
      defaultCurrency: row.details.defaultCurrency,
      contact: contact.success ? contact.data : NO_CONTACT,
    };
  }

  @Get(':slug/warehouses')
  @Public()
  @RateLimit({ name: 'public-warehouses', limit: 120, windowSeconds: 60 })
  @Validate({ params: publicCompanySlugParamSchema })
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: "Entrepôts actifs visibles publiquement",
    description: "Le modèle d'adresse personnalisé des clients n'est jamais exposé.",
  })
  async warehouses(@VParams() params: Params) {
    const company = await this.resolve(params.slug);
    const rows = await this.db.run({ companyId: company.id }, (tx) =>
      tx.warehouse.findMany({
        where: { status: 'ACTIVE', publicVisible: true },
        orderBy: [{ country: 'asc' }, { city: 'asc' }, { reference: 'asc' }],
      }),
    );
    return {
      items: rows.map((row) => ({
        reference: row.reference,
        name: row.name,
        country: row.country,
        city: row.city,
        addressLine: row.addressLine,
      })),
    };
  }
}

@ApiTags('Administration : paramètres')
@ApiBearerAuth()
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get('public-contact')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Coordonnées publiques affichées sur la page Contact' })
  async get(@CurrentAuth() auth: AuthContext) {
    const setting = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.companySetting.findUnique({ where: { companyId_key: { companyId: auth.companyId, key: CONTACT_KEY } } }),
    );
    const parsed = publicContactSchema.safeParse(setting?.value);
    return parsed.success ? parsed.data : NO_CONTACT;
  }

  @Put('public-contact')
  @RequirePermission('settings:update')
  @Validate({ body: publicContactSchema })
  @ApiOperation({ summary: 'Remplace les coordonnées publiques (e-mail, téléphones, adresse, horaires, réseaux sociaux)' })
  async put(@CurrentAuth() auth: AuthContext, @VBody() body: PublicContact) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.companySetting.upsert({
        where: { companyId_key: { companyId: auth.companyId, key: CONTACT_KEY } },
        update: { value: body },
        create: { companyId: auth.companyId, key: CONTACT_KEY, value: body },
      });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'settings.public_contact_updated',
        entityType: 'company_setting',
        after: { fields: Object.keys(body) },
      });
      return body;
    });
  }
}
