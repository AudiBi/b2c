import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { addStopSchema, createRouteSchema, deliverySettingsSchema, failDeliverySchema, handoverSchema, idParamSchema, listRoutesQuerySchema } from '@b2c/shared';
import { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RateLimit, RequirePermission } from '../security/decorators';
import { DeliveryService } from './delivery.service';

type Id = z.infer<typeof idParamSchema>;
const stopParamsSchema = z.strictObject({ id: z.uuid(), stopId: z.uuid() });

@ApiTags('Livraisons (personnel)')
@ApiBearerAuth()
@Controller('admin')
export class AdminDeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('routes')
  @RequirePermission('delivery:read')
  @Validate({ query: listRoutesQuerySchema })
  @ApiOperation({ summary: 'Tournées des agences que vous gérez' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listRoutesQuerySchema>) {
    return this.delivery.listRoutes(auth, query);
  }

  @Post('routes')
  @RequirePermission('delivery:assign')
  @Validate({ body: createRouteSchema })
  @ApiOperation({ summary: 'Planifie une tournée pour un livreur', description: 'Référence TOU-AAAA-NNNNNN. Le livreur doit avoir le rôle de livreur.' })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createRouteSchema>) {
    return this.delivery.createRoute(auth, body);
  }

  @Get('routes/:id')
  @RequirePermission('delivery:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail d’une tournée : arrêts, adresses, soldes dus' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.getRoute(auth, params.id);
  }

  @Post('routes/:id/stops')
  @RequirePermission('delivery:assign')
  @Validate({ params: idParamSchema, body: addStopSchema })
  @ApiOperation({ summary: 'Ajoute un colis (arrêt) à une tournée planifiée', description: 'Le client est prévenu (delivery.scheduled). Adresse figée à la planification.' })
  addStop(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof addStopSchema>) {
    return this.delivery.addStop(auth, params.id, body);
  }

  @Delete('routes/:id/stops/:stopId')
  @HttpCode(204)
  @RequirePermission('delivery:assign')
  @Validate({ params: stopParamsSchema })
  @ApiOperation({ summary: 'Retire un arrêt d’une tournée planifiée' })
  async removeStop(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof stopParamsSchema>) {
    await this.delivery.removeStop(auth, params.id, params.stopId);
  }

  @Post('routes/:id/start')
  @HttpCode(200)
  @RequirePermission('delivery:assign')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Fait partir la tournée : les colis passent « en cours de livraison » (tout ou rien)' })
  start(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.startRoute(auth, params.id);
  }

  @Post('routes/:id/complete')
  @HttpCode(200)
  @RequirePermission('delivery:assign')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Termine la tournée (tous les arrêts doivent être traités)' })
  complete(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.completeRoute(auth, params.id);
  }

  @Post('routes/:id/cancel')
  @HttpCode(200)
  @RequirePermission('delivery:assign')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Annule une tournée planifiée' })
  cancel(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.cancelRoute(auth, params.id);
  }

  @Post('packages/:id/handover')
  @HttpCode(200)
  @RequirePermission('delivery:confirm')
  @Validate({ params: idParamSchema, body: handoverSchema })
  @RateLimit({ name: 'handover', limit: 60, windowSeconds: 60 })
  @ApiOperation({
    summary: 'Remise au comptoir de l’agence',
    description:
      'Le colis doit être « prêt pour retrait ». Preuves selon la règle de l’entreprise (code du client, pièce d’identité, photo). Solde dû : refus (BALANCE_DUE) sauf dérogation motivée de qui a le droit. Réservé aux responsables de l’agence : un livreur passe par sa tournée.',
  })
  handover(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof handoverSchema>) {
    return this.delivery.handoverAtAgency(auth, params.id, body);
  }

  @Get('drivers')
  @RequirePermission('delivery:assign')
  @ApiOperation({ summary: 'Livreurs actifs affectables à une tournée' })
  drivers(@CurrentAuth() auth: AuthContext) {
    return this.delivery.listDrivers(auth);
  }

  @Get('packages/:id/handover-info')
  @RequirePermission('delivery:confirm')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Avant une remise au comptoir : preuves exigées, bénéficiaires, solde dû, échecs précédents' })
  handoverInfo(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.handoverInfo(auth, params.id);
  }

  @Get('packages/:id/delivery-attempts')
  @RequirePermission('delivery:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Tentatives de remise et de livraison d’un colis' })
  attempts(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.attempts(auth, params.id);
  }

  @Get('settings/delivery')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Preuves exigées à la remise' })
  async settings(@CurrentAuth() auth: AuthContext) {
    return this.delivery.readSettings(auth);
  }

  @Put('settings/delivery')
  @RequirePermission('settings:update')
  @Validate({ body: deliverySettingsSchema })
  @ApiOperation({ summary: 'Modifie les preuves exigées à la remise (code, pièce d’identité, photo)' })
  updateSettings(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof deliverySettingsSchema>) {
    return this.delivery.updateSettings(auth, body);
  }
}

/** Le livreur ne voit et ne traite que ses propres tournées. */
@ApiTags('Livraisons (livreur)')
@ApiBearerAuth()
@Controller('admin')
export class DriverController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('my-routes')
  @RequirePermission('delivery:read_assigned')
  @Validate({ query: listRoutesQuerySchema })
  @ApiOperation({ summary: 'Mes tournées' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listRoutesQuerySchema>) {
    return this.delivery.listRoutes(auth, query, true);
  }

  @Get('my-routes/:id')
  @RequirePermission('delivery:read_assigned')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Une de mes tournées : arrêts, adresses, instructions' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.getRoute(auth, params.id, true);
  }

  @Post('route-stops/:id/deliver')
  @HttpCode(200)
  @RequirePermission('delivery:confirm')
  @Validate({ params: idParamSchema, body: handoverSchema })
  @RateLimit({ name: 'handover', limit: 60, windowSeconds: 60 })
  @ApiOperation({ summary: 'Confirme la remise d’un arrêt', description: 'Livreur de la tournée ou responsable de l’agence ; toute autre personne reçoit un 404.' })
  deliver(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof handoverSchema>) {
    return this.delivery.deliverStop(auth, params.id, body);
  }

  @Post('route-stops/:id/fail')
  @HttpCode(200)
  @RequirePermission('delivery:confirm')
  @Validate({ params: idParamSchema, body: failDeliverySchema })
  @ApiOperation({ summary: 'Déclare une livraison non aboutie (motif)', description: 'Le colis revient « prêt pour retrait » à l’agence ; le client est prévenu.' })
  fail(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof failDeliverySchema>) {
    return this.delivery.failStop(auth, params.id, body);
  }
}

@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me/packages')
export class PortalDeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Post(':id/handover-code')
  @HttpCode(200)
  @RequirePermission('package:read_own')
  @Validate({ params: idParamSchema })
  @RateLimit({ name: 'handover-code', limit: 20, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Génère mon code de remise (6 chiffres, montré une seule fois)',
    description: 'Disponible quand le colis est en agence ou en cours de livraison. Un nouveau code annule le précédent ; seule l’empreinte est conservée.',
  })
  code(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.delivery.generateCode(auth, params.id);
  }
}
