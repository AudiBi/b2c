import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  NO_ACCESS_EMAIL_DOMAIN,
  PLATFORM_COMPANY_ID,
  type CreateCustomerByStaffInput,
  type InviteCustomerInput,
  type Locale,
  type UpdateCustomerByStaffInput,
} from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService } from '../database/db.service';
import { MailService } from '../mail/mail.service';
import { OneTimeTokenService } from '../security/one-time-token.service';
import type { AuthContext } from '../security/auth.types';
import { CustomersService } from './customers.service';

/**
 * Clients créés par le personnel. Un client « sans accès » est un utilisateur en attente avec une adresse factice réservée
 * (`@no-access.invalid`) et sans mot de passe : il ne peut pas se connecter et ne reçoit aucun e-mail. L'invitation remplace
 * l'adresse par la vraie et envoie le lien d'activation habituel.
 */
@Injectable()
export class StaffCustomersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly oneTime: OneTimeTokenService,
    private readonly customers: CustomersService,
  ) {}

  async create(auth: AuthContext, input: CreateCustomerByStaffInput) {
    const hasAccess = !!input.email;
    const result = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      if (input.email && (await tx.user.findUnique({ where: { companyId_email: { companyId: auth.companyId, email: input.email } } }))) {
        throw AppException.conflict('EMAIL_ALREADY_USED', 'Cette adresse est déjà utilisée');
      }
      const user = await tx.user.create({
        data: {
          companyId: auth.companyId,
          kind: 'CUSTOMER',
          email: input.email ?? `${randomUUID()}@${NO_ACCESS_EMAIL_DOMAIN}`,
          phone: input.phone,
          firstName: input.firstName,
          lastName: input.lastName,
          businessName: input.businessName,
          locale: input.locale,
          status: 'PENDING',
        },
      });
      const roleCode = input.customerType === 'BUSINESS' ? 'CUSTOMER_BUSINESS' : 'CUSTOMER_INDIVIDUAL';
      const role = await tx.role.findUnique({ where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: roleCode } } });
      if (!role) throw new Error('Rôles système absents : exécuter npm run db:seed');
      await tx.userRole.create({ data: { companyId: auth.companyId, userId: user.id, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY', createdBy: auth.userId } });
      const customer = await this.customers.ensureCustomer(tx, user, input.customerType);
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'customer.created_by_staff',
        entityType: 'customer',
        entityId: customer.id,
        after: { customerCode: customer.customerCode, hasAccess },
      });
      const rawToken = hasAccess ? await this.oneTime.issue(tx, { companyId: auth.companyId, userId: user.id, purpose: 'INVITE' }) : null;
      return { customer, user, rawToken };
    });
    if (result.rawToken && input.email) await this.sendInvite(input.email, input.locale, input.firstName, result.rawToken);
    return this.dto(result.customer, result.user);
  }

  async update(auth: AuthContext, customerId: string, input: UpdateCustomerByStaffInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
      const user = await tx.user.update({ where: { id: customer.userId }, data: input });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'customer.updated_by_staff', entityType: 'customer', entityId: customer.id, after: input });
      return this.dto(customer, user);
    });
  }

  /** Donne un accès au site à un client créé sans compte (ou renvoie l'invitation s'il n'a pas encore activé le sien). */
  async invite(auth: AuthContext, customerId: string, input: InviteCustomerInput) {
    const result = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, include: { user: true } });
      if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
      if (customer.user.status !== 'PENDING' || customer.user.passwordHash) {
        throw AppException.conflict('ACCOUNT_ALREADY_ACTIVE', 'Ce client a déjà un compte actif');
      }
      const taken = await tx.user.findUnique({ where: { companyId_email: { companyId: auth.companyId, email: input.email } } });
      if (taken && taken.id !== customer.userId) throw AppException.conflict('EMAIL_ALREADY_USED', 'Cette adresse est déjà utilisée');
      const user = await tx.user.update({ where: { id: customer.userId }, data: { email: input.email, locale: input.locale } });
      const rawToken = await this.oneTime.issue(tx, { companyId: auth.companyId, userId: user.id, purpose: 'INVITE' });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'customer.invited', entityType: 'customer', entityId: customer.id, after: { email: input.email } });
      return { customer, user, rawToken };
    });
    await this.sendInvite(input.email, input.locale, result.user.firstName, result.rawToken);
    return this.dto(result.customer, result.user);
  }

  private async sendInvite(email: string, locale: string, firstName: string, rawToken: string) {
    await this.mail.sendAuthMail('invite', email, locale as Locale, {
      firstName,
      url: `${this.config.env.WEB_PUBLIC_URL}/${locale}/accept-invite?token=${encodeURIComponent(rawToken)}`,
    });
  }

  private dto(
    customer: { id: string; customerCode: string; customerType: string },
    user: { firstName: string; lastName: string; businessName: string | null; email: string; phone: string | null; status: string },
  ) {
    const hasAccess = !user.email.endsWith(`@${NO_ACCESS_EMAIL_DOMAIN}`);
    return {
      id: customer.id,
      customerCode: customer.customerCode,
      customerType: customer.customerType,
      firstName: user.firstName,
      lastName: user.lastName,
      businessName: user.businessName,
      email: hasAccess ? user.email : null,
      phone: user.phone,
      status: user.status,
      hasAccess,
    };
  }
}
