import { PLATFORM_COMPANY_ID, ROLE_BY_CODE, type RoleAssignmentInput, type RoleDefinition } from '@b2c/shared';
import type { UserKind } from '@prisma/client';
import { AppException } from '../common/errors';
import type { AuthContext } from '../security/auth.types';

/** Rôles dont il doit toujours rester au moins un titulaire actif. */
export const LAST_HOLDER_ROLES = ['COMPANY_ADMIN', 'SUPER_ADMIN'];

/**
 * Contrôles à appliquer avant d'attribuer un rôle :
 *  1. le rôle existe et correspond au type d'entreprise (plateforme / entreprise cliente) ;
 *  2. il convient au type de compte cible (personnel, plateforme) : les rôles client s'obtiennent par inscription ;
 *  3. la portée demandée est autorisée pour ce rôle ;
 *  4. anti-escalade : on ne peut attribuer que des permissions qu'on détient soi-même sur toute l'entreprise.
 */
export function checkAssignment(
  actor: AuthContext,
  targetKind: UserKind,
  assignment: RoleAssignmentInput,
): RoleDefinition {
  const definition = ROLE_BY_CODE.get(assignment.roleCode);
  if (!definition) throw AppException.badRequest('UNKNOWN_ROLE', 'Rôle inconnu');

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
