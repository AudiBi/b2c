import { PLATFORM_COMPANY_ID, ROLE_BY_CODE, isCustomRoleCode, type RoleAssignmentInput, type ScopeType } from '@b2c/shared';
import type { UserKind } from '@prisma/client';
import { AppException } from '../common/errors';
import type { Tx } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';

/** Rôles dont il doit toujours rester au moins un titulaire actif. */
export const LAST_HOLDER_ROLES = ['COMPANY_ADMIN', 'SUPER_ADMIN'];

/** Un rôle tel que l'attribution le voit : défini dans le code (système) ou créé par l'entreprise (personnalisé, en base). */
export interface ResolvedRole {
  code: string;
  name: string;
  audience: 'PLATFORM' | 'STAFF' | 'CUSTOMER';
  allowedScopes: readonly ScopeType[];
  permissions: readonly string[];
  custom: boolean;
}

/**
 * Retrouve un rôle par son code. Un rôle système vient du catalogue partagé ; un rôle personnalisé n'existe QUE dans l'entreprise
 * qui l'a créé (la RLS cache ceux des autres, le code est donc inutilisable ailleurs).
 */
export async function resolveRole(tx: Tx, companyId: string, code: string): Promise<ResolvedRole> {
  if (isCustomRoleCode(code)) {
    if (companyId === PLATFORM_COMPANY_ID) throw AppException.badRequest('ROLE_NOT_ASSIGNABLE', 'Ce rôle ne peut pas être attribué ici');
    const row = await tx.role.findUnique({ where: { companyId_code: { companyId, code } }, include: { permissions: true } });
    if (!row || row.isSystem) throw AppException.badRequest('UNKNOWN_ROLE', 'Rôle inconnu');
    return {
      code: row.code,
      name: row.name,
      audience: 'STAFF',
      allowedScopes: [row.scopeType as ScopeType],
      permissions: row.permissions.map((p) => p.permissionCode),
      custom: true,
    };
  }
  const definition = ROLE_BY_CODE.get(code as never);
  if (!definition) throw AppException.badRequest('UNKNOWN_ROLE', 'Rôle inconnu');
  return { code: definition.code, name: definition.name, audience: definition.audience, allowedScopes: definition.allowedScopes, permissions: definition.permissions, custom: false };
}

/**
 * Contrôles à appliquer avant d'attribuer un rôle :
 *  1. le rôle correspond au type d'entreprise (plateforme / entreprise cliente) ;
 *  2. il convient au type de compte cible (personnel, plateforme) : les rôles client s'obtiennent par inscription ;
 *  3. la portée demandée est autorisée pour ce rôle ;
 *  4. anti-escalade : on ne peut attribuer que des permissions qu'on détient soi-même sur toute l'entreprise.
 */
export function checkAssignment(actor: AuthContext, targetKind: UserKind, assignment: RoleAssignmentInput, definition: ResolvedRole): ResolvedRole {
  const inPlatform = actor.companyId === PLATFORM_COMPANY_ID;
  const expectedAudience = inPlatform ? 'PLATFORM' : 'STAFF';
  if (definition.audience !== expectedAudience) {
    throw AppException.badRequest('ROLE_NOT_ASSIGNABLE', 'Ce rôle ne peut pas être attribué ici');
  }
  const expectedKind: UserKind = inPlatform ? 'PLATFORM' : 'STAFF';
  if (targetKind !== expectedKind) {
    throw AppException.badRequest('ROLE_NOT_ASSIGNABLE', "Ce rôle ne convient pas à ce type de compte");
  }
  if (!definition.allowedScopes.includes(assignment.scopeType)) {
    throw AppException.badRequest(
      'INVALID_SCOPE',
      `Portée non autorisée pour ce rôle (autorisées : ${definition.allowedScopes.join(', ')})`,
    );
  }
  if (!actor.permissions.coversCompanyWide(definition.permissions)) {
    throw AppException.forbidden('PRIVILEGE_ESCALATION', 'Vous ne pouvez pas attribuer des droits que vous ne détenez pas');
  }
  return definition;
}

export function scopeKeyOf(assignment: RoleAssignmentInput): string {
  return assignment.scopeType === 'COMPANY' ? 'COMPANY' : `${assignment.scopeType}:${assignment.scopeId}`;
}
