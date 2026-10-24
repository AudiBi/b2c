import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createStaffSchema,
  idParamSchema,
  listUsersQuerySchema,
  roleAssignmentSchema,
  userRoleParamSchema,
} from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { AdminUsersService } from './admin-users.service';

@ApiTags('Administration : utilisateurs')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @RequirePermission('user:read')
  @Validate({ query: listUsersQuerySchema })
  @ApiOperation({ summary: "Liste les utilisateurs de l'entreprise (pagination par curseur)" })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listUsersQuerySchema>) {
    return this.users.list(auth, query);
  }

  @Get(':id')
  @RequirePermission('user:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail d\'un utilisateur de l\'entreprise' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.users.get(auth, params.id);
  }

  @Post()
  @RequirePermission('user:create')
  @Validate({ body: createStaffSchema })
  @ApiOperation({
    summary: 'Invite un membre du personnel',
    description: 'Le compte est créé en attente ; un lien d\'activation (72 h) est envoyé par e-mail. Anti-escalade : les rôles attribués ne doivent pas dépasser vos propres droits.',
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createStaffSchema>) {
    return this.users.createStaff(auth, body);
  }

  @Post(':id/roles')
  @RequirePermission('role:assign')
  @Validate({ params: idParamSchema, body: roleAssignmentSchema })
  @ApiOperation({ summary: 'Attribue un rôle (avec sa portée) à un utilisateur' })
  assign(
    @CurrentAuth() auth: AuthContext,
    @VParams() params: z.infer<typeof idParamSchema>,
    @VBody() body: z.infer<typeof roleAssignmentSchema>,
  ) {
    return this.users.assignRole(auth, params.id, body);
  }

  @Delete(':id/roles/:userRoleId')
  @RequirePermission('role:assign')
  @Validate({ params: userRoleParamSchema })
  @ApiOperation({ summary: 'Retire une attribution de rôle' })
  revoke(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof userRoleParamSchema>) {
    return this.users.removeRole(auth, params.id, params.userRoleId);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermission('user:disable')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Désactive un compte et révoque ses sessions' })
  disable(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.users.setDisabled(auth, params.id, true);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermission('user:disable')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Réactive un compte désactivé' })
  enable(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.users.setDisabled(auth, params.id, false);
  }
}
