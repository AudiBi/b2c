import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IN_WAREHOUSE_STATUSES, normalizeTrackingNumber } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { normalizeSupplierTracking, PackagesService, staffInclude, staffPackageDto } from '../packages/packages.service';
import type { AuthContext } from '../security/auth.types';

const locationDto = (row: { id: string; warehouseId: string; code: string; kind: string; status: string }) => ({
  id: row.id,
  warehouseId: row.warehouseId,
  code: row.code,
  kind: row.kind,
  status: row.status,
});

/** Colis qui ont quitté l'entrepôt (lot parti) : absents de l'inventaire même s'ils sont retenus. */
const departed: Prisma.PackageWhereInput = {
  shipmentLinks: { none: { removedAt: null, shipment: { status: { in: ['DISPATCHED', 'ARRIVED', 'IN_CUSTOMS', 'CLOSED'] } } } },
};

/**
 * Opérations d'entrepôt : emplacements, mouvements, inventaire, file des anomalies et réception par scan.
 * Chaque droit est vérifié pour l'entrepôt concerné (une portée limitée à un entrepôt ne déborde pas sur un autre).
 */
@Injectable()
export class WarehouseOpsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly packages: PackagesService,
  ) {}

  private assertScope(auth: AuthContext, permission: 'warehouse:manage' | 'warehouse:read' | 'warehouse:move' | 'package:receive' | 'package:read', warehouseId: string): void {
    if (!auth.permissions.can(permission, { type: 'WAREHOUSE', id: warehouseId })) {
      throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cet entrepôt');
    }
  }

  private async warehouse(tx: Tx, warehouseId: string) {
    const row = await tx.warehouse.findUnique({ where: { id: warehouseId } });
    if (!row) throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable');
    return row;
  }

  // ---------------------------------------------------------------------------------------------
  // Emplacements
  // ---------------------------------------------------------------------------------------------

  async listLocations(auth: AuthContext, warehouseId: string) {
    this.assertScope(auth, 'warehouse:read', warehouseId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.warehouse(tx, warehouseId);
      const rows = await tx.warehouseLocation.findMany({ where: { warehouseId }, orderBy: { code: 'asc' } });
      return { items: rows.map(locationDto) };
    });
  }

  async createLocation(auth: AuthContext, warehouseId: string, input: { code: string; kind: 'ZONE' | 'SHELF' | 'BIN' }) {
    this.assertScope(auth, 'warehouse:manage', warehouseId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.warehouse(tx, warehouseId);
      const existing = await tx.warehouseLocation.findUnique({ where: { warehouseId_code: { warehouseId, code: input.code } } });
      if (existing) throw AppException.conflict('LOCATION_CODE_USED', 'Ce code d\'emplacement existe déjà dans cet entrepôt');
      const row = await tx.warehouseLocation.create({ data: { companyId: auth.companyId, warehouseId, code: input.code, kind: input.kind } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'location.created', entityType: 'warehouse_location', entityId: row.id, after: { warehouseId, code: row.code } });
      return locationDto(row);
    });
  }

  async updateLocation(auth: AuthContext, locationId: string, input: { kind?: 'ZONE' | 'SHELF' | 'BIN'; status?: 'ACTIVE' | 'INACTIVE' }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const existing = await tx.warehouseLocation.findUnique({ where: { id: locationId } });
      if (!existing) throw AppException.notFound('LOCATION_NOT_FOUND', 'Emplacement introuvable');
      this.assertScope(auth, 'warehouse:manage', existing.warehouseId);
      if (input.status === 'INACTIVE') {
        const occupied = await tx.package.count({ where: { locationId } });
        if (occupied > 0) throw AppException.conflict('LOCATION_NOT_EMPTY', `${occupied} colis sont rangés ici : déplacez-les avant de désactiver l'emplacement`);
      }
      const row = await tx.warehouseLocation.update({ where: { id: locationId }, data: { kind: input.kind, status: input.status } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'location.updated', entityType: 'warehouse_location', entityId: row.id, after: input });
      return locationDto(row);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Mouvements
  // ---------------------------------------------------------------------------------------------

  /** Range, déplace ou sort un colis de son emplacement. Écrit un mouvement (journal en ajout seul). */
  async move(auth: AuthContext, packageId: string, input: { locationId: string | null; note?: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${packageId}::uuid FOR UPDATE`;
      const pkg = await tx.package.findFirst({ where: { id: packageId }, include: staffInclude });
      if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      this.assertScope(auth, 'warehouse:move', pkg.originWarehouseId);
      const here = await tx.package.count({ where: { id: packageId, status: { in: [...IN_WAREHOUSE_STATUSES] }, ...departed } });
      if (here === 0) throw AppException.conflict('NOT_IN_WAREHOUSE', "Ce colis n'est pas (ou plus) dans l'entrepôt");

      if (input.locationId) {
        const location = await tx.warehouseLocation.findUnique({ where: { id: input.locationId } });
        if (!location || location.warehouseId !== pkg.originWarehouseId) throw AppException.notFound('LOCATION_NOT_FOUND', "Emplacement introuvable dans l'entrepôt du colis");
        if (location.status !== 'ACTIVE') throw AppException.conflict('LOCATION_INACTIVE', 'Cet emplacement est désactivé');
      }
      if (pkg.locationId === input.locationId) return { moved: false, package: staffPackageDto(pkg) };

      const kind = pkg.locationId === null ? 'IN' : input.locationId === null ? 'OUT' : 'MOVE';
      const updated = await tx.package.update({ where: { id: packageId }, data: { locationId: input.locationId, version: { increment: 1 } }, include: staffInclude });
      await tx.warehouseMovement.create({
        data: {
          companyId: auth.companyId,
          packageId,
          warehouseId: pkg.originWarehouseId,
          fromLocationId: pkg.locationId,
          toLocationId: input.locationId,
          kind,
          actorUserId: auth.userId,
          note: input.note,
        },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'package.moved', entityType: 'package', entityId: packageId, before: { locationId: pkg.locationId }, after: { locationId: input.locationId } });
      return { moved: true, package: staffPackageDto(updated) };
    });
  }

  async movements(auth: AuthContext, packageId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId } });
      if (!pkg || !auth.permissions.can('package:read', { type: 'WAREHOUSE', id: pkg.originWarehouseId })) {
        throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      }
      const rows = await tx.warehouseMovement.findMany({
        where: { packageId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        include: { fromLocation: true, toLocation: true },
      });
      return {
        items: rows.map((m) => ({ id: m.id, kind: m.kind, from: m.fromLocation?.code ?? null, to: m.toLocation?.code ?? null, actorUserId: m.actorUserId, note: m.note, occurredAt: m.occurredAt })),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Inventaire et anomalies
  // ---------------------------------------------------------------------------------------------

  async inventory(auth: AuthContext, warehouseId: string, locationId?: string) {
    this.assertScope(auth, 'warehouse:read', warehouseId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const warehouse = await this.warehouse(tx, warehouseId);
      const base: Prisma.PackageWhereInput = { originWarehouseId: warehouseId, status: { in: [...IN_WAREHOUSE_STATUSES] }, ...departed };
      const [locations, grouped, total, items] = await Promise.all([
        tx.warehouseLocation.findMany({ where: { warehouseId }, orderBy: { code: 'asc' } }),
        tx.package.groupBy({ by: ['locationId'], where: base, _count: { _all: true } }),
        tx.package.count({ where: base }),
        tx.package.findMany({ where: { ...base, ...(locationId ? { locationId } : {}) }, include: staffInclude, orderBy: { id: 'desc' }, take: 200 }),
      ]);
      const counts = new Map(grouped.map((g) => [g.locationId, g._count._all]));
      return {
        warehouse: { id: warehouse.id, reference: warehouse.reference, name: warehouse.name, city: warehouse.city },
        total,
        unplaced: counts.get(null) ?? 0,
        locations: locations.map((l) => ({ ...locationDto(l), count: counts.get(l.id) ?? 0 })),
        items: items.map(staffPackageDto),
        truncated: total > items.length && !locationId,
      };
    });
  }

  /** File de traitement : retenues ouvertes et colis reçus sans client (WH-04). */
  async anomalies(auth: AuthContext, warehouseId?: string) {
    const restrict = auth.permissions.can('package:read') ? undefined : auth.permissions.scopeIds('package:read', 'WAREHOUSE');
    if (warehouseId) this.assertScope(auth, 'package:read', warehouseId);
    const where: Prisma.PackageWhereInput = {
      originWarehouseId: warehouseId ?? (restrict ? { in: restrict } : undefined),
    };
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const [holds, unidentified] = await Promise.all([
        tx.packageHold.findMany({ where: { releasedAt: null, package: where }, include: { package: { include: staffInclude } }, orderBy: { openedAt: 'asc' }, take: 200 }),
        tx.package.findMany({ where: { ...where, customerId: null, status: { in: ['RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION'] } }, include: staffInclude, orderBy: { id: 'asc' }, take: 200 }),
      ]);
      return {
        holds: holds.map((h) => ({ id: h.id, reasonCode: h.reasonCode, note: h.note, openedAt: h.openedAt, package: staffPackageDto(h.package) })),
        unidentified: unidentified.map(staffPackageDto),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Réception par scan
  // ---------------------------------------------------------------------------------------------

  /**
   * Réception d'un code lu (lecteur) ou saisi : numéro de suivi de la plateforme ou numéro du marchand.
   * Idempotente : relire un colis déjà reçu ne change rien (outcome ALREADY_RECEIVED). Le verrou consultatif par code
   * empêche deux lectures simultanées de créer deux colis non identifiés (NFR-08).
   */
  async scanReceive(auth: AuthContext, input: { warehouseId: string; code: string; transportMode?: 'AIR' | 'SEA' }) {
    this.assertScope(auth, 'package:receive', input.warehouseId);
    const tracking = normalizeTrackingNumber(input.code);
    const supplier = normalizeSupplierTracking(input.code);
    if (!supplier) throw AppException.badRequest('CODE_REQUIRED', 'Code illisible');

    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, status: 'ACTIVE' } });
      if (!warehouse) throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable ou inactif');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scan:${auth.companyId}:${tracking ?? supplier}`}, 0))`;

      let candidates = tracking ? await tx.package.findMany({ where: { trackingNumber: tracking }, include: staffInclude }) : [];
      let method = 'TRACKING_NUMBER';
      if (candidates.length === 0) {
        candidates = await tx.package.findMany({ where: { supplierTracking: supplier, status: { not: 'CANCELLED' } }, include: staffInclude, take: 6 });
        method = 'SUPPLIER_TRACKING';
      }
      const awaiting = candidates.filter((c) => c.status === 'AWAITING_RECEIPT');
      if (awaiting.length > 1) throw this.packages.ambiguous(awaiting);

      if (awaiting.length === 1) {
        const result = await this.packages.receiveExpected(tx, auth, awaiting[0], warehouse, { warehouseId: warehouse.id, senderName: undefined, notes: undefined }, method, false);
        return { outcome: 'RECEIVED' as const, match: result.match, package: result.package };
      }
      if (candidates.length > 0) {
        const known = candidates[0];
        if (known.status === 'CANCELLED') throw AppException.conflict('PACKAGE_CANCELLED', 'Ce colis est annulé');
        return { outcome: 'ALREADY_RECEIVED' as const, match: null, package: staffPackageDto(known) };
      }
      const created = await this.packages.createReceived(tx, auth, warehouse, null, { warehouseId: warehouse.id, transportMode: input.transportMode, senderName: undefined, notes: undefined }, supplier);
      return { outcome: 'UNIDENTIFIED' as const, match: { status: 'UNIDENTIFIED', method: 'NONE' }, package: staffPackageDto(created) };
    });
  }
}

