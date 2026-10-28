import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import {
  PLATFORM_COMPANY_ID,
  PLATFORM_COMPANY_SLUG,
  type Locale,
  type LoginInput,
  type RegisterInput,
} from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService, type Tx } from '../database/db.service';
import { MailService } from '../mail/mail.service';
import { CompanyDirectory } from '../platform/company-directory.service';
import { RateLimiter } from '../redis/rate-limiter.service';
import type { AuthContext } from '../security/auth.types';
import { OneTimeTokenService } from '../security/one-time-token.service';
import { PasswordService } from '../security/password.service';
import { randomSecret, sha256, TokenService } from '../security/token.service';
import { TwoFactorService } from './two-factor.service';

const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface SessionTokens {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  user: UserSummary;
}

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  kind: User['kind'];
  locale: Locale;
  emailVerified: boolean;
}

export type RefreshOutcome =
  | { kind: 'ok'; tokens: SessionTokens }
  | { kind: 'invalid' }
  | { kind: 'reuse' };

function summarize(user: User): UserSummary {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    kind: user.kind,
    locale: user.locale as Locale,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly oneTime: OneTimeTokenService,
    private readonly limiter: RateLimiter,
    private readonly companies: CompanyDirectory,
    private readonly customers: CustomersService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Inscription et vérification de l'e-mail
  // ---------------------------------------------------------------------------------------------

  /** Réponse identique que l'adresse soit déjà utilisée ou non : aucune énumération de comptes. */
  async register(input: RegisterInput): Promise<void> {
    const company = await this.companies.findBySlug(input.companySlug);
    if (!company || company.id === PLATFORM_COMPANY_ID || company.status !== 'ACTIVE') {
      throw AppException.notFound('COMPANY_NOT_FOUND', 'Entreprise introuvable');
    }
    const passwordHash = await this.passwords.hash(input.password);
    const roleCode = input.accountType === 'BUSINESS' ? 'CUSTOMER_BUSINESS' : 'CUSTOMER_INDIVIDUAL';

    let outcome: { created: true; rawToken: string } | { created: false; firstName: string; locale: Locale };
    try {
      outcome = await this.db.run({ companyId: company.id }, async (tx) => {
        const existing = await tx.user.findUnique({
          where: { companyId_email: { companyId: company.id, email: input.email } },
        });
        if (existing) return { created: false as const, firstName: existing.firstName, locale: existing.locale as Locale };

        const role = await tx.role.findUnique({
          where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: roleCode } },
        });
        if (!role) throw new Error('Rôles système absents : exécuter npm run db:seed');

        const user = await tx.user.create({
          data: {
            companyId: company.id,
            kind: 'CUSTOMER',
            email: input.email,
            phone: input.phone,
            firstName: input.firstName,
            lastName: input.lastName,
            businessName: input.businessName,
            passwordHash,
            passwordChangedAt: new Date(),
            locale: input.locale,
            status: 'PENDING',
          },
        });
        await tx.userRole.create({
          data: { companyId: company.id, userId: user.id, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY' },
        });
        await this.customers.ensureCustomer(tx, user, input.accountType);
        const rawToken = await this.oneTime.issue(tx, { companyId: company.id, userId: user.id, purpose: 'EMAIL_VERIFY' });
        await this.audit.record(tx, {
          companyId: company.id,
          action: 'auth.registered',
          entityType: 'user',
          entityId: user.id,
          actorUserId: user.id,
          after: { email: user.email, accountType: input.accountType, locale: input.locale },
        });
        return { created: true as const, rawToken };
      });
    } catch (error) {
      // Inscriptions simultanées avec la même adresse : la contrainte d'unicité en laisse passer une seule.
      if (!isUniqueViolation(error)) throw error;
      outcome = { created: false, firstName: input.firstName, locale: input.locale };
    }

    if (outcome.created) {
      await this.mail.sendAuthMail('verify-email', input.email, input.locale, {
        firstName: input.firstName,
        url: this.link('verify-email', outcome.rawToken, input.locale),
      });
    } else {
      await this.mail.sendAuthMail('already-registered', input.email, outcome.locale, { firstName: outcome.firstName });
    }
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const parsed = this.tokens.parseOneTime(rawToken);
    if (!parsed) throw this.invalidToken();
    const ok = await this.db.run({ companyId: parsed.companyId }, async (tx) => {
      const row = await this.oneTime.consume(tx, parsed.secret, ['EMAIL_VERIFY']);
      if (!row) return false;
      const user = await tx.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      });
      await this.audit.record(tx, {
        companyId: parsed.companyId,
        action: 'auth.email_verified',
        entityType: 'user',
        entityId: user.id,
        actorUserId: user.id,
      });
      return true;
    });
    if (!ok) throw this.invalidToken();
  }

  /** Réponse toujours identique. Limité à 3 envois par heure et par adresse. */
  async resendVerification(companySlug: string, email: string): Promise<void> {
    const company = await this.companies.findBySlug(companySlug);
    if (!company || company.id === PLATFORM_COMPANY_ID || company.status !== 'ACTIVE') return;
    if (!(await this.allowPerAddress('resend', company.id, email, 3))) return;

    const prepared = await this.db.run({ companyId: company.id }, async (tx) => {
      const user = await tx.user.findUnique({ where: { companyId_email: { companyId: company.id, email } } });
      if (!user || user.emailVerifiedAt || user.status === 'DISABLED') return null;
      const rawToken = await this.oneTime.issue(tx, { companyId: company.id, userId: user.id, purpose: 'EMAIL_VERIFY' });
      return { user, rawToken };
    });
    if (prepared) {
      await this.mail.sendAuthMail('verify-email', prepared.user.email, prepared.user.locale as Locale, {
        firstName: prepared.user.firstName,
        url: this.link('verify-email', prepared.rawToken, prepared.user.locale as Locale),
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Connexion, renouvellement, déconnexion
  // ---------------------------------------------------------------------------------------------

  async login(input: LoginInput, meta: ClientMeta): Promise<SessionTokens> {
    const slug = input.companySlug ?? PLATFORM_COMPANY_SLUG;
    const failKey = `login-fail:${slug}:${sha256(input.email)}`;

    const failures = await this.counter(() => this.limiter.current(failKey));
    if (failures >= LOGIN_MAX_FAILURES) {
      const wait = await this.counter(() => this.limiter.ttl(failKey));
      throw AppException.tooManyRequests('ACCOUNT_LOCKED', 'Trop de tentatives, réessayez plus tard', wait || LOGIN_LOCK_SECONDS);
    }

    const company = await this.companies.findBySlug(slug);
    const user = company
      ? await this.db.run({ companyId: company.id }, (tx) =>
          tx.user.findUnique({ where: { companyId_email: { companyId: company.id, email: input.email } } }),
        )
      : null;

    const passwordOk = await this.passwords.verifyOrDummy(user?.passwordHash, input.password);
    if (!company || !user || !passwordOk) {
      await this.recordLoginFailure(failKey, company?.id, user?.id, input.email);
      throw AppException.unauthorized('INVALID_CREDENTIALS', 'Identifiants incorrects');
    }
    if (company.status !== 'ACTIVE') {
      throw AppException.forbidden('COMPANY_SUSPENDED', 'Entreprise suspendue');
    }
    if (user.status === 'DISABLED') {
      throw AppException.forbidden('ACCOUNT_DISABLED', 'Compte désactivé');
    }
    if (!user.emailVerifiedAt) {
      throw AppException.forbidden('EMAIL_NOT_VERIFIED', "Adresse e-mail non confirmée");
    }

    // Double authentification : le mot de passe est correct, un second facteur est exigé (un code faux compte comme un échec)
    if (user.totpEnabledAt) {
      if (!input.totpCode && !input.recoveryCode) throw AppException.unauthorized('TOTP_REQUIRED', 'Code de double authentification requis');
      const proofOk = await this.db.run({ companyId: company.id }, (tx) => this.twoFactor.verifyProof(tx, user, input));
      if (!proofOk) {
        await this.recordLoginFailure(failKey, company.id, user.id, input.email);
        throw AppException.unauthorized('INVALID_TOTP', 'Code incorrect');
      }
    }

    const session = await this.db.run({ companyId: company.id }, async (tx) => {
      const created = await this.createSession(tx, { companyId: company.id, userId: user.id, familyId: uuidv7() }, meta);
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, {
        companyId: company.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        actorUserId: user.id,
        after: { sessionId: created.sessionId },
      });
      return created;
    });
    await this.counter(() => this.limiter.reset(failKey));
    return this.buildTokens(user, company.id, session);
  }

  /**
   * Échange un jeton de renouvellement contre un nouveau couple de jetons (rotation).
   * Un jeton déjà utilisé révoque toute la famille de sessions : l'un des deux porteurs est un attaquant.
   */
  async refresh(rawToken: string, meta: ClientMeta): Promise<RefreshOutcome> {
    const parsed = this.tokens.parseRefresh(rawToken);
    if (!parsed) return { kind: 'invalid' };

    const result = await this.db.run({ companyId: parsed.companyId }, async (tx): Promise<RefreshOutcome> => {
      const session = await tx.session.findUnique({ where: { id: parsed.sessionId } });
      if (!session || !this.tokens.hashesMatch(session.refreshHash, parsed.secret)) return { kind: 'invalid' };
      if (session.revokedAt || session.expiresAt <= new Date()) return { kind: 'invalid' };

      const claimed = session.rotatedAt
        ? { count: 0 }
        : await tx.session.updateMany({
            where: { id: session.id, rotatedAt: null, revokedAt: null },
            data: { rotatedAt: new Date() },
          });
      if (claimed.count !== 1) {
        await tx.session.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record(tx, {
          companyId: parsed.companyId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'user',
          entityId: session.userId,
          actorUserId: session.userId,
          after: { familyId: session.familyId },
        });
        return { kind: 'reuse' };
      }

      const [user, company] = await Promise.all([
        tx.user.findUnique({ where: { id: session.userId } }),
        tx.company.findUnique({ where: { id: parsed.companyId }, select: { status: true } }),
      ]);
      if (!user || user.status !== 'ACTIVE' || company?.status !== 'ACTIVE') return { kind: 'invalid' };

      const next = await this.createSession(
        tx,
        { companyId: parsed.companyId, userId: user.id, familyId: session.familyId },
        meta,
      );
      return { kind: 'ok', tokens: this.buildTokens(user, parsed.companyId, next) };
    });
    return result;
  }

  async logout(auth: AuthContext, allSessions: boolean): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const current = await tx.session.findUnique({ where: { id: auth.sessionId } });
      const where: Prisma.SessionWhereInput = allSessions
        ? { userId: auth.userId, revokedAt: null }
        : { familyId: current?.familyId ?? auth.sessionId, revokedAt: null };
      const revoked = await tx.session.updateMany({ where, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: allSessions ? 'auth.logout_all' : 'auth.logout',
        entityType: 'user',
        entityId: auth.userId,
        after: { sessionsRevoked: revoked.count },
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Mot de passe oublié / invitation
  // ---------------------------------------------------------------------------------------------

  /** Réponse toujours identique. Limité à 3 demandes par heure et par adresse. */
  async forgotPassword(companySlug: string | undefined, email: string): Promise<void> {
    const company = await this.companies.findBySlug(companySlug ?? PLATFORM_COMPANY_SLUG);
    if (!company || company.status !== 'ACTIVE') return;
    if (!(await this.allowPerAddress('forgot', company.id, email, 3))) return;

    const prepared = await this.db.run({ companyId: company.id }, async (tx) => {
      const user = await tx.user.findUnique({ where: { companyId_email: { companyId: company.id, email } } });
      if (!user || user.status === 'DISABLED') return null;
      const rawToken = await this.oneTime.issue(tx, { companyId: company.id, userId: user.id, purpose: 'PASSWORD_RESET' });
      await this.audit.record(tx, {
        companyId: company.id,
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
        actorUserId: user.id,
      });
      return { user, rawToken };
    });
    if (prepared) {
      await this.mail.sendAuthMail('reset-password', prepared.user.email, prepared.user.locale as Locale, {
        firstName: prepared.user.firstName,
        url: this.link('reset-password', prepared.rawToken, prepared.user.locale as Locale),
      });
    }
  }

  /** Sert aussi à activer un compte invité (jeton INVITE). Révoque toutes les sessions existantes. */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const parsed = this.tokens.parseOneTime(rawToken);
    if (!parsed) throw this.invalidToken();
    const purposes = ['PASSWORD_RESET', 'INVITE'] as const;

    const valid = await this.db.run({ companyId: parsed.companyId }, (tx) =>
      this.oneTime.isValid(tx, parsed.secret, purposes),
    );
    if (!valid) throw this.invalidToken();

    const passwordHash = await this.passwords.hash(newPassword);
    const ok = await this.db.run({ companyId: parsed.companyId }, async (tx) => {
      const row = await this.oneTime.consume(tx, parsed.secret, purposes);
      if (!row) return false;
      const now = new Date();
      const current = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          passwordChangedAt: now,
          // Avoir reçu le lien par e-mail prouve la maîtrise de l'adresse.
          emailVerifiedAt: current.emailVerifiedAt ?? now,
          status: current.status === 'PENDING' ? 'ACTIVE' : current.status,
        },
      });
      const revoked = await tx.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(tx, {
        companyId: parsed.companyId,
        action: row.purpose === 'INVITE' ? 'auth.invitation_accepted' : 'auth.password_reset',
        entityType: 'user',
        entityId: row.userId,
        actorUserId: row.userId,
        after: { sessionsRevoked: revoked.count },
      });
      return true;
    });
    if (!ok) throw this.invalidToken();
  }

  /**
   * Change le mot de passe de l'utilisateur connecté. Toutes les AUTRES sessions sont révoquées ;
   * la session courante reste ouverte. Limité à 5 tentatives par 15 minutes et par utilisateur.
   */
  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
    const key = `change-password:${auth.userId}`;
    const attempts = await this.counter(() => this.limiter.hit(key, LOGIN_LOCK_SECONDS));
    if (attempts.count > LOGIN_MAX_FAILURES) {
      throw AppException.tooManyRequests('TOO_MANY_ATTEMPTS', 'Trop de tentatives, réessayez plus tard', attempts.retryAfter);
    }
    const user = await this.db.run({ companyId: auth.companyId }, (tx) => tx.user.findUniqueOrThrow({ where: { id: auth.userId } }));
    if (!(await this.passwords.verifyOrDummy(user.passwordHash, currentPassword))) {
      throw AppException.badRequest('INVALID_CURRENT_PASSWORD', 'Mot de passe actuel incorrect');
    }
    if (newPassword === currentPassword) {
      throw AppException.badRequest('PASSWORD_UNCHANGED', "Le nouveau mot de passe doit être différent de l'ancien");
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const current = await tx.session.findUnique({ where: { id: auth.sessionId } });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
      const revoked = await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, ...(current ? { familyId: { not: current.familyId } } : {}) },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: user.id,
        after: { otherSessionsRevoked: revoked.count },
      });
    });
    await this.counter(() => this.limiter.reset(key));
  }

  // ---------------------------------------------------------------------------------------------
  // Outils internes
  // ---------------------------------------------------------------------------------------------

  private async createSession(
    tx: Tx,
    params: { companyId: string; userId: string; familyId: string },
    meta: ClientMeta,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const secret = randomSecret();
    const sessionId = uuidv7();
    const ttlMs = this.config.env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000;
    await tx.session.create({
      data: {
        id: sessionId,
        companyId: params.companyId,
        userId: params.userId,
        familyId: params.familyId,
        refreshHash: sha256(secret),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return { sessionId, refreshToken: this.tokens.formatRefresh(params.companyId, sessionId, secret) };
  }

  private buildTokens(user: User, companyId: string, session: { sessionId: string; refreshToken: string }): SessionTokens {
    const access = this.tokens.signAccess({ userId: user.id, companyId, sessionId: session.sessionId });
    return {
      accessToken: access.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
      refreshToken: session.refreshToken,
      user: summarize(user),
    };
  }

  private async recordLoginFailure(failKey: string, companyId?: string, userId?: string, email?: string): Promise<void> {
    await this.counter(() => this.limiter.hit(failKey, LOGIN_LOCK_SECONDS));
    if (!companyId) return;
    try {
      await this.db.run({ companyId }, (tx) =>
        this.audit.record(tx, {
          companyId,
          action: 'auth.login_failed',
          entityType: userId ? 'user' : undefined,
          entityId: userId,
          actorType: 'ANONYMOUS',
          after: { email },
        }),
      );
    } catch (error) {
      this.logger.error(`Audit de l'échec de connexion impossible : ${(error as Error).message}`);
    }
  }

  /** Limite d'envois par adresse (anti-bombardement d'e-mails). Redis indisponible => on n'envoie pas. */
  private async allowPerAddress(kind: string, companyId: string, email: string, max: number): Promise<boolean> {
    try {
      const { count } = await this.limiter.hit(`${kind}:${companyId}:${sha256(email)}`, 3600);
      return count <= max;
    } catch {
      return false;
    }
  }

  /** Les protections de connexion échouent « fermé » : sans Redis, pas de connexion. */
  private async counter<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error(`Compteur de sécurité indisponible : ${(error as Error).message}`);
      throw new AppException(503, 'SECURITY_BACKEND_UNAVAILABLE', 'Service temporairement indisponible');
    }
  }

  private invalidToken(): AppException {
    return AppException.badRequest('INVALID_TOKEN', 'Lien invalide ou expiré');
  }

  /** Lien vers le site, dans la langue de l'utilisateur : https://site/<langue>/<page>?token=… */
  private link(path: string, token: string, locale: Locale): string {
    return `${this.config.env.WEB_PUBLIC_URL}/${locale}/${path}?token=${encodeURIComponent(token)}`;
  }
}
