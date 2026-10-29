import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createCustomRoleSchema, roleCodeParamSchema, updateCustomRoleSchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody, VParams } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { RolesService } from './roles.service';

@ApiTags('Administration : rôles')
@ApiBearerAuth()
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('role:read')
  @ApiOperation({ summary: 'Rôles disponibles (système et personnalisés) et leurs permissions' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.roles.list(auth);
  }

  @Post()
  @RequirePermission('role:manage')
  @Validate({ body: createCustomRoleSchema })
  @ApiOperation({
    summary: 'Crée un rôle personnalisé',
    description: "Un nom, des permissions du personnel et une portée (entreprise, entrepôt ou agence). Anti-escalade : on ne peut donner que des droits qu'on détient soi-même.",
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createCustomRoleSchema>) {
    return this.roles.create(auth, body);
  }

  @Patch(':code')
  @RequirePermission('role:manage')
  @Validate({ params: roleCodeParamSchema, body: updateCustomRoleSchema })
  @ApiOperation({ summary: 'Modifie le nom, la description ou les permissions d\'un rôle personnalisé (effet immédiat pour ses titulaires)' })
  update(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof roleCodeParamSchema>, @VBody() body: z.infer<typeof updateCustomRoleSchema>) {
    return this.roles.update(auth, params.code, body);
  }

  @Delete(':code')
  @HttpCode(204)
  @RequirePermission('role:manage')
  @Validate({ params: roleCodeParamSchema })
  @ApiOperation({ summary: 'Supprime un rôle personnalisé qui n\'est attribué à personne' })
  async remove(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof roleCodeParamSchema>) {
    await this.roles.remove(auth, params.code);
  }
}
