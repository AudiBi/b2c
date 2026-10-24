import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ConfigService } from '../config/config.module';
import { AppException } from '../common/errors';

const ISSUER = 'b2c-api';
const AUDIENCE = 'b2c';
const uuid = z.uuid();

export interface AccessClaims {
  userId: string;
  companyId: string;
  sessionId: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Secret opaque de 256 bits, en base64url. */
export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class TokenService {
  constructor(private readonly config: ConfigService) {}

  signAccess(claims: AccessClaims): { token: string; expiresIn: number } {
    const expiresIn = this.config.env.ACCESS_TOKEN_TTL_SECONDS;
    const token = jwt.sign({ cid: claims.companyId, sid: claims.sessionId }, this.config.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      subject: claims.userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn,
    });
    return { token, expiresIn };
  }

  verifyAccess(token: string): AccessClaims {
    try {
      const payload = jwt.verify(token, this.config.env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      }) as jwt.JwtPayload;
      const parsed = z
        .object({ sub: uuid, cid: uuid, sid: uuid })
        .safeParse(payload);
      if (!parsed.success) throw new Error('claims');
      return { userId: parsed.data.sub, companyId: parsed.data.cid, sessionId: parsed.data.sid };
    } catch {
      throw AppException.unauthorized('INVALID_TOKEN', "Jeton d'accès invalide ou expiré");
    }
  }

  /** Jeton de renouvellement : `<entreprise>.<session>.<secret>` ; seul le condensé du secret est stocké. */
  formatRefresh(companyId: string, sessionId: string, secret: string): string {
    return `${companyId}.${sessionId}.${secret}`;
  }

  parseRefresh(raw: string): { companyId: string; sessionId: string; secret: string } | null {
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [companyId, sessionId, secret] = parts;
    if (!uuid.safeParse(companyId).success || !uuid.safeParse(sessionId).success || secret.length < 20) return null;
    return { companyId, sessionId, secret };
  }

  /** Jeton à usage unique (vérification, réinitialisation, invitation) : `<entreprise>.<secret>`. */
  formatOneTime(companyId: string, secret: string): string {
    return `${companyId}.${secret}`;
  }

  parseOneTime(raw: string): { companyId: string; secret: string } | null {
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const [companyId, secret] = parts;
    if (!uuid.safeParse(companyId).success || secret.length < 20) return null;
    return { companyId, secret };
  }

  /** Comparaison en temps constant de deux condensés hexadécimaux. */
  hashesMatch(storedHash: string, secret: string): boolean {
    const expected = Buffer.from(storedHash, 'hex');
    const actual = Buffer.from(sha256(secret), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
