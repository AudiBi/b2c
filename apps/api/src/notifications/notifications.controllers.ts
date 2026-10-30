import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EVENT_CODES, NOTIFICATION_CHANNELS, idParamSchema, listNotificationsQuerySchema, myNotificationsQuerySchema, templateSchema, LOCALES } from '@b2c/shared';
import { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { NotificationsService } from './notifications.service';

type Id = z.infer<typeof idParamSchema>;
const resetQuerySchema = z.strictObject({ eventCode: z.enum(EVENT_CODES), channel: z.enum(NOTIFICATION_CHANNELS), locale: z.enum(LOCALES) });

@ApiTags('Notifications (personnel)')
@ApiBearerAuth()
@Controller('admin')
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @RequirePermission('notification:read')
  @Validate({ query: listNotificationsQuerySchema })
  @ApiOperation({ summary: 'Journal des notifications (statut, tentatives, dernière erreur)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listNotificationsQuerySchema>) {
    return this.notifications.listForStaff(auth, query);
  }

  @Post('notifications/:id/retry')
  @HttpCode(200)
  @RequirePermission('notification:template_manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Relance une notification en échec' })
  retry(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.notifications.retry(auth, params.id);
  }

  @Post('notifications/process')
  @HttpCode(200)
  @RequirePermission('notification:template_manage')
  @ApiOperation({ summary: 'Lance immédiatement un tour de traitement pour votre entreprise', description: 'Le traitement de fond le fait déjà à intervalle régulier ; utile pour vérifier une configuration.' })
  process(@CurrentAuth() auth: AuthContext) {
    return this.notifications.processCompany(auth.companyId);
  }

  @Get('notification-templates')
  @RequirePermission('notification:read')
  @ApiOperation({ summary: 'Modèles effectifs (défaut ou personnalisé) par événement, canal et langue' })
  templates(@CurrentAuth() auth: AuthContext) {
    return this.notifications.listTemplates(auth);
  }

  @Put('notification-templates')
  @RequirePermission('notification:template_manage')
  @Validate({ body: templateSchema })
  @ApiOperation({ summary: 'Crée ou remplace un modèle personnalisé', description: 'Variables limitées à celles de l’événement ; texte brut ; WhatsApp refusé (aucun prestataire).' })
  saveTemplate(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof templateSchema>) {
    return this.notifications.upsertTemplate(auth, body);
  }

  @Delete('notification-templates')
  @HttpCode(204)
  @RequirePermission('notification:template_manage')
  @Validate({ query: resetQuerySchema })
  @ApiOperation({ summary: 'Supprime un modèle personnalisé (retour au modèle par défaut)' })
  async resetTemplate(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof resetQuerySchema>) {
    await this.notifications.resetTemplate(auth, query.eventCode, query.channel, query.locale);
  }
}

@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me/notifications')
export class PortalNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('notification:read_own')
  @Validate({ query: myNotificationsQuerySchema })
  @ApiOperation({ summary: 'Mes notifications du portail et le nombre de non lues' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof myNotificationsQuerySchema>) {
    return this.notifications.listMine(auth, query);
  }

  @Post('read-all')
  @HttpCode(200)
  @RequirePermission('notification:read_own')
  @ApiOperation({ summary: 'Marque toutes mes notifications comme lues' })
  readAll(@CurrentAuth() auth: AuthContext) {
    return this.notifications.markRead(auth, null);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('notification:read_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Marque une notification comme lue' })
  read(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.notifications.markRead(auth, params.id);
  }
}

