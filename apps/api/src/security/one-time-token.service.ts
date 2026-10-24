import { Injectable } from '@nestjs/common';
import type { TokenPurpose, VerificationToken } from '@prisma/client';
import type { Tx } from '../database/db.service';
import { randomSecret, sha256, TokenService } from './token.service';

export const TOKEN_TTL_MS = {
  EMAIL_VERIFY: 24 * 3600_000,
  PASSWORD_RESET: 3600_000,
  INVITE: 72 * 3600_000,
} satisfies Record<TokenPurpose, number>;

/** Jetons à usage unique envoyés par e-mail (vérification, réinitialisation, invitation). */
@Injectable()
export class OneTimeTokenService {
  constructor(private readonly tokens: TokenService) {}

  /** Crée un jeton et invalide les jetons non utilisés de même nature pour cet utilisateur. */
  async issue(tx: Tx, params: { companyId: string; userId: string; purpose: TokenPurpose }): Promise<string> {
    const now = new Date();
    await tx.verificationToken.updateMany({
      where: { userId: params.userId, purpose: params.purpose, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    const secret = randomSecret();
    await tx.verificationToken.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        purpose: params.purpose,
        tokenHash: sha256(secret),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[params.purpose]),
      },
    });
    return this.tokens.formatOneTime(params.companyId, secret);
  }

  /** Vérifie un jeton sans le consommer (évite un calcul de hachage coûteux pour un faux jeton). */
  async isValid(tx: Tx, secret: string, purposes: readonly TokenPurpose[]): Promise<boolean> {
    const row = await tx.verificationToken.findUnique({ where: { tokenHash: sha256(secret) } });
    return !!row && purposes.includes(row.purpose) && !row.usedAt && row.expiresAt > new Date();
  }

  /** Consomme le jeton de façon atomique : un seul appel concurrent réussit. */
  async consume(tx: Tx, secret: string, purposes: readonly TokenPurpose[]): Promise<VerificationToken | null> {
    const row = await tx.verificationToken.findUnique({ where: { tokenHash: sha256(secret) } });
    if (!row || !purposes.includes(row.purpose) || row.usedAt || row.expiresAt <= new Date()) return null;
    const updated = await tx.verificationToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return updated.count === 1 ? row : null;
  }
}
