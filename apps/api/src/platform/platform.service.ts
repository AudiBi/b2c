import { Injectable } from '@nestjs/common';
import { PLATFORM_COMPANY_ID, type CreateCompanyInput, type Locale } from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService } from '../database/db.service';
import { MailService } from '../mail/mail.service';
import type { AuthContext } from '../security/auth.types';
import { OneTimeTokenService } from '../security/one-time-token.service';

/**
 * Opérations de la plateforme sur les entreprises. Ce service et CompanyDirectory sont les seuls à ouvrir
 * des transactions en mode plateforme (un test le vérifie). Il ne lit jamais de données métier d'une entreprise.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly oneTime: OneTimeTokenService,
  ) {}

  async createCompany(auth: AuthContext, input: CreateCompanyInput) {
    const companyId = uuidv7();
    let created;
    try {
      created = await this.db.run({ companyId: PLATFORM_COMPANY_ID, platform: true }, async (tx) => {
        const company = await tx.company.create({
          data: {
            id: companyId,
            name: input.name,
            slug: input.slug,
            trackingPrefix: input.trackingPrefix,
            customerCodePrefix: input.customerCodePrefix,
            defaultCurrency: input.defaultCurrency,
            defaultLocale: input.defaultLocale,
            paymentPolicy: input.paymentPolicy,
          },
        });

        // Écritures dans le contexte de la nouvelle entreprise (RLS), dans la même transaction.
        const rawToken = await this.db.withCompany(tx, PLATFORM_COMPANY_ID, companyId, async () => {
          const adminRole = await tx.role.findUnique({
            where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: 'COMPANY_ADMIN' } },
          });
          if (!adminRole) throw new Error('Rôles système absents : exécuter npm run db:seed');
          const admin = await tx.user.create({
            data: {
              companyId,
              kind: 'STAFF',
              email: input.adminEmail,
              firstName: input.adminFirstName,
              lastName: input.adminLastName,
              locale: input.defaultLocale,
              status: 'PENDING',
            },
          });
          await tx.userRole.create({
            data: { companyId, userId: admin.id, roleId: adminRole.id, scopeType: 'COMPANY', scopeKey: 'COMPANY', createdBy: auth.userId },
          });
          const token = await this.oneTime.issue(tx, { companyId, userId: admin.id, purpose: 'INVITE' });
          await this.audit.record(tx, {
            companyId,
            action: 'company.created',
            entityType: 'company',
            entityId: companyId,
            after: { name: input.name, slug: input.slug, adminEmail: input.adminEmail },
          });
          return token;
        });

        await this.audit.record(tx, {
          companyId: PLATFORM_COMPANY_ID,
          action: 'platform.company_created',
          entityType: 'company',
          entityId: companyId,
          after: { name: input.name, slug: input.slug },
        });
        return { company, rawToken };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict('COMPANY_ALREADY_EXISTS', 'Identifiant ou préfixe de suivi déjà utilisé');
      }
      throw error;
    }

    const url = `${this.config.env.ADMIN_PUBLIC_URL}/accept-invite?token=${encodeURIComponent(created.rawToken)}`;
    const sent = await this.mail.sendAuthMail('invite', input.adminEmail, input.defaultLocale, { firstName: input.adminFirstName, url });
    // L'entreprise EXISTE dans tous les cas. Si l'e-mail n'est pas parti, le super administrateur (de confiance) reçoit le lien pour le transmettre.
    return { ...this.toDto(created.company), invitation: sent ? { sent: true } : { sent: false, url } };
  }

  /** Renvoie l'invitation de l'administrateur d'une entreprise qui n'a pas encore activé son compte (nouveau lien, l'ancien est invalidé). */
  async resendAdminInvitation(auth: AuthContext, companyId: string) {
    if (companyId === PLATFORM_COMPANY_ID) throw AppException.badRequest('PLATFORM_COMPANY_PROTECTED', "L'entreprise plateforme n'a pas d'invitation à renvoyer");
    const prepared = await this.db.run({ companyId: PLATFORM_COMPANY_ID, platform: true }, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) throw AppException.notFound('COMPANY_NOT_FOUND', 'Entreprise introuvable');
      return this.db.withCompany(tx, PLATFORM_COMPANY_ID, companyId, async () => {
        const admin = await tx.user.findFirst({
          where: { companyId, kind: 'STAFF', status: 'PENDING', userRoles: { some: { role: { code: 'COMPANY_ADMIN' } } } },
          orderBy: { createdAt: 'asc' },
        });
        if (!admin) throw AppException.conflict('NO_PENDING_ADMIN', "Aucun administrateur en attente d'activation : son compte est déjà actif");
        const rawToken = await this.oneTime.issue(tx, { companyId, userId: admin.id, purpose: 'INVITE' });
        await this.audit.record(tx, { companyId, action: 'company.invitation_resent', entityType: 'user', entityId: admin.id, actorUserId: auth.userId });
        return { admin, rawToken, locale: company.defaultLocale as Locale };
      });
    });
    const url = `${this.config.env.ADMIN_PUBLIC_URL}/accept-invite?token=${encodeURIComponent(prepared.rawToken)}`;
    const sent = await this.mail.sendAuthMail('invite', prepared.admin.email, prepared.locale, { firstName: prepared.admin.firstName, url });
    return sent ? { sent: true, email: prepared.admin.email } : { sent: false, email: prepared.admin.email, url };
  }

  async listCompanies(auth: AuthContext) {
    const rows = await this.db.run({ companyId: auth.companyId, platform: true }, (tx) =>
      tx.company.findMany({ where: { id: { not: PLATFORM_COMPANY_ID } }, orderBy: { createdAt: 'desc' } }),
    );
    return { items: rows.map((row) => this.toDto(row)) };
  }

  async setStatus(auth: AuthContext, companyId: string, status: 'ACTIVE' | 'SUSPENDED') {
    if (companyId === PLATFORM_COMPANY_ID) {
      throw AppException.badRequest('PLATFORM_COMPANY_PROTECTED', "L'entreprise plateforme ne peut pas être suspendue");
    }
    return this.db.run({ companyId: auth.companyId, platform: true }, async (tx) => {
      const existing = await tx.company.findUnique({ where: { id: companyId } });
      if (!existing) throw AppException.notFound('COMPANY_NOT_FOUND', 'Entreprise introuvable');
      const updated = await tx.company.update({ where: { id: companyId }, data: { status } });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: status === 'SUSPENDED' ? 'platform.company_suspended' : 'platform.company_activated',
        entityType: 'company',
        entityId: companyId,
        before: { status: existing.status },
        after: { status },
      });
      return this.toDto(updated);
    });
  }

  private toDto(company: { id: string; name: string; slug: string; status: string; trackingPrefix: string | null; customerCodePrefix: string | null; defaultCurrency: string; defaultLocale: string; paymentPolicy: string; createdAt: Date }) {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      status: company.status,
      trackingPrefix: company.trackingPrefix,
      customerCodePrefix: company.customerCodePrefix,
      defaultCurrency: company.defaultCurrency,
      defaultLocale: company.defaultLocale,
      paymentPolicy: company.paymentPolicy,
      createdAt: company.createdAt,
    };
  }
}
