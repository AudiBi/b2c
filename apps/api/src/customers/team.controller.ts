import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { teamInviteSchema, teamMemberParamSchema, teamRoleChangeSchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody, VParams } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RateLimit, RequirePermission } from '../security/decorators';
import { TeamService } from './team.service';

/** Équipe d'un compte professionnel : réservée à son propriétaire (`team:manage_own`). */
@ApiTags('Espace client : équipe')
@ApiBearerAuth()
@Controller('me/team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermission('team:manage_own')
  @ApiOperation({ summary: "Membres de mon équipe (lecteurs et opérateurs) et limite" })
  list(@CurrentAuth() auth: AuthContext) {
    return this.team.list(auth);
  }

  @Get('activity')
  @RequirePermission('team:manage_own')
  @ApiOperation({ summary: "Historique des actions sur mon équipe (invitations, rôles, retraits)" })
  activity(@CurrentAuth() auth: AuthContext) {
    return this.team.activity(auth);
  }

  @Post()
  @RequirePermission('team:manage_own')
  @RateLimit({ name: 'team-invite', limit: 20, windowSeconds: 3600 })
  @Validate({ body: teamInviteSchema })
  @ApiOperation({ summary: 'Invite un membre (lecteur ou opérateur) : un lien d\'activation de 72 h lui est envoyé' })
  invite(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof teamInviteSchema>) {
    return this.team.invite(auth, body);
  }

  @Patch(':userId')
  @RequirePermission('team:manage_own')
  @Validate({ params: teamMemberParamSchema, body: teamRoleChangeSchema })
  @ApiOperation({ summary: "Change le rôle d'un membre (effet immédiat)" })
  changeRole(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof teamMemberParamSchema>, @VBody() body: z.infer<typeof teamRoleChangeSchema>) {
    return this.team.changeRole(auth, params.userId, body.role);
  }

  @Delete(':userId')
  @HttpCode(204)
  @RequirePermission('team:manage_own')
  @Validate({ params: teamMemberParamSchema })
  @ApiOperation({ summary: 'Retire un membre : sessions fermées, compte désactivé' })
  async remove(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof teamMemberParamSchema>) {
    await this.team.remove(auth, params.userId);
  }
}
