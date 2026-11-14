import { Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { assignReferrerSchema, compensationSchema, createReferrerSchema, idParamSchema, payCommissionSchema, statementQuerySchema, updateReferrerSchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { ReferrersService } from './referrers.service';

type Id = z.infer<typeof idParamSchema>;

@ApiTags('Administration : référents')
@ApiBearerAuth()
@Controller('admin/referrers')
export class ReferrersController {
  constructor(private readonly referrers: ReferrersService) {}

  @Get()
  @RequirePermission('referrer:read')
  @ApiOperation({ summary: 'Référents et nombre de clients amenés' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.referrers.list(auth);
  }

  @Post()
  @RequirePermission('referrer:manage')
  @Validate({ body: createReferrerSchema })
  @ApiOperation({ summary: 'Crée un référent (pourcentage du profit)' })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createReferrerSchema>) {
    return this.referrers.create(auth, body);
  }

  @Patch(':id')
  @RequirePermission('referrer:manage')
  @Validate({ params: idParamSchema, body: updateReferrerSchema })
  @ApiOperation({ summary: 'Modifie le pourcentage, les coordonnées ou retire un référent' })
  update(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof updateReferrerSchema>) {
    return this.referrers.update(auth, params.id, body);
  }

  @Get(':id/statement')
  @RequirePermission('referrer:read')
  @Validate({ params: idParamSchema, query: statementQuerySchema })
  @ApiOperation({ summary: 'Relevé mensuel : clients, colis, profit et commission (profit × pourcentage, jamais négatif)' })
  statement(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VQuery() query: z.infer<typeof statementQuerySchema>) {
    return this.referrers.statement(auth, params.id, query.month ?? new Date().toISOString().slice(0, 7));
  }

  @Post(':id/payouts')
  @RequirePermission('referrer:manage')
  @Validate({ params: idParamSchema, body: payCommissionSchema })
  @ApiOperation({ summary: 'Paie la commission d’un mois (montant figé, une seule fois par mois)' })
  pay(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof payCommissionSchema>) {
    return this.referrers.pay(auth, params.id, body);
  }
}

@ApiTags('Administration : référents')
@ApiBearerAuth()
@Controller('admin/customers')
export class CustomerReferrerController {
  constructor(private readonly referrers: ReferrersService) {}

  @Put(':id/referrer')
  @HttpCode(200)
  @RequirePermission('referrer:manage')
  @Validate({ params: idParamSchema, body: assignReferrerSchema })
  @ApiOperation({ summary: 'Rattache un client à un référent (null : détache)' })
  assign(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof assignReferrerSchema>) {
    return this.referrers.assign(auth, params.id, body.referrerId);
  }
}

@ApiTags('Administration : incidents')
@ApiBearerAuth()
@Controller('admin/claims')
export class ClaimCompensationController {
  constructor(private readonly referrers: ReferrersService) {}

  @Get(':id/compensation')
  @RequirePermission('claim:compensate')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Indemnité payée au client et remboursement du transporteur (jamais visibles du client)' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.referrers.getCompensation(auth, params.id);
  }

  @Put(':id/compensation')
  @HttpCode(200)
  @RequirePermission('claim:compensate')
  @Validate({ params: idParamSchema, body: compensationSchema })
  @ApiOperation({ summary: 'Enregistre l’indemnité et le remboursement ; le net alimente le profit du mois de paiement' })
  set(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof compensationSchema>) {
    return this.referrers.setCompensation(auth, params.id, body);
  }
}
