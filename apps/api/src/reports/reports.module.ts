import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { dashboardQuerySchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { ReportsService } from './reports.service';

@ApiTags('Tableau de bord')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermission('report:read')
  @Validate({ query: dashboardQuerySchema })
  @ApiOperation({
    summary: 'Indicateurs de l’entreprise sur une période (30 derniers jours par défaut)',
    description: 'Tout est calculé par des requêtes sur les données réelles. Aucune valeur de remplacement : une moyenne sans mesure vaut null. Réservé aux droits portant sur toute l’entreprise.',
  })
  dashboard(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof dashboardQuerySchema>) {
    return this.reports.dashboard(auth, query);
  }
}

@Module({ controllers: [DashboardController], providers: [ReportsService] })
export class ReportsModule {}
