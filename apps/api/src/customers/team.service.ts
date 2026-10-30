import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { PLATFORM_COMPANY_ID, TEAM_MAX_MEMBERS, TEAM_ROLES, type Locale, type TeamInviteInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService, type Tx } from '../database/db.service';
import { MailService } from '../mail/mail.service';
import type { AuthContext } from '../security/auth.types';
import { OneTimeTokenService } from '../security/one-time-token.service';
import { CustomersService } from './customers.service';

type TeamRole = keyof typeof TEAM_ROLES;
const ROLE_OF_CODE = new Map<string, TeamRole>([
  [TEAM_ROLES.READER, 'READER'],
  [TEAM_ROLES.OPERATOR, 'OPERATOR'],
]);

/**
 * Équipe d'un compte client PROFESSIONNEL. Le propriétaire (seul détenteur de `team:manage_own`) invite, change le rôle et retire
 * des membres. Moindre privilège : un membre est « lecteur » (colis, factures, réclamations en lecture) ou « opérateur » (colis,
 * déclaration d'achats, réclamations) ; il n'accède jamais à l'argent, au code de remise, aux adresses, au profil ni à l'équipe.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly oneTime: OneTimeTokenService,
    private readonly customers: CustomersService,
  ) {}

  /** Compte professionnel dont l'appelant est le PROPRIÉTAIRE (un membre n'est jamais propriétaire). */
  private async owner(tx: Tx, auth: AuthContext): Promise<Customer> {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    if (await tx.customerMember.findUnique({ where: { userId: auth.userId } })) {
      throw AppException.forbidden('OWNER_ONLY', 'Seul le propriétaire du compte gère l’équipe');
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const customer = await this.customers.ensureCustomer(tx, user, 'BUSINESS');
    if (customer.customerType !== 'BUSINESS') throw AppException.forbidden('BUSINESS_ONLY', 'Réservé aux comptes professionnels');
    return customer;
  }

  /**
   * Ajouter ou promouvoir quelqu'un donne accès aux données du compte : le propriétaire doit avoir activé la double authentification
   * (comme le personnel, selon `REQUIRE_STAFF_2FA`). Retirer un membre reste toujours possible.
   */
  private requireOwnerMfa(auth: AuthContext): void {
    if (this.config.env.REQUIRE_STAFF_2FA && !auth.totpEnabled) {
      throw AppException.forbidden('TOTP_ENROLLMENT_REQUIRED', 'Activez la double authentification pour gérer votre équipe');
    }
  }

  private dto(member: { userId: string; createdAt: Date; user: { firstName: string; lastName: string; email: string; status: string; lastLoginAt: Date | null; userRoles: { role: { code: string } }[] } }) {
    const code = member.user.userRoles.map((r) => r.role.code).find((c) => ROLE_OF_CODE.has(c));
    return {
      userId: member.userId,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      email: member.user.email,
      status: member.user.status,
      role: code ? ROLE_OF_CODE.get(code)! : null,
      lastLoginAt: member.user.lastLoginAt,
      createdAt: member.createdAt,
    };
  }

  private readonly include = { user: { include: { userRoles: { include: { role: true } } } } } as const;

  async list(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const owner = await this.owner(tx, auth);
      const members = await tx.customerMember.findMany({ where: { customerId: owner.id }, include: this.include, orderBy: { createdAt: 'asc' } });
      return { limit: TEAM_MAX_MEMBERS, items: members.map((m) => this.dto(m)) };
    });
  }

  /** Historique des actions sur l'équipe (invitations, changements de rôle, retraits), les plus récentes d'abord. */
  async activity(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const owner = await this.owner(tx, auth);
      const rows = await tx.auditLog.findMany({
        where: { companyId: auth.companyId, entityType: 'customer', entityId: owner.id, action: { startsWith: 'team.' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return {
        items: rows.map((row) => {
          const data = ((row.after ?? row.before) ?? {}) as { email?: string; role?: string; roles?: string[] };
          return { id: row.id, action: row.action, at: row.createdAt, email: data.email ?? null, role: data.role ?? null };
        }),
      };
    });
  }

  async invite(auth: AuthContext, input: TeamInviteInput) {
    this.requireOwnerMfa(auth);
    const created = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const owner = await this.owner(tx, auth);
      await this.lock(tx, owner.id);
      if ((await tx.customerMember.count({ where: { customerId: owner.id } })) >= TEAM_MAX_MEMBERS) {
        throw AppException.conflict('TEAM_FULL', `Au plus ${TEAM_MAX_MEMBERS} membres dans l'équipe`);
      }
      const role = await this.systemRole(tx, input.role);

      const existing = await tx.user.findUnique({ where: { companyId_email: { companyId: auth.companyId, email: input.email } } });
      let userId: string;
      if (!existing) {
        userId = (await tx.user.create({
          data: { companyId: auth.companyId, kind: 'CUSTOMER', email: input.email, firstName: input.firstName, lastName: input.lastName, locale: input.locale, status: 'PENDING' },
        })).id;
      } else {
        // Seul un ancien membre RETIRÉ peut être réinvité ; toute autre adresse déjà connue est refusée
        const reusable =
          existing.kind === 'CUSTOMER' &&
          existing.status === 'DISABLED' &&
          !(await tx.customer.findUnique({ where: { userId: existing.id } })) &&
          !(await tx.customerMember.findUnique({ where: { userId: existing.id } }));
        if (!reusable) throw AppException.conflict('EMAIL_ALREADY_USED', 'Cette adresse est déjà utilisée');
        await tx.userRole.deleteMany({ where: { userId: existing.id } });
        await tx.user.update({ where: { id: existing.id }, data: { status: 'PENDING', firstName: input.firstName, lastName: input.lastName, locale: input.locale } });
        userId = existing.id;
      }
      const member = await tx.customerMember.create({ data: { companyId: auth.companyId, customerId: owner.id, userId, invitedBy: auth.userId } });
      await tx.userRole.create({ data: { companyId: auth.companyId, userId, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY', createdBy: auth.userId } });
      const rawToken = await this.oneTime.issue(tx, { companyId: auth.companyId, userId, purpose: 'INVITE' });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'team.member_invited',
        entityType: 'customer',
        entityId: owner.id,
        after: { memberUserId: userId, email: input.email, role: input.role },
      });
      const full = await tx.customerMember.findUniqueOrThrow({ where: { id: member.id }, include: this.include });
      return { dto: this.dto(full), rawToken };
    });
    // Les membres (comptes clients) activent leur compte sur le SITE, pas sur le panel d'administration
    await this.mail.sendAuthMail('invite', input.email, input.locale as Locale, {
      firstName: input.firstName,
      url: `${this.config.env.WEB_PUBLIC_URL}/${input.locale}/accept-invite?token=${encodeURIComponent(created.rawToken)}`,
    });
    return created.dto;
  }

  async changeRole(auth: AuthContext, userId: string, roleKey: TeamRole) {
    this.requireOwnerMfa(auth);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const owner = await this.owner(tx, auth);
      await this.lock(tx, owner.id);
      const member = await this.member(tx, owner.id, userId);
      const role = await this.systemRole(tx, roleKey);
      const before = member.user.userRoles.map((r) => r.role.code);
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.create({ data: { companyId: auth.companyId, userId, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY', createdBy: auth.userId } });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'team.member_role_changed',
        entityType: 'customer',
        entityId: owner.id,
        before: { memberUserId: userId, roles: before },
        after: { memberUserId: userId, role: roleKey },
      });
      return this.dto(await tx.customerMember.findUniqueOrThrow({ where: { id: member.id }, include: this.include }));
    });
  }

  /** Retire un membre : appartenance et rôle supprimés, sessions fermées, compte désactivé (l'historique reste attribuable). */
  async remove(auth: AuthContext, userId: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const owner = await this.owner(tx, auth);
      await this.lock(tx, owner.id);
      const member = await this.member(tx, owner.id, userId);
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.customerMember.delete({ where: { id: member.id } });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'team.member_removed',
        entityType: 'customer',
        entityId: owner.id,
        before: { memberUserId: userId, email: member.user.email, roles: member.user.userRoles.map((r) => r.role.code) },
      });
    });
  }

  /** Un membre DE CE COMPTE ; celui d'un autre compte est présenté comme inexistant. */
  private async member(tx: Tx, customerId: string, userId: string) {
    const member = await tx.customerMember.findFirst({ where: { customerId, userId }, include: this.include });
    if (!member) throw AppException.notFound('TEAM_MEMBER_NOT_FOUND', 'Membre introuvable');
    return member;
  }

  private async systemRole(tx: Tx, key: TeamRole) {
    const role = await tx.role.findUnique({ where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: TEAM_ROLES[key] } } });
    if (!role) throw new Error('Rôles système absents : exécuter npm run db:seed');
    return role;
  }

  private async lock(tx: Tx, customerId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`team:${customerId}`}, 0))`;
  }
}
