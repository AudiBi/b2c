import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService, type Tx } from '../database/db.service';
import { RateLimiter } from '../redis/rate-limiter.service';
import type { AuthContext } from '../security/auth.types';
import { PasswordService } from '../security/password.service';
import { decryptSecret, encryptSecret, generateRecoveryCode, generateSecret, hashRecoveryCode, otpauthUri, verifyTotp } from '../security/totp';

const RECOVERY_CODE_COUNT = 10;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_SECONDS = 15 * 60;

export interface Proof {
  totpCode?: string;
  recoveryCode?: string;
}

/** Double authentification par mots de passe à usage unique (TOTP) et codes de secours. */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Clé de chiffrement des secrets : dédiée si elle est configurée (obligatoire en production), sinon dérivée du secret des jetons. */
  private get keyMaterial(): string {
    return this.config.env.TOTP_ENCRYPTION_KEY ?? this.config.env.JWT_ACCESS_SECRET;
  }

  /** Obligatoire pour le personnel et la plateforme quand la configuration l'exige. */
  isRequiredFor(kind: User['kind']): boolean {
    return this.config.env.REQUIRE_STAFF_2FA && kind !== 'CUSTOMER';
  }

  async status(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      const left = user.totpEnabledAt ? await tx.totpRecoveryCode.count({ where: { userId: user.id, usedAt: null } }) : 0;
      return {
        enabled: user.totpEnabledAt !== null,
        pending: user.totpEnabledAt === null && user.totpSecretEnc !== null,
        required: this.isRequiredFor(user.kind),
        recoveryCodesLeft: left,
      };
    });
  }

  private async throttle(userId: string): Promise<void> {
    const failures = await this.limiter.current(`2fa-fail:${userId}`);
    if (failures >= MAX_FAILURES) throw AppException.tooManyRequests('TOO_MANY_ATTEMPTS', 'Trop de tentatives, réessayez plus tard', await this.limiter.ttl(`2fa-fail:${userId}`));
  }

  private async fail(userId: string, code: string, message: string): Promise<never> {
    await this.limiter.hit(`2fa-fail:${userId}`, FAILURE_WINDOW_SECONDS);
    throw AppException.unauthorized(code, message);
  }

  private async checkPassword(tx: Tx, userId: string, password: string): Promise<User> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verifyOrDummy(user.passwordHash, password))) {
      await this.fail(userId, 'INVALID_CURRENT_PASSWORD', 'Mot de passe incorrect');
    }
    return user;
  }

  /** Démarre l'activation : génère un secret (non actif tant qu'un code valide n'a pas été saisi). */
  async setup(auth: AuthContext, password: string, renew = false) {
    await this.throttle(auth.userId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await this.checkPassword(tx, auth.userId, password);
      if (user.totpEnabledAt) throw AppException.conflict('TOTP_ALREADY_ENABLED', 'La double authentification est déjà active');
      // Une activation en cours garde sa clé : recliquer sur « Activer » ou recharger la page ne doit pas désaccorder l'application déjà configurée
      const pending = !renew && user.totpSecretEnc ? decryptSecret(user.totpSecretEnc, this.keyMaterial) : null;
      const secret = pending ?? generateSecret();
      if (!pending) {
        await tx.user.update({ where: { id: user.id }, data: { totpSecretEnc: encryptSecret(secret, this.keyMaterial), totpLastStep: null } });
      }
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { name: true } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'auth.2fa_setup_started', entityType: 'user', entityId: user.id, actorUserId: user.id });
      return { secret, otpauthUri: otpauthUri(secret, user.email, company.name) };
    });
  }

  /** Valide le premier code, active la double authentification et remet les codes de secours (montrés une seule fois). */
  async enable(auth: AuthContext, code: string) {
    await this.throttle(auth.userId);
    const result = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      if (user.totpEnabledAt) throw AppException.conflict('TOTP_ALREADY_ENABLED', 'La double authentification est déjà active');
      if (!user.totpSecretEnc) throw AppException.conflict('TOTP_SETUP_REQUIRED', "Démarrez d'abord l'activation");
      const step = verifyTotp(decryptSecret(user.totpSecretEnc, this.keyMaterial), code);
      if (step === null) return { ok: false as const };
      await tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
      const codes = await this.replaceRecoveryCodes(tx, auth.companyId, user.id);
      await this.audit.record(tx, { companyId: auth.companyId, action: 'auth.2fa_enabled', entityType: 'user', entityId: user.id, actorUserId: user.id });
      return { ok: true as const, codes };
    });
    if (!result.ok) return this.fail(auth.userId, 'INVALID_TOTP', 'Code incorrect');
    return { recoveryCodes: result.codes };
  }

  private async replaceRecoveryCodes(tx: Tx, companyId: string, userId: string): Promise<string[]> {
    await tx.totpRecoveryCode.deleteMany({ where: { userId } });
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    await tx.totpRecoveryCode.createMany({ data: codes.map((c) => ({ companyId, userId, codeHash: hashRecoveryCode(c, this.keyMaterial) })) });
    return codes;
  }

  /** Vérifie un code (application ou secours) pour un utilisateur déjà identifié. Un code ne sert qu'une fois. */
  async verifyProof(tx: Tx, user: User, proof: Proof): Promise<boolean> {
    if (!user.totpSecretEnc || !user.totpEnabledAt) return false;
    if (proof.totpCode) {
      const step = verifyTotp(decryptSecret(user.totpSecretEnc, this.keyMaterial), proof.totpCode, { lastUsedStep: user.totpLastStep === null ? null : Number(user.totpLastStep) });
      if (step === null) return false;
      // Compare-and-set : deux requêtes simultanées avec le même code ne passent pas toutes les deux
      const claimed = await tx.$executeRaw`UPDATE users SET totp_last_step = ${step} WHERE id = ${user.id}::uuid AND (totp_last_step IS NULL OR totp_last_step < ${step})`;
      return claimed === 1;
    }
    if (proof.recoveryCode) {
      const hash = hashRecoveryCode(proof.recoveryCode, this.keyMaterial);
      const used = await tx.totpRecoveryCode.updateMany({ where: { userId: user.id, codeHash: hash, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count === 1) {
        await this.audit.record(tx, { companyId: user.companyId, action: 'auth.recovery_code_used', entityType: 'user', entityId: user.id, actorUserId: user.id });
        return true;
      }
    }
    return false;
  }

  /** Désactivation : mot de passe + code ; refusée quand la politique l'impose à ce compte. */
  async disable(auth: AuthContext, input: { password: string } & Proof) {
    await this.throttle(auth.userId);
    const outcome = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await this.checkPasswordOrNull(tx, auth.userId, input.password);
      if (!user) return 'password' as const;
      if (!user.totpEnabledAt) throw AppException.conflict('TOTP_NOT_ENABLED', "La double authentification n'est pas active");
      if (this.isRequiredFor(user.kind)) throw AppException.conflict('TOTP_REQUIRED_BY_POLICY', 'La double authentification est obligatoire pour ce compte');
      if (!(await this.verifyProof(tx, user, input))) return 'code' as const;
      await tx.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } });
      await tx.totpRecoveryCode.deleteMany({ where: { userId: user.id } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'auth.2fa_disabled', entityType: 'user', entityId: user.id, actorUserId: user.id });
      return 'ok' as const;
    });
    if (outcome === 'password') return this.fail(auth.userId, 'INVALID_CURRENT_PASSWORD', 'Mot de passe incorrect');
    if (outcome === 'code') return this.fail(auth.userId, 'INVALID_TOTP', 'Code incorrect');
  }

  private async checkPasswordOrNull(tx: Tx, userId: string, password: string): Promise<User | null> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return (await this.passwords.verifyOrDummy(user.passwordHash, password)) ? user : null;
  }

  /** Nouveaux codes de secours (les anciens sont annulés) : mot de passe + code. */
  async regenerateRecoveryCodes(auth: AuthContext, input: { password: string } & Proof) {
    await this.throttle(auth.userId);
    const outcome = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await this.checkPasswordOrNull(tx, auth.userId, input.password);
      if (!user) return { kind: 'password' as const };
      if (!user.totpEnabledAt) throw AppException.conflict('TOTP_NOT_ENABLED', "La double authentification n'est pas active");
      if (!(await this.verifyProof(tx, user, input))) return { kind: 'code' as const };
      const codes = await this.replaceRecoveryCodes(tx, auth.companyId, user.id);
      await this.audit.record(tx, { companyId: auth.companyId, action: 'auth.2fa_recovery_codes_regenerated', entityType: 'user', entityId: user.id, actorUserId: user.id });
      return { kind: 'ok' as const, codes };
    });
    if (outcome.kind === 'password') return this.fail(auth.userId, 'INVALID_CURRENT_PASSWORD', 'Mot de passe incorrect');
    if (outcome.kind === 'code') return this.fail(auth.userId, 'INVALID_TOTP', 'Code incorrect');
    return { recoveryCodes: outcome.codes };
  }
}
