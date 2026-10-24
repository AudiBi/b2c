import { Injectable } from '@nestjs/common';
import { PermissionSet, type Grant, type Locale, type ScopeType } from '@b2c/shared';
import { DbService } from '../database/db.service';
import type { AccessClaims } from './token.service';
import type { AuthContext } from './auth.types';
import { AppException } from '../common/errors';

@Injectable()
export class AuthContextService {
  constructor(private readonly db: DbService) {}

  /**
   * Reconstruit le contexte de l'utilisateur à chaque requête depuis la base : la révocation d'une session,
   * la désactivation d'un compte, la suspension d'une entreprise et les changements de rôle sont donc
   * effectifs immédiatement, sans attendre l'expiration du jeton d'accès.
   */
  async load(claims: AccessClaims): Promise<AuthContext> {
    return this.db.run({ companyId: claims.companyId }, async (tx) => {
      const [session, user, company] = await Promise.all([
        tx.session.findUnique({ where: { id: claims.sessionId } }),
        tx.user.findUnique({
          where: { id: claims.userId },
          include: { userRoles: { include: { role: { include: { permissions: true } } } } },
        }),
        tx.company.findUnique({ where: { id: claims.companyId }, select: { status: true } }),
      ]);

      if (!session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= new Date()) {
        throw AppException.unauthorized('SESSION_ENDED', 'Session terminée');
      }
      if (!user || user.status !== 'ACTIVE') {
        throw AppException.unauthorized('ACCOUNT_INACTIVE', 'Compte inactif');
      }
      if (!company || company.status !== 'ACTIVE') {
        throw AppException.forbidden('COMPANY_SUSPENDED', 'Entreprise suspendue');
      }

      const grants: Grant[] = [];
      for (const assignment of user.userRoles) {
        for (const permission of assignment.role.permissions) {
          grants.push({
            permission: permission.permissionCode,
            scopeType: assignment.scopeType as ScopeType,
            scopeId: assignment.scopeId,
          });
        }
      }

      return {
        userId: user.id,
        companyId: user.companyId,
        sessionId: session.id,
        kind: user.kind,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: user.locale as Locale,
        emailVerified: user.emailVerifiedAt !== null,
        roles: user.userRoles.map((assignment) => ({
          userRoleId: assignment.id,
          roleCode: assignment.role.code,
          scopeType: assignment.scopeType as ScopeType,
          scopeId: assignment.scopeId,
        })),
        permissions: new PermissionSet(grants),
      };
    });
  }
}
