import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@b2c/shared';
import { z } from 'zod';
import { Validate, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { OpsService } from './ops.service';

const delaysQuery = z.strictObject({ days: z.coerce.number().int().min(1).max(365).default(14) });

@ApiTags('Exploitation')
@ApiBearerAuth()
@Controller('admin')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('reports/delays')
  @RequirePermission('package:read')
  @Validate({ query: delaysQuery })
  @ApiOperation({ summary: 'Alerte de retard : colis ouverts sans changement depuis N jours (14 par défaut)' })
  delays(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof delaysQuery>) {
    return this.ops.delays(auth, query.days);
  }

  @Get('customers/:id/flow')
  @RequirePermission('customer:read', 'package:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Flot d’un client : colis par statut, ouverts, derniers colis' })
  flow(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.ops.customerFlow(auth, params.id);
  }
}

@Module({ controllers: [OpsController], providers: [OpsService] })
export class OpsModule {}
