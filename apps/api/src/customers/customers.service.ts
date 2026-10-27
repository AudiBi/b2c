import { Injectable } from '@nestjs/common';
import type { Customer, CustomerAddress, Beneficiary, Prisma } from '@prisma/client';
import {
  TRANSPORT_MODES,
  notificationPrefsSchema,
  renderAddressTemplate,
  type CreateAddressInput,
  type CreateBeneficiaryInput,
  type Locale,
  type NotificationPrefs,
  type UpdateAddressInput,
  type UpdateBeneficiaryInput,
  type UpdateProfileInput,
} from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import type { AuthContext } from '../security/auth.types';

const DEFAULT_PREFS: NotificationPrefs = { email: true, sms: false, whatsapp: false, inApp: true };

const formatCode = (prefix: string, sequence: number) => `${prefix}-${String(sequence).padStart(6, '0')}`;

/** Une seule ligne, espaces normalisés : le nom est imprimé sur l'étiquette du colis. */
const labelName = (value: string) => value.replace(/\s+/g, ' ').trim();

function toBeneficiaryDto(row: Beneficiary) {
  return {
    id: row.id,
    fullName: row.fullName,
    idDocumentType: row.idDocumentType,
    idDocumentLast4: row.idDocumentLast4,
    phone: row.phone,
    validFrom: row.validFrom ? row.validFrom.toISOString().slice(0, 10) : null,
    validTo: row.validTo ? row.validTo.toISOString().slice(0, 10) : null,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toAddressDto(row: CustomerAddress) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    country: row.country,
    postalCode: row.postalCode,
    instructions: row.instructions,
    isDefault: row.isDefault,
  };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Création du profil client (code client unique)
  // ---------------------------------------------------------------------------------------------

  /** Crée le profil client d'un utilisateur CUSTOMER si besoin. À appeler dans la transaction de l'action. */
  async ensureCustomer(tx: Tx, user: { id: string; companyId: string; businessName?: string | null }, type?: 'INDIVIDUAL' | 'BUSINESS'): Promise<Customer> {
    const existing = await tx.customer.findUnique({ where: { userId: user.id } });
    if (existing) return existing;

    const company = await tx.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { customerCodePrefix: true },
    });
    const sequence = await this.counters.next(tx, user.companyId, 'customer-code');
    const customer = await tx.customer.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        customerType: type ?? (user.businessName ? 'BUSINESS' : 'INDIVIDUAL'),
        customerCode: formatCode(company.customerCodePrefix ?? 'CL', sequence),
        notificationPrefs: DEFAULT_PREFS,
      },
    });
    await this.audit.record(tx, {
      companyId: user.companyId,
      action: 'customer.created',
      entityType: 'customer',
      entityId: customer.id,
      actorUserId: user.id,
      after: { customerCode: customer.customerCode, customerType: customer.customerType },
    });
    return customer;
  }

  private async customerOf(tx: Tx, auth: AuthContext): Promise<Customer> {
    if (auth.kind !== 'CUSTOMER') {
      throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    return this.ensureCustomer(tx, user);
  }

  // ---------------------------------------------------------------------------------------------
  // Profil
  // ---------------------------------------------------------------------------------------------

  async getProfile(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      const customer = auth.kind === 'CUSTOMER' ? await this.ensureCustomer(tx, user) : null;
      return this.profileDto(user, customer);
    });
  }

  async updateProfile(auth: AuthContext, input: UpdateProfileInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      const customer = auth.kind === 'CUSTOMER' ? await this.ensureCustomer(tx, user) : null;

      if (input.businessName !== undefined && customer?.customerType !== 'BUSINESS') {
        throw AppException.badRequest('NOT_A_BUSINESS_ACCOUNT', "La raison sociale n'existe que pour un compte professionnel");
      }
      if (input.notificationPrefs && !customer) {
        throw AppException.badRequest('NOT_A_CUSTOMER', 'Les préférences de notification concernent les comptes clients');
      }

      const phoneChanged = input.phone !== undefined && input.phone !== user.phone;
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale,
          businessName: input.businessName,
          phone: input.phone,
          // Un nouveau numéro doit être revérifié
          ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
        },
      });
      let updatedCustomer = customer;
      if (customer && input.notificationPrefs) {
        updatedCustomer = await tx.customer.update({
          where: { id: customer.id },
          data: { notificationPrefs: input.notificationPrefs },
        });
      }
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'profile.updated',
        entityType: 'user',
        entityId: user.id,
        after: { fields: Object.keys(input) },
      });
      return this.profileDto(updatedUser, updatedCustomer);
    });
  }

  private profileDto(
    user: { id: string; email: string; firstName: string; lastName: string; phone: string | null; locale: string; businessName: string | null; kind: string; emailVerifiedAt: Date | null; phoneVerifiedAt: Date | null; createdAt: Date },
    customer: Customer | null,
  ) {
    const prefs = notificationPrefsSchema.safeParse(customer?.notificationPrefs);
    return {
      id: user.id,
      kind: user.kind,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      phoneVerified: user.phoneVerifiedAt !== null,
      locale: user.locale as Locale,
      businessName: user.businessName,
      createdAt: user.createdAt,
      customer: customer
        ? {
            id: customer.id,
            customerCode: customer.customerCode,
            customerType: customer.customerType,
            notificationPrefs: prefs.success ? prefs.data : DEFAULT_PREFS,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Adresses
  // ---------------------------------------------------------------------------------------------

  async listAddresses(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const rows = await tx.customerAddress.findMany({
        where: { customerId: customer.id },
        orderBy: [{ kind: 'asc' }, { isDefault: 'desc' }, { id: 'asc' }],
      });
      return { items: rows.map(toAddressDto) };
    });
  }

  async createAddress(auth: AuthContext, input: CreateAddressInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const count = await tx.customerAddress.count({ where: { customerId: customer.id } });
      if (count >= 20) throw AppException.unprocessable('ADDRESS_LIMIT', "Nombre maximal d'adresses atteint (20)");

      const sameKind = await tx.customerAddress.count({ where: { customerId: customer.id, kind: input.kind } });
      const isDefault = input.isDefault || sameKind === 0;
      if (isDefault) await this.clearDefault(tx, customer.id, input.kind);
      const row = await tx.customerAddress.create({
        data: { ...input, isDefault, companyId: auth.companyId, customerId: customer.id },
      });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'address.created',
        entityType: 'customer_address',
        entityId: row.id,
        after: { kind: row.kind, country: row.country },
      });
      return toAddressDto(row);
    });
  }

  async updateAddress(auth: AuthContext, addressId: string, input: UpdateAddressInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const existing = await tx.customerAddress.findFirst({ where: { id: addressId, customerId: customer.id } });
      if (!existing) throw AppException.notFound('ADDRESS_NOT_FOUND', 'Adresse introuvable');

      const kind = input.kind ?? existing.kind;
      if (input.isDefault === true || (input.kind && input.kind !== existing.kind && existing.isDefault)) {
        await this.clearDefault(tx, customer.id, kind);
      }
      const row = await tx.customerAddress.update({ where: { id: existing.id }, data: input });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'address.updated',
        entityType: 'customer_address',
        entityId: row.id,
        after: { fields: Object.keys(input) },
      });
      return toAddressDto(row);
    });
  }

  async deleteAddress(auth: AuthContext, addressId: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const existing = await tx.customerAddress.findFirst({ where: { id: addressId, customerId: customer.id } });
      if (!existing) throw AppException.notFound('ADDRESS_NOT_FOUND', 'Adresse introuvable');
      await tx.customerAddress.delete({ where: { id: existing.id } });
      // Si l'adresse par défaut disparaît, la plus ancienne du même type prend le relais.
      if (existing.isDefault) {
        const next = await tx.customerAddress.findFirst({
          where: { customerId: customer.id, kind: existing.kind },
          orderBy: { id: 'asc' },
        });
        if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'address.deleted',
        entityType: 'customer_address',
        entityId: existing.id,
      });
    });
  }

  private clearDefault(tx: Tx, customerId: string, kind: 'PERSONAL' | 'DELIVERY') {
    return tx.customerAddress.updateMany({ where: { customerId, kind, isDefault: true }, data: { isDefault: false } });
  }

  // ---------------------------------------------------------------------------------------------
  // Bénéficiaires
  // ---------------------------------------------------------------------------------------------

  async listBeneficiaries(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const rows = await tx.beneficiary.findMany({
        where: { customerId: customer.id, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      });
      return { items: rows.map(toBeneficiaryDto) };
    });
  }

  async createBeneficiary(auth: AuthContext, input: CreateBeneficiaryInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const count = await tx.beneficiary.count({ where: { customerId: customer.id, status: 'ACTIVE' } });
      if (count >= 10) throw AppException.unprocessable('BENEFICIARY_LIMIT', 'Nombre maximal de bénéficiaires atteint (10)');
      const row = await tx.beneficiary.create({
        data: {
          companyId: auth.companyId,
          customerId: customer.id,
          fullName: input.fullName,
          idDocumentType: input.idDocumentType,
          idDocumentLast4: input.idDocumentLast4,
          phone: input.phone,
          validFrom: input.validFrom ? new Date(input.validFrom) : null,
          validTo: input.validTo ? new Date(input.validTo) : null,
        },
      });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'beneficiary.created',
        entityType: 'beneficiary',
        entityId: row.id,
      });
      return toBeneficiaryDto(row);
    });
  }

  async updateBeneficiary(auth: AuthContext, beneficiaryId: string, input: UpdateBeneficiaryInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const existing = await tx.beneficiary.findFirst({
        where: { id: beneficiaryId, customerId: customer.id, status: 'ACTIVE' },
      });
      if (!existing) throw AppException.notFound('BENEFICIARY_NOT_FOUND', 'Bénéficiaire introuvable');
      const validFrom = input.validFrom ? new Date(input.validFrom) : existing.validFrom;
      const validTo = input.validTo ? new Date(input.validTo) : existing.validTo;
      if (validFrom && validTo && validTo < validFrom) {
        throw AppException.badRequest('VALIDATION_ERROR', 'La fin de validité précède le début');
      }
      const data: Prisma.BeneficiaryUpdateInput = {
        fullName: input.fullName,
        idDocumentType: input.idDocumentType,
        idDocumentLast4: input.idDocumentLast4,
        phone: input.phone,
        ...(input.validFrom ? { validFrom } : {}),
        ...(input.validTo ? { validTo } : {}),
      };
      const row = await tx.beneficiary.update({ where: { id: existing.id }, data });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'beneficiary.updated',
        entityType: 'beneficiary',
        entityId: row.id,
        after: { fields: Object.keys(input) },
      });
      return toBeneficiaryDto(row);
    });
  }

  /** Révoque (sans supprimer) : l'historique des retraits reste lié au bénéficiaire. */
  async revokeBeneficiary(auth: AuthContext, beneficiaryId: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const updated = await tx.beneficiary.updateMany({
        where: { id: beneficiaryId, customerId: customer.id, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      if (updated.count !== 1) throw AppException.notFound('BENEFICIARY_NOT_FOUND', 'Bénéficiaire introuvable');
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'beneficiary.revoked',
        entityType: 'beneficiary',
        entityId: beneficiaryId,
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Adresses de réception (une par entrepôt actif et par mode de transport)
  // ---------------------------------------------------------------------------------------------

  /**
   * Génère à la demande, puis conserve, les adresses du client. Si le modèle d'un entrepôt ou le nom du
   * client a changé, l'adresse est régénérée. L'écriture est atomique (ON CONFLICT) : deux appels
   * simultanés ne créent jamais de doublon.
   */
  async receivingAddresses(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      const name = labelName(
        customer.customerType === 'BUSINESS' && user.businessName ? user.businessName : `${user.firstName} ${user.lastName}`,
      );
      const warehouses = await tx.warehouse.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ country: 'asc' }, { city: 'asc' }, { reference: 'asc' }] });

      for (const warehouse of warehouses) {
        const template = (warehouse.addressTemplate as string[]) ?? [];
        for (const mode of TRANSPORT_MODES) {
          const lines = renderAddressTemplate(template, { customerName: name, customerCode: customer.customerCode, mode });
          await tx.$executeRaw`
            INSERT INTO receiving_addresses (id, company_id, customer_id, warehouse_id, transport_mode, lines, warehouse_version)
            VALUES (${uuidv7()}::uuid, ${auth.companyId}::uuid, ${customer.id}::uuid, ${warehouse.id}::uuid, ${mode}::"TransportMode", ${JSON.stringify(lines)}::jsonb, ${warehouse.version})
            ON CONFLICT (customer_id, warehouse_id, transport_mode)
            DO UPDATE SET lines = EXCLUDED.lines, warehouse_version = EXCLUDED.warehouse_version, generated_at = now()
            WHERE receiving_addresses.lines IS DISTINCT FROM EXCLUDED.lines`;
        }
      }

      const stored = await tx.receivingAddress.findMany({ where: { customerId: customer.id } });
      return {
        customerCode: customer.customerCode,
        warehouses: warehouses.map((warehouse) => ({
          id: warehouse.id,
          reference: warehouse.reference,
          name: warehouse.name,
          country: warehouse.country,
          city: warehouse.city,
          addresses: TRANSPORT_MODES.map((mode) => ({
            mode,
            lines: (stored.find((row) => row.warehouseId === warehouse.id && row.transportMode === mode)?.lines as string[]) ?? [],
          })),
        })),
      };
    });
  }
}
