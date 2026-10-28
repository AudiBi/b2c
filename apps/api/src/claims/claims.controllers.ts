import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { assignClaimSchema, claimMessageSchema, claimStatusSchema, createClaimSchema, idParamSchema, listClaimsQuerySchema, myClaimsQuerySchema } from '@b2c/shared';
import { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RateLimit, RequirePermission } from '../security/decorators';
import { ClaimsService } from './claims.service';

type Id = z.infer<typeof idParamSchema>;

@ApiTags('Réclamations (personnel)')
@ApiBearerAuth()
@Controller('admin/claims')
export class AdminClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @RequirePermission('claim:read')
  @Validate({ query: listClaimsQuerySchema })
  @ApiOperation({ summary: 'Réclamations (statut, catégorie, responsable, numéro ou code client)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listClaimsQuerySchema>) {
    return this.claims.list(auth, query);
  }

  @Get('assignees')
  @RequirePermission('claim:manage')
  @ApiOperation({ summary: 'Membres du personnel à qui affecter une réclamation' })
  assignees(@CurrentAuth() auth: AuthContext) {
    return this.claims.assignees(auth);
  }

  @Get(':id')
  @RequirePermission('claim:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail et échanges, notes internes comprises' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.claims.get(auth, params.id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('claim:manage')
  @Validate({ params: idParamSchema, body: assignClaimSchema })
  @ApiOperation({ summary: 'Affecte (ou libère) la réclamation' })
  assign(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof assignClaimSchema>) {
    return this.claims.assign(auth, params.id, body.userId);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @RequirePermission('claim:manage')
  @Validate({ params: idParamSchema, body: claimMessageSchema })
  @ApiOperation({ summary: 'Répond au client, ou ajoute une note interne (`internal: true`, jamais montrée au client)' })
  reply(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof claimMessageSchema>) {
    return this.claims.reply(auth, params.id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('claim:manage')
  @Validate({ params: idParamSchema, body: claimStatusSchema })
  @ApiOperation({ summary: 'Change l’état ; une clôture (résolue ou rejetée) exige une résolution', description: 'Le client est prévenu (claim.updated).' })
  status(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof claimStatusSchema>) {
    return this.claims.setStatus(auth, params.id, body);
  }
}

@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me/claims')
export class PortalClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @RequirePermission('claim:read_own')
  @Validate({ query: myClaimsQuerySchema })
  @ApiOperation({ summary: 'Mes réclamations' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof myClaimsQuerySchema>) {
    return this.claims.listMine(auth, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('claim:create_own')
  @Validate({ body: createClaimSchema })
  @RateLimit({ name: 'claim-create', limit: 20, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Ouvre une réclamation (éventuellement sur un de mes colis)' })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createClaimSchema>) {
    return this.claims.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('claim:read_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Ma réclamation et ses échanges (sans les notes internes)' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.claims.getMine(auth, params.id);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @RequirePermission('claim:create_own')
  @Validate({ params: idParamSchema, body: z.strictObject({ body: claimMessageSchema.shape.body }) })
  @RateLimit({ name: 'claim-message', limit: 60, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Ajoute un message à ma réclamation (tant qu’elle n’est pas clôturée)' })
  reply(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: { body: string }) {
    return this.claims.replyAsCustomer(auth, params.id, body.body);
  }
}
