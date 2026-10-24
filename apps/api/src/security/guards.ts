import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppException } from '../common/errors';
import { setActor } from '../common/request-context';
import { RateLimiter } from '../redis/rate-limiter.service';
import { AuthContextService } from './auth-context.service';
import type { AuthContext } from './auth.types';
import {
  ANY_AUTHENTICATED,
  IS_PUBLIC,
  RATE_LIMIT,
  REQUIRED_PERMISSIONS,
  type RateLimitOptions,
} from './decorators';
import { TokenService } from './token.service';

const DEFAULT_LIMIT: RateLimitOptions = { name: 'global', limit: 300, windowSeconds: 60 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const override = this.reflector.getAllAndOverride<Partial<RateLimitOptions> | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (override?.skip) return true;
    const options = { ...DEFAULT_LIMIT, ...override } as RateLimitOptions;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    try {
      const { count, retryAfter } = await this.limiter.hit(`rl:${options.name}:${req.ip ?? 'inconnue'}`, options.windowSeconds);
      res.setHeader('X-RateLimit-Limit', String(options.limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.limit - count)));
      if (count > options.limit) {
        throw AppException.tooManyRequests('RATE_LIMITED', 'Trop de requêtes, réessayez plus tard', retryAfter);
      }
      return true;
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.error(`Limiteur indisponible : ${(error as Error).message}`);
      if (options.failClosed) {
        throw new AppException(503, 'RATE_LIMITER_UNAVAILABLE', 'Service temporairement indisponible');
      }
      return true;
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly contexts: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) throw AppException.unauthorized('UNAUTHENTICATED', 'Authentification requise');

    const claims = this.tokens.verifyAccess(match[1]);
    const auth: AuthContext = await this.contexts.load(claims);
    req.auth = auth;
    setActor(auth.userId);
    return true;
  }
}

/**
 * Refuse par défaut : une route non publique doit déclarer soit @RequirePermission(...), soit
 * @AnyAuthenticated(). Une route sans déclaration est refusée même à un utilisateur connecté.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth) throw AppException.unauthorized('UNAUTHENTICATED', 'Authentification requise');

    if (this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets)) return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (!required || required.length === 0) {
      throw AppException.forbidden('ROUTE_NOT_CONFIGURED', "Aucune règle d'accès déclarée pour cette route");
    }
    const missing = required.filter((permission) => !auth.permissions.has(permission));
    if (missing.length > 0) {
      throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante');
    }
    return true;
  }
}
