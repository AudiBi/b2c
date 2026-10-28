import { createParamDecorator, ExecutionContext, SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { PermissionCode } from '@b2c/shared';
import type { Request } from 'express';
import type { AuthContext } from './auth.types';

export const IS_PUBLIC = 'b2c:public';
export const REQUIRED_PERMISSIONS = 'b2c:permissions';
export const ANY_AUTHENTICATED = 'b2c:any-authenticated';
export const ALLOW_WITHOUT_MFA = 'b2c:allow-without-mfa';
export const RATE_LIMIT = 'b2c:rate-limit';

/** Route sans authentification (inscription, connexion, suivi public, santé…). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route réservée aux utilisateurs authentifiés détenant TOUTES les permissions listées. */
export const RequirePermission = (...permissions: PermissionCode[]) =>
  applyDecorators(SetMetadata(REQUIRED_PERMISSIONS, permissions), ApiExtension('x-permissions', permissions));

/** Route ouverte à tout utilisateur authentifié (profil, déconnexion). À utiliser explicitement. */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED, true);

/** Reste accessible à un compte du personnel dont la double authentification est obligatoire mais pas encore activée (activation, profil, déconnexion). */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);

export interface RateLimitOptions {
  /** Nom du compteur (une clé Redis par nom et par IP). */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Si Redis est indisponible : refuser (503) plutôt que laisser passer. */
  failClosed?: boolean;
  skip?: boolean;
}

export const RateLimit = (options: Omit<RateLimitOptions, 'skip'>) => SetMetadata(RATE_LIMIT, options);
export const SkipRateLimit = () => SetMetadata(RATE_LIMIT, { skip: true } satisfies Partial<RateLimitOptions>);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw new Error('CurrentAuth utilisé sur une route non authentifiée');
  return auth;
});
