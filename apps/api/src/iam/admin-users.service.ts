import { Injectable } from '@nestjs/common';
import type { Prisma, Role, User, UserRole } from '@prisma/client';
import {
  PLATFORM_COMPANY_ID,
  ROLE_BY_CODE,
  type CreateStaffInput,
  type Locale,
  type RoleAssignmentInput,
  type RoleCode,
  type listUsersQuerySchema,
} from '@b2c/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService, type Tx } from '../database/db.service';
import { MailService } from '../mail/mail.service';
import type { AuthContext } from '../security/auth.types';
import { OneTimeTokenService } from '../security/one-time-token.service';
import { checkAssignment, LAST_HOLDER_ROLES, scopeKeyOf } from './role-rules';

type UserWithRoles = User & { userRoles: (UserRole & { role: Role })[] };

export function toUserDto(user: UserWithRoles) {
  return {
    id: user.id,
    kind: user.kind,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    businessName: user.businessName,
    phone: user.phone,
    locale: user.locale,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    roles: user.userRoles.map((assignment) => ({
      userRoleId: assignment.id,
      roleCode: assignment.role.code,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
    })),
  };
}

const withRoles = { userRoles: { include: { role: true } } } satisfies Prisma.UserInclude;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly oneTime: OneTimeTokenService,
  ) {}

  async list(auth: AuthContext, query: z.infer<typeof listUsersQuerySchema>) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.user.findMany({
        where: {
          kind: query.kind,
          status: query.status,
          ...(query.q
            ? {
                OR: [
                  { email: { contains: query.q.toLowerCase() } },
                  { firstName: { contains: query.q, mode: 'insensitive' } },
                  { lastName: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        include: withRoles,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map(toUserDto), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  async get(auth: AuthContext, userId: string) {
    const user = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.user.findUnique({ where: { id: userId }, include: withRoles }),
    );
    if (!user) throw AppException.notFound('USER_NOT_FOUND', 'Utilisateur introuvable');
    return toUserDto(user);
  }

  /** Invite un membre du personnel : le compte reste PENDING jusqu'à ce qu'il choisisse son mot de passe. */
  async createStaff(auth: AuthContext, input: CreateStaffInput) {
    const kind = auth.companyId === PLATFORM_COMPANY_ID ? 'PLATFORM' : 'STAFF';
    for (const assignment of input.roles) checkAssignment(auth, kind, assignment);

    const created = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const duplicate = await tx.user.findUnique({
        where: { companyId_email: { companyId: auth.companyId, email: input.email } },
      });
      if (duplicate) throw AppException.conflict('EMAIL_ALREADY_USED', 'Cette adresse est déjà utilisée');

      const user = await tx.user.create({
        data: {
          companyId: auth.companyId,
          kind,
          email: input.email,
          phone: input.phone,
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale,
          status: 'PENDING',
        },
      });
      for (const assignment of input.roles) await this.attachRole(tx, auth, user.id, assignment);
      const rawToken = await this.oneTime.issue(tx, { companyId: auth.companyId, userId: user.id, purpose: 'INVITE' });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'user.invited',
        entityType: 'user',
        entityId: user.id,
        after: { email: user.email, roles: input.roles.map((r) => r.roleCode) },
      });
      const full = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: withRoles });
      return { dto: toUserDto(full), rawToken };
    });

    await this.mail.sendAuthMail('invite', input.email, input.locale as Locale, {
      firstName: input.firstName,
      url: `${this.config.env.ADMIN_PUBLIC_URL}/accept-invite?token=${encodeURIComponent(created.rawToken)}`,
    });
    return created.dto;
  }

  async assignRole(auth: AuthContext, userId: string, assignment: RoleAssignmentInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw AppException.notFound('USER_NOT_FOUND', 'Utilisateur introuvable');
      checkAssignment(auth, user.kind, assignment);
      await this.attachRole(tx, auth, userId, assignment);
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'role.assigned',
        entityType: 'user',
        entityId: userId,
        after: { roleCode: assignment.roleCode, scopeType: assignment.scopeType, scopeId: assignment.scopeId },
      });
      return toUserDto(await tx.user.findUniqueOrThrow({ where: { id: userId }, include: withRoles }));
    });
  }

  async removeRole(auth: AuthContext, userId: string, userRoleId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.lockAdministrators(tx, auth.companyId);
      const assignment = await tx.userRole.findFirst({
        where: { id: userRoleId, userId },
        include: { role: true, user: true },
      });
      if (!assignment) throw AppException.notFound('ROLE_ASSIGNMENT_NOT_FOUND', "Attribution introuvable");

      // On ne peut retirer que des droits qu'on détient soi-même (même règle que pour l'attribution).
      if (!this.actorCoversRole(auth, assignment.role.code)) throw AppException.forbidden('PRIVILEGE_ESCALATION', 'Vous ne détenez pas les droits de ce rôle');

      if (LAST_HOLDER_ROLES.includes(assignment.role.code) && assignment.user.status === 'ACTIVE') {
        const holders = await tx.userRole.count({ where: { roleId: assignment.roleId, user: { status: 'ACTIVE' } } });
        if (holders <= 1) {
          throw AppException.conflict('LAST_ADMINISTRATOR', 'Il doit rester au moins un administrateur actif');
        }
      }
      await tx.userRole.delete({ where: { id: assignment.id } });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'role.revoked',
        entityType: 'user',
        entityId: userId,
        before: { roleCode: assignment.role.code, scopeType: assignment.scopeType, scopeId: assignment.scopeId },
      });
      return toUserDto(await tx.user.findUniqueOrThrow({ where: { id: userId }, include: withRoles }));
    });
  }

  /** Désactive (et déconnecte) ou réactive un compte. On ne peut pas désactiver son propre compte. */
  async setDisabled(auth: AuthContext, userId: string, disabled: boolean) {
    if (disabled && userId === auth.userId) {
      throw AppException.badRequest('CANNOT_DISABLE_SELF', 'Vous ne pouvez pas désactiver votre propre compte');
    }
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.lockAdministrators(tx, auth.companyId);
      const user = await tx.user.findUnique({ where: { id: userId }, include: withRoles });
      if (!user) throw AppException.notFound('USER_NOT_FOUND', 'Utilisateur introuvable');

      if (disabled && user.status !== 'DISABLED') {
        for (const assignment of user.userRoles) {
          if (!LAST_HOLDER_ROLES.includes(assignment.role.code) || user.status !== 'ACTIVE') continue;
          const holders = await tx.userRole.count({ where: { roleId: assignment.roleId, user: { status: 'ACTIVE' } } });
          if (holders <= 1) {
            throw AppException.conflict('LAST_ADMINISTRATOR', 'Il doit rester au moins un administrateur actif');
          }
        }
      }
      const nextStatus = disabled ? 'DISABLED' : user.emailVerifiedAt ? 'ACTIVE' : 'PENDING';
      await tx.user.update({ where: { id: userId }, data: { status: nextStatus } });
      if (disabled) {
        await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: disabled ? 'user.disabled' : 'user.enabled',
        entityType: 'user',
        entityId: userId,
        before: { status: user.status },
        after: { status: nextStatus },
      });
      return toUserDto(await tx.user.findUniqueOrThrow({ where: { id: userId }, include: withRoles }));
    });
  }

  private async attachRole(tx: Tx, auth: AuthContext, userId: string, assignment: RoleAssignmentInput): Promise<void> {
    const role = await tx.role.findUnique({
      where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: assignment.roleCode } },
    });
    if (!role) throw new Error('Rôles système absents : exécuter npm run db:seed');
    // La portée doit désigner un objet qui existe dans CETTE entreprise (la RLS cache ceux des autres)
    if (assignment.scopeType === 'WAREHOUSE' || assignment.scopeType === 'AGENCY') {
      const exists =
        assignment.scopeType === 'WAREHOUSE'
          ? await tx.warehouse.findUnique({ where: { id: assignment.scopeId ?? '' }, select: { id: true } })
          : await tx.agency.findUnique({ where: { id: assignment.scopeId ?? '' }, select: { id: true } });
      if (!exists) throw AppException.badRequest('SCOPE_NOT_FOUND', assignment.scopeType === 'WAREHOUSE' ? 'Entrepôt introuvable' : 'Agence introuvable');
    }
    try {
      await tx.userRole.create({
        data: {
          companyId: auth.companyId,
          userId,
          roleId: role.id,
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeId ?? null,
          scopeKey: scopeKeyOf(assignment),
          createdBy: auth.userId,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw AppException.conflict('ROLE_ALREADY_ASSIGNED', 'Ce rôle est déjà attribué avec cette portée');
      }
      throw error;
    }
  }

  private actorCoversRole(auth: AuthContext, roleCode: string): boolean {
    const definition = ROLE_BY_CODE.get(roleCode as RoleCode);
    return !!definition && auth.permissions.coversCompanyWide(definition.permissions);
  }

  /** Sérialise les opérations qui peuvent retirer le dernier administrateur (verrou fondé sur l'entreprise). */
  private async lockAdministrators(tx: Tx, companyId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`administrators:${companyId}`}, 0))`;
  }
}
