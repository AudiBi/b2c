import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PLATFORM_COMPANY_ID, ROLE_DEFINITIONS, type CreateCustomRoleInput, type UpdateCustomRoleInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';

const MAX_CUSTOM_ROLES = 30;
const SYSTEM_BY_CODE = new Map(ROLE_DEFINITIONS.map((r) => [r.code as string, r]));

type RoleRow = Prisma.RoleGetPayload<{ include: { permissions: true; _count: { select: { userRoles: true } } } }>;
const include = { permissions: true, _count: { select: { userRoles: true } } } satisfies Prisma.RoleInclude;

/** Code d'un rôle personnalisé : généré ici (jamais saisi), sans accent, avec un suffixe aléatoire pour éviter toute collision. */
export function customRoleCode(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const suffix = Math.random().toString(16).slice(2, 8).padEnd(6, '0');
  return `custom-${slug || 'role'}-${suffix}`;
}

export function toRoleDto(row: RoleRow) {
  const system = SYSTEM_BY_CODE.get(row.code);
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    custom: !row.isSystem,
    /** Portées possibles d'une attribution : plusieurs pour un rôle système, une seule pour un rôle personnalisé. */
    allowedScopes: row.isSystem ? (system?.allowedScopes ?? ['COMPANY']) : [row.scopeType],
    permissions: row.permissions.map((p) => p.permissionCode).sort(),
    /** Nombre d'attributions dans CETTE entreprise. */
    holders: row._count.userRoles,
  };
}

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Rôles système (lus dans l'entreprise plateforme, adaptés au type d'entreprise) puis rôles personnalisés de l'entreprise. */
  async list(auth: AuthContext) {
    const inPlatform = auth.companyId === PLATFORM_COMPANY_ID;
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) => tx.role.findMany({ include, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] }));
    return rows
      // Les rôles de l'équipe plateforme ne sont pas proposés aux entreprises, et inversement.
      .filter((role) => !role.isSystem || (role.code === 'SUPER_ADMIN') === inPlatform)
      .map(toRoleDto);
  }

  async create(auth: AuthContext, input: CreateCustomRoleInput) {
    if (auth.companyId === PLATFORM_COMPANY_ID) throw AppException.badRequest('ROLE_NOT_ASSIGNABLE', "Les rôles personnalisés sont réservés aux entreprises");
    // Anti-escalade : on ne peut donner que des droits qu'on détient soi-même sur toute l'entreprise
    this.assertCovers(auth, input.permissions);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.lock(tx, auth.companyId);
      const existing = await tx.role.findMany({ where: { isSystem: false }, select: { name: true } });
      if (existing.length >= MAX_CUSTOM_ROLES) throw AppException.conflict('TOO_MANY_ROLES', `Au plus ${MAX_CUSTOM_ROLES} rôles personnalisés`);
      await this.assertNameFree(tx, input.name);
      const role = await tx.role.create({
        data: {
          companyId: auth.companyId,
          code: customRoleCode(input.name),
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          scopeType: input.scopeType,
        },
      });
      await tx.rolePermission.createMany({ data: input.permissions.map((permissionCode) => ({ roleId: role.id, permissionCode, companyId: auth.companyId })) });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'role.created',
        entityType: 'role',
        entityId: role.id,
        after: { code: role.code, name: input.name, scopeType: input.scopeType, permissions: [...input.permissions].sort() },
      });
      return toRoleDto(await tx.role.findUniqueOrThrow({ where: { id: role.id }, include }));
    });
  }

  async update(auth: AuthContext, code: string, input: UpdateCustomRoleInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.lock(tx, auth.companyId);
      const role = await this.customRole(tx, auth, code);
      const current = role.permissions.map((p) => p.permissionCode);
      // On ne modifie que des droits qu'on détient (ceux d'aujourd'hui comme ceux de demain)
      this.assertCovers(auth, current);
      if (input.permissions) this.assertCovers(auth, input.permissions);
      if (input.name && input.name !== role.name) await this.assertNameFree(tx, input.name, role.id);

      await tx.role.update({
        where: { id: role.id },
        data: { ...(input.name ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) },
      });
      if (input.permissions) {
        const next = new Set(input.permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionCode: { notIn: [...next] } } });
        const missing = [...next].filter((p) => !current.includes(p));
        if (missing.length) await tx.rolePermission.createMany({ data: missing.map((permissionCode) => ({ roleId: role.id, permissionCode, companyId: auth.companyId })) });
      }
      const updated = await tx.role.findUniqueOrThrow({ where: { id: role.id }, include });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'role.updated',
        entityType: 'role',
        entityId: role.id,
        before: { name: role.name, description: role.description, permissions: [...current].sort() },
        after: { name: updated.name, description: updated.description, permissions: updated.permissions.map((p) => p.permissionCode).sort() },
      });
      return toRoleDto(updated);
    });
  }

  async remove(auth: AuthContext, code: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.lock(tx, auth.companyId);
      const role = await this.customRole(tx, auth, code);
      this.assertCovers(auth, role.permissions.map((p) => p.permissionCode));
      if (role._count.userRoles > 0) throw AppException.conflict('ROLE_IN_USE', 'Ce rôle est encore attribué : retirez-le d’abord aux utilisateurs');
      await tx.role.delete({ where: { id: role.id } });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'role.deleted',
        entityType: 'role',
        entityId: role.id,
        before: { code: role.code, name: role.name, permissions: role.permissions.map((p) => p.permissionCode).sort() },
      });
    });
  }

  private assertCovers(auth: AuthContext, permissions: readonly string[]): void {
    if (!auth.permissions.coversCompanyWide(permissions)) {
      throw AppException.forbidden('PRIVILEGE_ESCALATION', 'Vous ne pouvez pas gérer des droits que vous ne détenez pas');
    }
  }

  /** Un rôle personnalisé de l'entreprise ; un rôle système est refusé explicitement, un code inconnu est un 404. */
  private async customRole(tx: Tx, auth: AuthContext, code: string): Promise<RoleRow> {
    if (SYSTEM_BY_CODE.has(code)) throw AppException.badRequest('ROLE_SYSTEM_READONLY', 'Un rôle système ne se modifie pas');
    const role = await tx.role.findUnique({ where: { companyId_code: { companyId: auth.companyId, code } }, include });
    if (!role || role.isSystem) throw AppException.notFound('ROLE_NOT_FOUND', 'Rôle introuvable');
    return role;
  }

  private async assertNameFree(tx: Tx, name: string, exceptId?: string): Promise<void> {
    const wanted = name.trim().toLowerCase();
    if ([...SYSTEM_BY_CODE.values()].some((r) => r.name.toLowerCase() === wanted)) throw AppException.conflict('ROLE_NAME_TAKEN', 'Ce nom est déjà utilisé par un rôle');
    const same = await tx.role.findFirst({ where: { isSystem: false, name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (same) throw AppException.conflict('ROLE_NAME_TAKEN', 'Ce nom est déjà utilisé par un rôle');
  }

  /** Sérialise les créations, modifications et suppressions de rôles d'une entreprise. */
  private async lock(tx: Tx, companyId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roles:${companyId}`}, 0))`;
  }
}
