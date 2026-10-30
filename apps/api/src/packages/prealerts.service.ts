import { memberAccount } from '../customers/account';
import { Injectable } from '@nestjs/common';
import { Prisma, type Package, type Prealert, type Warehouse } from '@prisma/client';
import { formatTrackingNumber, type CreatePrealertInput, type PackageStatus, type UpdatePrealertInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { CustomersService } from '../customers/customers.service';
import { DbService, type Tx } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { displayName, OutboxService } from '../notifications/outbox.service';
import { normalizeSupplierTracking, ownerPackageDto, PackagesService, publicEventDto } from './packages.service';
import { TrackingNumberService } from './tracking-number.service';

const D = Prisma.Decimal;

type PrealertWithPackage = Prealert & { package: Package & { warehouse: Warehouse }; warehouse: Warehouse };
const include = { package: { include: { warehouse: true } }, warehouse: true } satisfies Prisma.PrealertInclude;

function prealertDto(row: PrealertWithPackage) {
  return {
    id: row.id,
    status: row.status,
    storeName: row.storeName,
    orderNumber: row.orderNumber,
    supplierTracking: row.supplierTracking,
    transportMode: row.transportMode,
    purchaseAmount: row.purchaseAmount.toString(),
    purchaseCurrency: row.purchaseCurrency,
    description: row.description,
    warehouse: { id: row.warehouse.id, name: row.warehouse.name, city: row.warehouse.city, country: row.warehouse.country },
    package: { id: row.package.id, trackingNumber: row.package.trackingNumber, status: row.package.status },
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrealertsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly packages: PackagesService,
    private readonly tracking: TrackingNumberService,
    private readonly outbox: OutboxService,
  ) {}

  private async customerOf(tx: Tx, auth: AuthContext) {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    // Un membre d'équipe agit pour le compte de son propriétaire : jamais de profil client créé pour lui
    return { customer: (await memberAccount(tx, user.id)) ?? (await this.customers.ensureCustomer(tx, user)), user };
  }

  /** Une préalerte active par numéro de suivi marchand dans l'entreprise ; verrou pour rester exact sous concurrence. */
  private async assertNoDuplicate(tx: Tx, companyId: string, supplier: string | null, exceptPrealertId?: string) {
    if (!supplier) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prealert:${companyId}:${supplier}`}, 0))`;
    const existing = await tx.prealert.findFirst({
      where: { supplierTracking: supplier, status: { not: 'CANCELLED' }, ...(exceptPrealertId ? { id: { not: exceptPrealertId } } : {}) },
    });
    if (existing) {
      throw AppException.conflict('DUPLICATE_PREALERT', 'Une préalerte existe déjà pour ce numéro de suivi du marchand');
    }
  }

  async create(auth: AuthContext, input: CreatePrealertInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const { customer, user } = await this.customerOf(tx, auth);
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, status: 'ACTIVE' } });
      if (!warehouse) throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable ou inactif');
      const supplier = normalizeSupplierTracking(input.supplierTracking);
      await this.assertNoDuplicate(tx, auth.companyId, supplier);

      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { trackingPrefix: true } });
      const delivery = await tx.customerAddress.findFirst({ where: { customerId: customer.id, kind: 'DELIVERY' }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
      const trackingNumber = await this.tracking.issue(tx, company.trackingPrefix);
      const recipient = customer.customerType === 'BUSINESS' && user.businessName ? user.businessName : `${user.firstName} ${user.lastName}`;

      const pkg = await tx.package.create({
        data: {
          companyId: auth.companyId,
          trackingNumber,
          customerId: customer.id,
          recipientName: recipient,
          originWarehouseId: warehouse.id,
          originCountry: warehouse.country,
          originCity: warehouse.city,
          destinationCountry: delivery?.country ?? 'HT',
          destinationCity: input.destinationCity ?? delivery?.city ?? null,
          transportMode: input.transportMode,
          supplierTracking: supplier,
          status: 'PREALERT_CREATED',
          contentDescription: input.description,
          declaredValue: new D(String(input.purchaseAmount)),
          declaredCurrency: input.purchaseCurrency,
          createdBy: auth.userId,
        },
      });
      await tx.packageEvent.create({
        data: {
          companyId: auth.companyId,
          packageId: pkg.id,
          toStatus: 'PREALERT_CREATED',
          eventType: 'PREALERT_CREATED',
          actorUserId: auth.userId,
          locationLabel: warehouse.city,
        },
      });
      const prealert = await tx.prealert.create({
        data: {
          companyId: auth.companyId,
          customerId: customer.id,
          packageId: pkg.id,
          storeName: input.storeName,
          orderNumber: input.orderNumber,
          supplierTracking: supplier,
          warehouseId: warehouse.id,
          transportMode: input.transportMode,
          purchaseAmount: new D(String(input.purchaseAmount)),
          purchaseCurrency: input.purchaseCurrency,
          description: input.description,
        },
      });
      await this.outbox.emit(tx, {
        companyId: auth.companyId,
        eventCode: 'prealert.created',
        aggregateType: 'prealert',
        aggregateId: prealert.id,
        customerId: customer.id,
        payload: { customerName: displayName({ customerType: customer.customerType, user }), trackingNumber: formatTrackingNumber(trackingNumber), storeName: input.storeName },
      });
      // PREALERT_CREATED → AWAITING_RECEIPT : automatique après la création
      await this.packages.transition(tx, auth.companyId, pkg.id, 'AWAITING_RECEIPT', { actor: { userId: auth.userId, bypassPermission: true } });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'prealert.created',
        entityType: 'prealert',
        entityId: prealert.id,
        after: { trackingNumber, warehouse: warehouse.reference, store: input.storeName },
      });
      return prealertDto(await tx.prealert.findUniqueOrThrow({ where: { id: prealert.id }, include }));
    });
  }

  async list(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const { customer } = await this.customerOf(tx, auth);
      const rows = await tx.prealert.findMany({ where: { customerId: customer.id }, include, orderBy: { id: 'desc' }, take: 100 });
      return { items: rows.map(prealertDto) };
    });
  }

  private async own(tx: Tx, auth: AuthContext, prealertId: string) {
    const { customer } = await this.customerOf(tx, auth);
    const row = await tx.prealert.findFirst({ where: { id: prealertId, customerId: customer.id }, include });
    if (!row) throw AppException.notFound('PREALERT_NOT_FOUND', 'Préalerte introuvable');
    return row;
  }

  async get(auth: AuthContext, prealertId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => prealertDto(await this.own(tx, auth, prealertId)));
  }

  async update(auth: AuthContext, prealertId: string, input: UpdatePrealertInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await this.own(tx, auth, prealertId);
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${row.packageId}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUniqueOrThrow({ where: { id: row.packageId } });
      if (row.status !== 'OPEN' || pkg.status !== 'AWAITING_RECEIPT') {
        throw AppException.conflict('PREALERT_LOCKED', 'Cette préalerte ne peut plus être modifiée : le colis est déjà arrivé ou la préalerte est annulée');
      }
      const supplier = input.supplierTracking !== undefined ? normalizeSupplierTracking(input.supplierTracking) : row.supplierTracking;
      if (supplier !== row.supplierTracking) await this.assertNoDuplicate(tx, auth.companyId, supplier, row.id);

      await tx.prealert.update({
        where: { id: row.id },
        data: {
          storeName: input.storeName,
          orderNumber: input.orderNumber,
          supplierTracking: supplier,
          transportMode: input.transportMode,
          purchaseAmount: input.purchaseAmount !== undefined ? new D(String(input.purchaseAmount)) : undefined,
          purchaseCurrency: input.purchaseCurrency,
          description: input.description,
        },
      });
      await tx.package.update({
        where: { id: row.packageId },
        data: {
          supplierTracking: supplier,
          transportMode: input.transportMode,
          contentDescription: input.description,
          declaredValue: input.purchaseAmount !== undefined ? new D(String(input.purchaseAmount)) : undefined,
          declaredCurrency: input.purchaseCurrency,
          destinationCity: input.destinationCity,
          version: { increment: 1 },
        },
      });
      await tx.packageEvent.create({
        data: { companyId: auth.companyId, packageId: row.packageId, eventType: 'PREALERT_UPDATED', actorUserId: auth.userId, visibility: 'PRIVATE', data: { fields: Object.keys(input) } },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'prealert.updated', entityType: 'prealert', entityId: row.id, after: { fields: Object.keys(input) } });
      return prealertDto(await tx.prealert.findUniqueOrThrow({ where: { id: row.id }, include }));
    });
  }

  /** Annulation par le client, tant que le colis n'est pas arrivé. */
  async cancel(auth: AuthContext, prealertId: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await this.own(tx, auth, prealertId);
      if (row.status !== 'OPEN') throw AppException.conflict('PREALERT_LOCKED', 'Cette préalerte ne peut plus être annulée');
      await this.packages.transition(tx, auth.companyId, row.packageId, 'CANCELLED', {
        reason: 'Annulé par le client',
        actor: { userId: auth.userId, bypassPermission: true },
      });
      await tx.prealert.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'prealert.cancelled', entityType: 'prealert', entityId: row.id });
    });
  }
}

/** Colis du client connecté (y compris ceux qu'il attend encore). */
@Injectable()
export class PortalPackagesService {
  constructor(
    private readonly db: DbService,
    private readonly customers: CustomersService,
  ) {}

  private async customerId(tx: Tx, auth: AuthContext): Promise<string> {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    return ((await memberAccount(tx, user.id)) ?? (await this.customers.ensureCustomer(tx, user))).id;
  }

  async list(auth: AuthContext, query: { limit: number; cursor?: string; status?: PackageStatus; q?: string }) {
    const q = query.q?.toUpperCase().replace(/[\s-]/g, '');
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customerId = await this.customerId(tx, auth);
      const rows = await tx.package.findMany({
        where: {
          customerId,
          status: query.status,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
          ...(q ? { OR: [{ trackingNumber: { contains: q } }, { supplierTracking: { contains: q } }] } : {}),
        },
        include: { warehouse: true, agency: true, customer: { include: { user: { select: { firstName: true, lastName: true, businessName: true } } } } },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      });
      const items = rows.slice(0, query.limit);
      return { items: items.map(ownerPackageDto), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
    });
  }

  async get(auth: AuthContext, packageId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customerId = await this.customerId(tx, auth);
      // Le filtre sur le client est dans la requête : le colis d'un autre client n'est pas distinguable d'un colis inexistant
      const pkg = await tx.package.findFirst({
        where: { id: packageId, customerId },
        include: { warehouse: true, agency: true, customer: { include: { user: { select: { firstName: true, lastName: true, businessName: true } } } } },
      });
      if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      const events = await tx.packageEvent.findMany({ where: { packageId, visibility: 'PUBLIC' }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
      return { ...ownerPackageDto(pkg), events: events.map((event) => publicEventDto(event, 'OWNER')) };
    });
  }
}
