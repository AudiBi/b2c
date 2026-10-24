import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PLATFORM_COMPANY_ID } from '@b2c/shared';
import { DbService } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';

@ApiTags('Administration : rôles')
@ApiBearerAuth()
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission('role:read')
  @ApiOperation({ summary: 'Rôles disponibles et leurs permissions' })
  async list(@CurrentAuth() auth: AuthContext) {
    const roles = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.role.findMany({ include: { permissions: true }, orderBy: { code: 'asc' } }),
    );
    const inPlatform = auth.companyId === PLATFORM_COMPANY_ID;
    return roles
      // Les rôles de l'équipe plateforme ne sont pas proposés aux entreprises, et inversement.
      .filter((role) => (role.code === 'SUPER_ADMIN') === inPlatform)
      .map((role) => ({
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.permissions.map((p) => p.permissionCode).sort(),
      }));
  }
}
