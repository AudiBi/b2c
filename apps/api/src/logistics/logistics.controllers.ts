import { Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  agencyReceiveSchema,
  anomaliesQuerySchema,
  assignAgencySchema,
  createAgencySchema,
  createLocationSchema,
  createShipmentSchema,
  idParamSchema,
  inventoryQuerySchema,
  listShipmentsQuerySchema,
  loadPackageSchema,
  moveSchema,
  publicCompanySlugParamSchema,
  scanReceiveSchema,
  shipmentActionSchema,
  shipmentPackageParamSchema,
  updateAgencySchema,
  updateLocationSchema,
  updateShipmentSchema,
  type ShipmentStatus,
} from '@b2c/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import { DbService } from '../database/db.service';
import { CompanyDirectory } from '../platform/company-directory.service';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, Public, RateLimit, RequirePermission } from '../security/decorators';
import { AgenciesService } from './agencies.service';
import { manifestCsv, manifestPdf } from './manifest';
import { ShipmentsService } from './shipments.service';
import { WarehouseOpsService } from './warehouse-ops.service';

type Id = z.infer<typeof idParamSchema>;
const agencyPackageParams = idParamSchema.extend({ packageId: idParamSchema.shape.id });

@ApiTags('Entrepôt (personnel)')
@ApiBearerAuth()
@Controller('admin')
export class WarehouseOpsController {
  constructor(private readonly ops: WarehouseOpsService) {}

  @Get('warehouses/:id/locations')
  @RequirePermission('warehouse:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Emplacements d'un entrepôt" })
  locations(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.ops.listLocations(auth, params.id);
  }

  @Post('warehouses/:id/locations')
  @RequirePermission('warehouse:manage')
  @Validate({ params: idParamSchema, body: createLocationSchema })
  @ApiOperation({ summary: 'Crée un emplacement (zone, étagère, bac)' })
  createLocation(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof createLocationSchema>) {
    return this.ops.createLocation(auth, params.id, body);
  }

  @Patch('locations/:id')
  @RequirePermission('warehouse:manage')
  @Validate({ params: idParamSchema, body: updateLocationSchema })
  @ApiOperation({ summary: 'Modifie ou désactive un emplacement (refusé s’il contient des colis)' })
  updateLocation(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof updateLocationSchema>) {
    return this.ops.updateLocation(auth, params.id, body);
  }

  @Get('warehouses/:id/inventory')
  @RequirePermission('warehouse:read')
  @Validate({ params: idParamSchema, query: inventoryQuerySchema })
  @ApiOperation({ summary: 'Inventaire des colis présents (par emplacement), hors colis déjà partis' })
  inventory(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VQuery() query: z.infer<typeof inventoryQuerySchema>) {
    return this.ops.inventory(auth, params.id, query.locationId);
  }

  @Get('anomalies')
  @RequirePermission('package:read')
  @Validate({ query: anomaliesQuerySchema })
  @ApiOperation({ summary: 'File de traitement : retenues ouvertes et colis sans client' })
  anomalies(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof anomaliesQuerySchema>) {
    return this.ops.anomalies(auth, query.warehouseId);
  }

  @Post('packages/:id/move')
  @HttpCode(200)
  @RequirePermission('warehouse:move')
  @Validate({ params: idParamSchema, body: moveSchema })
  @ApiOperation({ summary: 'Range, déplace ou sort un colis de son emplacement (mouvement journalisé)' })
  move(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof moveSchema>) {
    return this.ops.move(auth, params.id, body);
  }

  @Get('packages/:id/movements')
  @RequirePermission('package:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Historique des mouvements d'un colis en entrepôt" })
  movements(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.ops.movements(auth, params.id);
  }

  @Post('scan/receive')
  @HttpCode(200)
  @RequirePermission('package:receive')
  @Validate({ body: scanReceiveSchema })
  @ApiOperation({
    summary: 'Réception par scan (numéro de suivi ou numéro du marchand)',
    description:
      "Résultat : RECEIVED (colis attendu rapproché), ALREADY_RECEIVED (relecture sans effet) ou UNIDENTIFIED (nouveau colis sans client). Deux lectures simultanées du même code ne créent jamais deux colis.",
  })
  scan(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof scanReceiveSchema>) {
    return this.ops.scanReceive(auth, body);
  }
}

@ApiTags('Agences')
@ApiBearerAuth()
@Controller('admin')
export class AgenciesController {
  constructor(private readonly agencies: AgenciesService) {}

  @Get('agencies')
  @RequirePermission('agency:read')
  @ApiOperation({ summary: 'Agences (limitées à votre périmètre)' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.agencies.list(auth);
  }

  @Post('agencies')
  @RequirePermission('agency:manage')
  @Validate({ body: createAgencySchema })
  @ApiOperation({ summary: 'Crée une agence ou un point de retrait' })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createAgencySchema>) {
    return this.agencies.create(auth, body);
  }

  @Patch('agencies/:id')
  @RequirePermission('agency:manage')
  @Validate({ params: idParamSchema, body: updateAgencySchema })
  @ApiOperation({ summary: 'Modifie une agence' })
  update(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof updateAgencySchema>) {
    return this.agencies.update(auth, params.id, body);
  }

  @Get('agencies/:id/packages')
  @RequirePermission('agency:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Colis présents dans l'agence et colis attendus" })
  inventory(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.agencies.inventory(auth, params.id);
  }

  @Post('agencies/:id/receive')
  @HttpCode(200)
  @RequirePermission('agency:receive')
  @Validate({ params: idParamSchema, body: agencyReceiveSchema })
  @ApiOperation({
    summary: "Réception en agence par scan",
    description: "RECEIVED ou ALREADY_RECEIVED. 409 WRONG_AGENCY si le colis est destiné à une autre agence, 409 NOT_ARRIVED si son lot n'est pas arrivé.",
  })
  receive(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof agencyReceiveSchema>) {
    return this.agencies.receive(auth, params.id, body.code);
  }

  @Post('agencies/:id/packages/:packageId/ready-for-pickup')
  @HttpCode(200)
  @RequirePermission('agency:receive')
  @Validate({ params: agencyPackageParams })
  @ApiOperation({ summary: 'Marque le colis « prêt pour retrait »' })
  ready(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof agencyPackageParams>) {
    return this.agencies.readyForPickup(auth, params.id, params.packageId);
  }

  @Post('packages/:id/agency')
  @HttpCode(200)
  @RequirePermission('package:update')
  @Validate({ params: idParamSchema, body: assignAgencySchema })
  @ApiOperation({ summary: "Affecte (ou retire) l'agence de retrait d'un colis" })
  assign(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof assignAgencySchema>) {
    return this.agencies.assign(auth, params.id, body.agencyId);
  }
}

/** Agences visibles du public : aucune donnée de colis. */
@ApiTags('Public')
@Controller('public/companies/:slug')
export class PublicAgenciesController {
  constructor(
    private readonly db: DbService,
    private readonly agencies: AgenciesService,
    private readonly companies: CompanyDirectory,
  ) {}

  @Get('agencies')
  @Public()
  @RateLimit({ name: 'public-agencies', limit: 120, windowSeconds: 60 })
  @Validate({ params: publicCompanySlugParamSchema })
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Agences et points de retrait actifs et visibles' })
  async list(@VParams() params: z.infer<typeof publicCompanySlugParamSchema>) {
    const company = await this.companies.requirePublic(params.slug);
    return this.db.run({ companyId: company.id }, (tx) => this.agencies.publicList(tx));
  }
}

@ApiTags('Lots de transport')
@ApiBearerAuth()
@Controller('admin/shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get()
  @RequirePermission('shipment:read')
  @Validate({ query: listShipmentsQuerySchema })
  @ApiOperation({ summary: 'Lots (limités aux entrepôts de votre périmètre)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listShipmentsQuerySchema>) {
    return this.shipments.list(auth, query);
  }

  @Post()
  @RequirePermission('shipment:manage')
  @Validate({ body: createShipmentSchema })
  @ApiOperation({
    summary: 'Crée un lot ouvert',
    description: 'Référence <entrepôt>-<AIR|SEA>-<AAAAMMJJ>-<n>. Aucune date prévue ni position : seules les dates réelles de départ et d’arrivée sont enregistrées.',
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createShipmentSchema>) {
    return this.shipments.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('shipment:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail : colis chargés, totaux, historique' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.shipments.get(auth, params.id);
  }

  @Patch(':id')
  @RequirePermission('shipment:manage')
  @Validate({ params: idParamSchema, body: updateShipmentSchema })
  @ApiOperation({ summary: 'Modifie un lot ouvert' })
  update(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof updateShipmentSchema>) {
    return this.shipments.update(auth, params.id, body);
  }

  @Post(':id/packages')
  @HttpCode(200)
  @RequirePermission('shipment:manage')
  @Validate({ params: idParamSchema, body: loadPackageSchema })
  @ApiOperation({
    summary: 'Charge un colis (par code scanné ou identifiant)',
    description: 'Colis « prêt pour expédition », même mode, même entrepôt, même destination, dans un seul lot à la fois. LOADED ou ALREADY_LOADED.',
  })
  load(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof loadPackageSchema>) {
    return this.shipments.load(auth, params.id, body);
  }

  @Delete(':id/packages/:packageId')
  @HttpCode(204)
  @RequirePermission('shipment:manage')
  @Validate({ params: shipmentPackageParamSchema })
  @ApiOperation({ summary: 'Retire un colis d’un lot ouvert' })
  async unload(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof shipmentPackageParamSchema>) {
    await this.shipments.unload(auth, params.id, params.packageId);
  }

  private action(auth: AuthContext, id: string, to: ShipmentStatus, body: z.infer<typeof shipmentActionSchema>) {
    return this.shipments.act(auth, id, to, body.note);
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @RequirePermission('shipment:dispatch')
  @Validate({ params: idParamSchema, body: shipmentActionSchema })
  @ApiOperation({ summary: 'Départ du lot : les colis passent « en transit »' })
  dispatch(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof shipmentActionSchema>) {
    return this.action(auth, params.id, 'DISPATCHED', body);
  }

  @Post(':id/arrive')
  @HttpCode(200)
  @RequirePermission('shipment:receive')
  @Validate({ params: idParamSchema, body: shipmentActionSchema })
  @ApiOperation({ summary: 'Arrivée du lot : les colis passent « arrivés dans le pays de destination »' })
  arrive(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof shipmentActionSchema>) {
    return this.action(auth, params.id, 'ARRIVED', body);
  }

  @Post(':id/customs')
  @HttpCode(200)
  @RequirePermission('shipment:receive')
  @Validate({ params: idParamSchema, body: shipmentActionSchema })
  @ApiOperation({ summary: 'Lot en douane : les colis passent « en cours de traitement douanier »' })
  customs(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof shipmentActionSchema>) {
    return this.action(auth, params.id, 'IN_CUSTOMS', body);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('shipment:manage')
  @Validate({ params: idParamSchema, body: shipmentActionSchema })
  @ApiOperation({ summary: 'Clôture le lot (refusée tant que des colis ne sont pas reçus en agence)' })
  close(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof shipmentActionSchema>) {
    return this.action(auth, params.id, 'CLOSED', body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('shipment:manage')
  @Validate({ params: idParamSchema, body: shipmentActionSchema })
  @ApiOperation({ summary: 'Annule un lot ouvert (les colis redeviennent libres)' })
  cancel(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof shipmentActionSchema>) {
    return this.action(auth, params.id, 'CANCELLED', body);
  }

  @Get(':id/manifest.csv')
  @RequirePermission('shipment:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Manifeste CSV (UTF-8, cellules protégées contre l’injection de formules)' })
  async csv(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @Res() res: Response) {
    const data = await this.shipments.manifestData(auth, params.id);
    this.send(res, 'text/csv; charset=utf-8', `manifeste-${data.reference}.csv`, Buffer.from(manifestCsv(data), 'utf8'));
  }

  @Get(':id/manifest.pdf')
  @RequirePermission('shipment:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Manifeste PDF imprimable' })
  async pdf(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @Res() res: Response) {
    const data = await this.shipments.manifestData(auth, params.id);
    this.send(res, 'application/pdf', `manifeste-${data.reference}.pdf`, await manifestPdf(data));
  }

  private send(res: Response, type: string, filename: string, body: Buffer) {
    res
      .status(200)
      .set({
        'Content-Type': type,
        'Content-Length': String(body.length),
        // Nom assaini (la référence ne contient que lettres, chiffres et tirets) ; téléchargement, jamais affichage en ligne
        'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      })
      .send(body);
  }
}
