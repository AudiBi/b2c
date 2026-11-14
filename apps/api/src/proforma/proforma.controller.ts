import { Controller, Get, HttpCode, Module, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { convertProformaSchema, createProformaSchema, idParamSchema, listProformasQuerySchema } from '@b2c/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import { PackagesModule } from '../packages/packages.module';
import { PricingModule } from '../pricing/pricing.module';
import { proformaPdf } from '../finance/finance-pdf';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { ProformaService } from './proforma.service';

type Id = z.infer<typeof idParamSchema>;

@ApiTags('Administration : proforma')
@ApiBearerAuth()
@Controller('admin/proformas')
export class ProformaController {
  constructor(private readonly proformas: ProformaService) {}

  @Get()
  @RequirePermission('quote:create', 'customer:read')
  @Validate({ query: listProformasQuerySchema })
  @ApiOperation({ summary: 'Proformas (filtre par client)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listProformasQuerySchema>) {
    return this.proformas.list(auth, query);
  }

  @Post()
  @RequirePermission('quote:create', 'customer:read')
  @Validate({ body: createProformaSchema })
  @ApiOperation({
    summary: 'Crée une proforma pour un client à partir de la grille active (figée, valable N jours)',
    description: "Même calcul que l'estimation : 422 TARIFF_UNAVAILABLE sans tarif applicable. Numéro PF-AAAA-NNNNNN.",
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createProformaSchema>) {
    return this.proformas.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('quote:create', 'customer:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Détail d'une proforma" })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.proformas.get(auth, params.id);
  }

  @Get(':id/pdf')
  @RequirePermission('quote:create', 'customer:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Proforma imprimable (PDF)' })
  async pdf(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @Res() res: Response) {
    const data = await this.proformas.get(auth, params.id);
    const buffer = await proformaPdf({ company: data.company, number: data.number, customer: `${data.customer.name} (${data.customer.customerCode})`, validUntil: data.validUntil, currency: data.currency, total: data.total, cardName: data.card.name, lines: data.lines.map((l) => ({ label: l.kind === 'FREIGHT' ? 'Fret' : (l.label?.fr ?? l.code), amount: l.amount })), note: data.note });
    res
      .status(200)
      .set({ 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.length), 'Content-Disposition': `attachment; filename="${data.number}.pdf"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
      .end(buffer);
  }

  @Post(':id/convert')
  @HttpCode(201)
  @RequirePermission('quote:create', 'customer:read', 'package:receive')
  @Validate({ params: idParamSchema, body: convertProformaSchema })
  @ApiOperation({ summary: 'Transforme la proforma en colis de comptoir (reçu en entrepôt)' })
  convert(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof convertProformaSchema>) {
    return this.proformas.convert(auth, params.id, body);
  }
}

@Module({ imports: [PackagesModule, PricingModule], controllers: [ProformaController], providers: [ProformaService] })
export class ProformaModule {}
