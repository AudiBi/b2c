import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  findShipmentTransition,
  LOADABLE_PACKAGE_STATUS,
  normalizeTrackingNumber,
  type CreateShipmentInput,
  type ShipmentStatus,
  type UpdateShipmentInput,
} from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import { normalizeSupplierTracking, PackagesService, staffInclude, staffPackageDto } from '../packages/packages.service';
import type { AuthContext } from '../security/auth.types';
import type { ManifestData } from './manifest';

const D = Prisma.Decimal;
type ShipmentWithRefs = Prisma.ShipmentGetPayload<{ include: { warehouse: true; agency: true } }>;
const refs = { warehouse: true, agency: true } satisfies Prisma.ShipmentInclude;

/** Statuts de colis qui attendent encore leur réception en agence : le lot ne peut pas être clos tant qu'il en reste. */
const PENDING_RECEIPT: string[] = ['IN_TRANSIT', 'ARRIVED_DESTINATION', 'IN_CUSTOMS'];

const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const stamp = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '');

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly packages: PackagesService,
    private readonly counters: CounterService,
  ) {}

  private assertScope(auth: AuthContext, permission: 'shipment:read' | 'shipment:manage' | 'shipment:dispatch' | 'shipment:receive', warehouseId: string): void {
    if (!auth.permissions.can(permission, { type: 'WAREHOUSE', id: warehouseId })) {
      throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cet entrepôt');
    }
  }

  private dto(s: ShipmentWithRefs, packageCount: number) {
    return {
      id: s.id,
      reference: s.reference,
      status: s.status,
      transportMode: s.transportMode,
      origin: { id: s.warehouse.id, reference: s.warehouse.reference, name: s.warehouse.name, city: s.warehouse.city, country: s.warehouse.country },
      destination: {
        country: s.destinationCountry,
        city: s.destinationCity,
        agency: s.agency ? { id: s.agency.id, code: s.agency.code, name: s.agency.name, city: s.agency.city } : null,
      },
      carrierName: s.carrierName,
      transportRef: s.transportRef,
      notes: s.notes,
      departedAt: s.departedAt,
      arrivedAt: s.arrivedAt,
      packageCount,
      version: s.version,
      createdAt: s.createdAt,
    };
  }

  private async lockShipment(tx: Tx, id: string): Promise<ShipmentWithRefs> {
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.shipment.findUnique({ where: { id }, include: refs });
    if (!row) throw AppException.notFound('SHIPMENT_NOT_FOUND', 'Lot introuvable');
    return row;
  }

  private async event(tx: Tx, auth: AuthContext, shipmentId: string, eventType: string, extra: { from?: ShipmentStatus; to?: ShipmentStatus; note?: string; data?: Prisma.InputJsonValue } = {}) {
    await tx.shipmentEvent.create({
      data: { companyId: auth.companyId, shipmentId, eventType, fromStatus: extra.from, toStatus: extra.to, actorUserId: auth.userId, note: extra.note, data: extra.data },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Création, lecture, modification
  // ---------------------------------------------------------------------------------------------

  async create(auth: AuthContext, input: CreateShipmentInput) {
    this.assertScope(auth, 'shipment:manage', input.originWarehouseId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.originWarehouseId, status: 'ACTIVE' } });
      if (!warehouse) throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable ou inactif');
      if (input.destinationAgencyId) {
        const agency = await tx.agency.findFirst({ where: { id: input.destinationAgencyId, status: 'ACTIVE' } });
        if (!agency) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable ou inactive');
        if (agency.country !== input.destinationCountry) throw AppException.conflict('AGENCY_COUNTRY_MISMATCH', "L'agence n'est pas dans le pays de destination du lot");
      }
      const now = new Date();
      const sequence = await this.counters.next(tx, auth.companyId, 'shipment', Number(day(now)));
      const reference = `${warehouse.reference}-${input.transportMode}-${day(now)}-${sequence}`;
      const row = await tx.shipment.create({
        data: { ...input, companyId: auth.companyId, reference, createdBy: auth.userId },
        include: refs,
      });
      await this.event(tx, auth, row.id, 'CREATED', { to: 'OPEN' });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'shipment.created', entityType: 'shipment', entityId: row.id, after: { reference } });
      return this.dto(row, 0);
    });
  }

  async list(auth: AuthContext, query: { limit: number; cursor?: string; status?: ShipmentStatus; q?: string }) {
    const restrict = auth.permissions.can('shipment:read') ? undefined : auth.permissions.scopeIds('shipment:read', 'WAREHOUSE');
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.shipment.findMany({
        where: {
          status: query.status,
          originWarehouseId: restrict ? { in: restrict } : undefined,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
          ...(query.q ? { OR: [{ reference: { contains: query.q.toUpperCase() } }, { transportRef: { contains: query.q, mode: 'insensitive' } }] } : {}),
        },
        include: { ...refs, _count: { select: { packages: { where: { removedAt: null } } } } },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map((s) => this.dto(s, s._count.packages)), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  private totals(links: { package: { actualWeightKg: Prisma.Decimal | null; declaredValue: Prisma.Decimal | null; declaredCurrency: string | null } }[]) {
    let weight = new D(0);
    const declared = new Map<string, Prisma.Decimal>();
    for (const { package: p } of links) {
      if (p.actualWeightKg) weight = weight.add(p.actualWeightKg);
      if (p.declaredValue && p.declaredCurrency) declared.set(p.declaredCurrency, (declared.get(p.declaredCurrency) ?? new D(0)).add(p.declaredValue));
    }
    return { count: links.length, actualWeightKg: weight.toDecimalPlaces(3).toString(), declared: Object.fromEntries([...declared].map(([c, v]) => [c, v.toFixed(2)])) };
  }

  async get(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const shipment = await tx.shipment.findUnique({ where: { id }, include: refs });
      if (!shipment || !auth.permissions.can('shipment:read', { type: 'WAREHOUSE', id: shipment.originWarehouseId })) {
        throw AppException.notFound('SHIPMENT_NOT_FOUND', 'Lot introuvable');
      }
      const [links, events] = await Promise.all([
        tx.shipmentPackage.findMany({ where: { shipmentId: id, removedAt: null }, include: { package: { include: staffInclude } }, orderBy: { loadedAt: 'asc' } }),
        tx.shipmentEvent.findMany({ where: { shipmentId: id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
      ]);
      return {
        ...this.dto(shipment, links.length),
        totals: this.totals(links),
        packages: links.map((l) => ({ loadedAt: l.loadedAt, ...staffPackageDto(l.package) })),
        events: events.map((e) => ({ id: e.id, type: e.eventType, from: e.fromStatus, to: e.toStatus, actorUserId: e.actorUserId, note: e.note, data: e.data, occurredAt: e.occurredAt })),
      };
    });
  }

  async update(auth: AuthContext, id: string, input: UpdateShipmentInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const shipment = await this.lockShipment(tx, id);
      this.assertScope(auth, 'shipment:manage', shipment.originWarehouseId);
      if (shipment.status !== 'OPEN') throw AppException.conflict('SHIPMENT_NOT_OPEN', 'Un lot parti ou terminé ne se modifie plus');
      if (input.destinationAgencyId) {
        const agency = await tx.agency.findFirst({ where: { id: input.destinationAgencyId, status: 'ACTIVE' } });
        if (!agency) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable ou inactive');
        if (agency.country !== shipment.destinationCountry) throw AppException.conflict('AGENCY_COUNTRY_MISMATCH', "L'agence n'est pas dans le pays de destination du lot");
      }
      const row = await tx.shipment.update({ where: { id }, data: { ...input, version: { increment: 1 } }, include: refs });
      await this.event(tx, auth, id, 'UPDATED', { data: { fields: Object.keys(input) } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'shipment.updated', entityType: 'shipment', entityId: id, after: { fields: Object.keys(input) } });
      return this.dto(row, await tx.shipmentPackage.count({ where: { shipmentId: id, removedAt: null } }));
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Chargement
  // ---------------------------------------------------------------------------------------------

  private async findPackage(tx: Tx, input: { code?: string; packageId?: string }) {
    if (input.packageId) return tx.package.findUnique({ where: { id: input.packageId }, include: staffInclude });
    const tracking = normalizeTrackingNumber(input.code ?? '');
    if (tracking) {
      const byNumber = await tx.package.findUnique({ where: { trackingNumber: tracking }, include: staffInclude });
      if (byNumber) return byNumber;
    }
    const supplier = normalizeSupplierTracking(input.code);
    return supplier ? tx.package.findFirst({ where: { supplierTracking: supplier, status: { not: 'CANCELLED' } }, include: staffInclude }) : null;
  }

  /**
   * Charge un colis dans un lot ouvert. Conditions (I12, I13) : colis « prêt pour expédition » avec client, poids et dimensions ;
   * même mode de transport, même entrepôt d'origine, même pays de destination ; pas déjà dans un autre lot.
   * Relire le même colis est sans effet (ALREADY_LOADED).
   */
  async load(auth: AuthContext, shipmentId: string, input: { code?: string; packageId?: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const shipment = await this.lockShipment(tx, shipmentId);
      this.assertScope(auth, 'shipment:manage', shipment.originWarehouseId);
      if (shipment.status !== 'OPEN') throw AppException.conflict('SHIPMENT_NOT_OPEN', 'Le lot n\'est plus ouvert : on ne peut plus y charger de colis');

      const found = await this.findPackage(tx, input);
      if (!found) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Aucun colis ne correspond à ce code');
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${found.id}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUniqueOrThrow({ where: { id: found.id }, include: staffInclude });

      const active = await tx.shipmentPackage.findFirst({ where: { packageId: pkg.id, removedAt: null }, include: { shipment: true } });
      if (active) {
        if (active.shipmentId === shipmentId) return { outcome: 'ALREADY_LOADED' as const, package: staffPackageDto(pkg) };
        throw new AppException(409, 'ALREADY_IN_SHIPMENT', `Ce colis est déjà dans le lot ${active.shipment.reference}`, { shipment: active.shipment.reference });
      }
      const refuse = (code: string, message: string, details?: unknown) => {
        throw new AppException(409, code, message, details);
      };
      if (pkg.status !== LOADABLE_PACKAGE_STATUS) refuse('PACKAGE_NOT_READY', `Le colis doit être « prêt pour expédition » (statut actuel : ${pkg.status})`, { status: pkg.status });
      if (!pkg.customerId || !pkg.actualWeightKg || !pkg.lengthCm || !pkg.widthCm || !pkg.heightCm) refuse('PACKAGE_INCOMPLETE', 'Client, poids et dimensions sont obligatoires pour charger un colis');
      if (pkg.transportMode !== shipment.transportMode) refuse('MODE_MISMATCH', 'Le mode de transport du colis diffère de celui du lot');
      if (pkg.originWarehouseId !== shipment.originWarehouseId) refuse('WAREHOUSE_MISMATCH', "Le colis ne vient pas de l'entrepôt d'origine du lot");
      if (pkg.destinationCountry !== shipment.destinationCountry) refuse('DESTINATION_MISMATCH', 'Le pays de destination du colis diffère de celui du lot');

      try {
        await tx.shipmentPackage.create({ data: { companyId: auth.companyId, shipmentId, packageId: pkg.id, loadedBy: auth.userId } });
      } catch (error) {
        // Deux lots chargés en même temps : l'index unique partiel (I13) départage
        if ((error as { code?: string }).code === 'P2002' || /shipment_packages_one_active/.test(String((error as Error).message))) {
          throw AppException.conflict('ALREADY_IN_SHIPMENT', 'Ce colis vient d\'être chargé dans un autre lot');
        }
        throw error;
      }
      if (!pkg.destinationAgencyId && shipment.destinationAgencyId) {
        await tx.package.update({ where: { id: pkg.id }, data: { destinationAgencyId: shipment.destinationAgencyId } });
      }
      await tx.packageEvent.create({ data: { companyId: auth.companyId, packageId: pkg.id, eventType: 'LOADED', actorUserId: auth.userId, visibility: 'PRIVATE', data: { shipment: shipment.reference } } });
      await this.event(tx, auth, shipmentId, 'PACKAGE_LOADED', { data: { trackingNumber: pkg.trackingNumber } });
      return { outcome: 'LOADED' as const, package: staffPackageDto(pkg) };
    });
  }

  async unload(auth: AuthContext, shipmentId: string, packageId: string): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const shipment = await this.lockShipment(tx, shipmentId);
      this.assertScope(auth, 'shipment:manage', shipment.originWarehouseId);
      if (shipment.status !== 'OPEN') throw AppException.conflict('SHIPMENT_NOT_OPEN', 'Le lot n\'est plus ouvert : on ne peut plus en retirer de colis');
      const link = await tx.shipmentPackage.findFirst({ where: { shipmentId, packageId, removedAt: null }, include: { package: true } });
      if (!link) throw AppException.notFound('PACKAGE_NOT_IN_SHIPMENT', "Ce colis n'est pas dans ce lot");
      await tx.shipmentPackage.update({ where: { id: link.id }, data: { removedAt: new Date(), removedBy: auth.userId } });
      await tx.packageEvent.create({ data: { companyId: auth.companyId, packageId, eventType: 'UNLOADED', actorUserId: auth.userId, visibility: 'PRIVATE', data: { shipment: shipment.reference } } });
      await this.event(tx, auth, shipmentId, 'PACKAGE_REMOVED', { data: { trackingNumber: link.package.trackingNumber } });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Événements du lot : départ, arrivée, douane, clôture, annulation (propagés aux colis)
  // ---------------------------------------------------------------------------------------------

  async act(auth: AuthContext, shipmentId: string, to: ShipmentStatus, note?: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const shipment = await this.lockShipment(tx, shipmentId);
      const rule = findShipmentTransition(shipment.status, to);
      if (!rule) {
        throw new AppException(409, 'INVALID_SHIPMENT_TRANSITION', `Transition interdite : ${shipment.status} → ${to}`, { from: shipment.status, to });
      }
      this.assertScope(auth, rule.permission as 'shipment:dispatch' | 'shipment:receive' | 'shipment:manage', shipment.originWarehouseId);

      const links = await tx.shipmentPackage.findMany({ where: { shipmentId, removedAt: null }, include: { package: { include: staffInclude } } });
      const now = new Date();
      const advanced: string[] = [];
      const skipped: { trackingNumber: string; status: string }[] = [];

      if (to === 'DISPATCHED') {
        if (links.length === 0) throw AppException.conflict('SHIPMENT_EMPTY', 'Un lot vide ne peut pas partir');
        const notReady = links.filter((l) => l.package.status !== 'READY_TO_SHIP');
        if (notReady.length > 0) {
          throw new AppException(409, 'PACKAGES_NOT_READY', 'Certains colis ne sont plus prêts pour expédition : retirez-les du lot', {
            packages: notReady.map((l) => ({ trackingNumber: l.package.trackingNumber, status: l.package.status })),
          });
        }
      }
      if (to === 'CLOSED') {
        const pending = links.filter((l) => PENDING_RECEIPT.includes(l.package.status));
        if (pending.length > 0) {
          throw new AppException(409, 'PACKAGES_PENDING_RECEIPT', "Des colis n'ont pas encore été reçus en agence", {
            count: pending.length,
            packages: pending.slice(0, 20).map((l) => ({ trackingNumber: l.package.trackingNumber, status: l.package.status })),
          });
        }
      }
      if (to === 'CANCELLED') {
        // Le lot est encore ouvert : on libère les colis avant de le fermer
        for (const l of links) {
          await tx.shipmentPackage.update({ where: { id: l.id }, data: { removedAt: now, removedBy: auth.userId } });
        }
      }

      if (rule.packages) {
        const arrivalLabel = shipment.destinationCity ?? shipment.agency?.city ?? shipment.destinationCountry;
        for (const link of links) {
          if (link.package.status !== rule.packages.from) {
            skipped.push({ trackingNumber: link.package.trackingNumber, status: link.package.status });
            continue;
          }
          await this.packages.transition(tx, auth.companyId, link.packageId, rule.packages.to, {
            actor: { userId: auth.userId, bypassPermission: true },
            data: { shipment: shipment.reference },
            locationLabel: to === 'DISPATCHED' ? shipment.warehouse.city : arrivalLabel,
          });
          advanced.push(link.package.trackingNumber);
          if (to === 'DISPATCHED' && link.package.locationId) {
            // Le colis quitte l'entrepôt : il n'est plus rangé nulle part
            await tx.package.update({ where: { id: link.packageId }, data: { locationId: null } });
            await tx.warehouseMovement.create({
              data: { companyId: auth.companyId, packageId: link.packageId, warehouseId: shipment.originWarehouseId, fromLocationId: link.package.locationId, kind: 'OUT', actorUserId: auth.userId, note: `Lot ${shipment.reference}` },
            });
          }
        }
      }

      const updated = await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: to,
          version: { increment: 1 },
          ...(to === 'DISPATCHED' ? { departedAt: now } : {}),
          ...(to === 'ARRIVED' ? { arrivedAt: now } : {}),
        },
        include: refs,
      });
      await this.event(tx, auth, shipmentId, 'STATUS_CHANGE', { from: shipment.status, to, note, data: { advanced: advanced.length, skipped: skipped.length } });
      await this.audit.record(tx, { companyId: auth.companyId, action: `shipment.${to.toLowerCase()}`, entityType: 'shipment', entityId: shipmentId, before: { status: shipment.status }, after: { status: to, packages: advanced.length } });
      return { shipment: this.dto(updated, links.length), advanced: advanced.length, skipped };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Manifeste
  // ---------------------------------------------------------------------------------------------

  async manifestData(auth: AuthContext, id: string): Promise<ManifestData> {
    const full = await this.get(auth, id);
    if (full.packages.length === 0) throw AppException.conflict('SHIPMENT_EMPTY', 'Le lot ne contient aucun colis : pas de manifeste');
    const names = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.package.findMany({ where: { id: { in: full.packages.map((p) => p.id) } }, select: { id: true, senderName: true, supplierTracking: true } }),
    );
    const extra = new Map(names.map((n) => [n.id, n]));
    return {
      reference: full.reference,
      status: full.status,
      transportMode: full.transportMode,
      origin: `${full.origin.name} (${full.origin.city}, ${full.origin.country})`,
      destination: [full.destination.agency?.name, full.destination.city, full.destination.country].filter(Boolean).join(', '),
      carrierName: full.carrierName ?? '',
      transportRef: full.transportRef ?? '',
      departedAt: stamp(full.departedAt),
      arrivedAt: stamp(full.arrivedAt),
      generatedAt: stamp(new Date()),
      rows: full.packages.map((p, i) => ({
        n: i + 1,
        trackingNumber: p.trackingNumberDisplay,
        customerCode: p.customer?.customerCode ?? '',
        customerName: p.customer?.name ?? '',
        description: p.contentDescription ?? '',
        supplierTracking: extra.get(p.id)?.supplierTracking ?? '',
        actualWeightKg: p.measures.actualWeightKg ?? '',
        declaredValue: p.declaredValue ?? '',
        declaredCurrency: p.declaredCurrency ?? '',
      })),
      totals: full.totals,
    };
  }
}

