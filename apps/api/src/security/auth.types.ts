import type { Locale, PermissionSet, ScopeType } from '@b2c/shared';
import type { UserKind } from '@prisma/client';

export interface AssignedRole {
  userRoleId: string;
  roleCode: string;
  scopeType: ScopeType;
  scopeId: string | null;
}

export interface AuthContext {
  userId: string;
  companyId: string;
  sessionId: string;
  kind: UserKind;
  email: string;
  firstName: string;
  lastName: string;
  locale: Locale;
  emailVerified: boolean;
  /** Double authentification active sur ce compte. */
  totpEnabled: boolean;
  roles: AssignedRole[];
  permissions: PermissionSet;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      validated?: { body?: any; query?: any; params?: any };
    }
  }
}
