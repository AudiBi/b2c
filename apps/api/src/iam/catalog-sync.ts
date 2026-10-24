import type { PrismaClient } from '@prisma/client';
import { PERMISSIONS, PLATFORM_COMPANY_ID, ROLE_DEFINITIONS } from '@b2c/shared';

export interface CatalogSyncResult {
  permissions: number;
  roles: number;
  rolePermissions: number;
}

/**
 * Synchronise la base avec le catalogue du code (packages/shared) : permissions, rôles système et leurs
 * permissions. Idempotent. À exécuter avec le rôle de MIGRATION (il contourne la RLS) : `npm run db:seed`.
 * Les permissions retirées du code sont retirées des rôles système ; les autres ne sont jamais supprimées
 * si des rôles personnalisés y font référence.
 */
export async function syncAccessCatalog(prisma: PrismaClient): Promise<CatalogSyncResult> {
  let rolePermissionCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
    }

    for (const definition of ROLE_DEFINITIONS) {
      const role = await tx.role.upsert({
        where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: definition.code } },
        update: { name: definition.name, description: definition.description, isSystem: true },
        create: {
          companyId: PLATFORM_COMPANY_ID,
          code: definition.code,
          name: definition.name,
          description: definition.description,
          isSystem: true,
        },
      });

      const wanted = new Set<string>(definition.permissions);
      const existing = await tx.rolePermission.findMany({ where: { roleId: role.id } });
      const stale = existing.filter((row) => !wanted.has(row.permissionCode)).map((row) => row.permissionCode);
      if (stale.length > 0) {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionCode: { in: stale } } });
      }
      const present = new Set(existing.map((row) => row.permissionCode));
      const missing = [...wanted].filter((code) => !present.has(code));
      if (missing.length > 0) {
        await tx.rolePermission.createMany({
          data: missing.map((permissionCode) => ({ roleId: role.id, permissionCode, companyId: PLATFORM_COMPANY_ID })),
        });
      }
      rolePermissionCount += wanted.size;
    }

    // Permissions disparues du catalogue : supprimées si plus aucun rôle ne s'y réfère.
    const known = Object.keys(PERMISSIONS);
    await tx.permission.deleteMany({ where: { code: { notIn: known }, rolePermissions: { none: {} } } });
  });
  return { permissions: Object.keys(PERMISSIONS).length, roles: ROLE_DEFINITIONS.length, rolePermissions: rolePermissionCount };
}
