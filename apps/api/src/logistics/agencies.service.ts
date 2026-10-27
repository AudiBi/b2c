import { Injectable } from '@nestjs/common';
import type { Agency } from '@prisma/client';
import { IN_AGENCY_STATUSES, normalizeTrackingNumber, type CreateAgencyInput, type UpdateAgencyInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { normalizeSupplierTracking, PackagesService, staffInclude, staffPackageDto } from '../packages/packages.service';
import type { AuthContext } from '../security/auth.types';

export const agencyDto = (a: Agency) => ({
  id: a.id,
  code: a.code,
  name: a.name,
  kind: a.kind,
  country: a.country,
  city: a.city,
  addressLine: a.addressLine,
  phone: a.phone,
  hours: a.hours,
  publicVisible: a.publicVisible,
  status: a.status,
});

/** Agences et points de retrait : administration, réception par scan, remise « prêt pour retrait ». */
@Injectable()
export class AgenciesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly packages: PackagesService,
  ) {}

  private assertScope(auth: AuthContext, permission: 'agency:manage' | 'agency:read' | 'agency:receive', agencyId: string): void {
    if (!auth.permissions.can(permission, { type: 'AGENCY', id: agencyId })) {
      throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette agence');
    }
  }

  async list(auth: AuthContext) {
    const restrict = auth.permissions.can('agency:read') ? undefined : auth.permissions.scopeIds('agency:read', 'AGENCY');
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.agency.findMany({ where: restrict ? { id: { in: restrict } } : undefined, orderBy: [{ country: 'asc' }, { city: 'asc' }, { code: 'asc' }] }),
    );
    return { items: rows.map(agencyDto) };
  }

  async create(auth: AuthContext, input: CreateAgencyInput) {
    // Créer une agence engage toute l'entreprise : un droit limité à une agence ne suffit pas
    if (!auth.permissions.can('agency:manage')) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante');
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const row = await tx.agency.create({ data: { ...input, companyId: auth.companyId } });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'agency.created', entityType: 'agency', entityId: row.id, after: { code: row.code } });
        return agencyDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('AGENCY_CODE_USED', 'Ce code d\'agence existe déjà');
      throw error;
    }
  }

  async update(auth: AuthContext, agencyId: string, input: UpdateAgencyInput) {
    this.assertScope(auth, 'agency:manage', agencyId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const existing = await tx.agency.findUnique({ where: { id: agencyId } });
      if (!existing) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable');
      const row = await tx.agency.update({ where: { id: agencyId }, data: input });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'agency.updated', entityType: 'agency', entityId: agencyId, after: { fields: Object.keys(input) } });
      return agencyDto(row);
    });
  }

  /** Agences visibles du public : actives et marquées visibles. Aucune donnée de colis. */
  async publicList(tx: Tx) {
    const rows = await tx.agency.findMany({ where: { status: 'ACTIVE', publicVisible: true }, orderBy: [{ country: 'asc' }, { city: 'asc' }, { name: 'asc' }] });
    return {
      items: rows.map((a) => ({ name: a.name, kind: a.kind, country: a.country, city: a.city, addressLine: a.addressLine, phone: a.phone, hours: a.hours })),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Affectation d'un colis à une agence
  // ---------------------------------------------------------------------------------------------

  async assign(auth: AuthContext, packageId: string, agencyId: string | null) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${packageId}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUnique({ where: { id: packageId } });
      if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      if (!auth.permissions.can('package:update', { type: 'WAREHOUSE', id: pkg.originWarehouseId })) {
        throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cet entrepôt');
      }
      if (['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED'].includes(pkg.status)) {
        throw AppException.conflict('INVALID_STATE', "L'agence ne se change plus une fois le colis arrivé en agence ou terminé");
      }
      if (agencyId) {
        const agency = await tx.agency.findFirst({ where: { id: agencyId, status: 'ACTIVE' } });
        if (!agency) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable ou inactive');
        if (agency.country !== pkg.destinationCountry) throw AppException.conflict('AGENCY_COUNTRY_MISMATCH', "L'agence n'est pas dans le pays de destination du colis");
      }
      const updated = await tx.package.update({ where: { id: packageId }, data: { destinationAgencyId: agencyId, version: { increment: 1 } }, include: staffInclude });
      await tx.packageEvent.create({ data: { companyId: auth.companyId, packageId, eventType: 'AGENCY_ASSIGNED', actorUserId: auth.userId, visibility: 'PRIVATE', data: { agencyId } } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'package.agency_assigned', entityType: 'package', entityId: packageId, before: { agencyId: pkg.destinationAgencyId }, after: { agencyId } });
      return staffPackageDto(updated);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Réception en agence
  // ---------------------------------------------------------------------------------------------

  /**
   * Réception par scan en agence : un colis arrivé (ou en douane) passe à « reçu dans l'agence ».
   * Un colis destiné à une AUTRE agence est refusé (409 WRONG_AGENCY) ; relire un colis déjà reçu ne change rien.
   */
  async receive(auth: AuthContext, agencyId: string, code: string) {
    this.assertScope(auth, 'agency:receive', agencyId);
    const tracking = normalizeTrackingNumber(code);
    const supplier = normalizeSupplierTracking(code);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const agency = await tx.agency.findFirst({ where: { id: agencyId, status: 'ACTIVE' } });
      if (!agency) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable ou inactive');
      const found = await tx.package.findFirst({
        where: tracking ? { trackingNumber: tracking } : { supplierTracking: supplier ?? '', status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      if (!found) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Aucun colis ne correspond à ce code');
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${found.id}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUniqueOrThrow({ where: { id: found.id }, include: staffInclude });

      if (pkg.destinationAgencyId && pkg.destinationAgencyId !== agency.id) {
        throw new AppException(409, 'WRONG_AGENCY', 'Ce colis est destiné à une autre agence', { expected: pkg.agency?.name ?? null });
      }
      if (IN_AGENCY_STATUSES.includes(pkg.status) || ['DELIVERED', 'RETURNED'].includes(pkg.status)) {
        return { outcome: 'ALREADY_RECEIVED' as const, package: staffPackageDto(pkg) };
      }
      if (pkg.status === 'IN_TRANSIT' || pkg.status === 'READY_TO_SHIP') {
        throw new AppException(409, 'NOT_ARRIVED', "Le lot de ce colis n'est pas encore arrivé", { status: pkg.status });
      }
      if (pkg.destinationCountry !== agency.country) throw AppException.conflict('AGENCY_COUNTRY_MISMATCH', "L'agence n'est pas dans le pays de destination du colis");
      if (!pkg.destinationAgencyId) {
        await tx.package.update({ where: { id: pkg.id }, data: { destinationAgencyId: agency.id } });
      }
      // Transition : permission d'agence vérifiée ci-dessus pour CETTE agence ; la machine d'états contrôle le statut de départ
      const updated = await this.packages.transition(tx, auth.companyId, pkg.id, 'RECEIVED_AT_AGENCY', {
        actor: { userId: auth.userId, bypassPermission: true },
        locationLabel: agency.city,
        data: { agency: agency.code },
      });
      return { outcome: 'RECEIVED' as const, package: staffPackageDto(updated) };
    });
  }

  /** « Prêt pour retrait » : le client peut venir. (La notification automatique viendra avec la phase 7.) */
  async readyForPickup(auth: AuthContext, agencyId: string, packageId: string) {
    this.assertScope(auth, 'agency:receive', agencyId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findFirst({ where: { id: packageId, destinationAgencyId: agencyId } });
      if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable dans cette agence');
      const updated = await this.packages.transition(tx, auth.companyId, packageId, 'READY_FOR_PICKUP', {
        actor: { userId: auth.userId, bypassPermission: true },
        locationLabel: (await tx.agency.findUniqueOrThrow({ where: { id: agencyId } })).city,
      });
      return staffPackageDto(updated);
    });
  }

  async inventory(auth: AuthContext, agencyId: string) {
    this.assertScope(auth, 'agency:read', agencyId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const agency = await tx.agency.findUnique({ where: { id: agencyId } });
      if (!agency) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable');
      const [items, expected] = await Promise.all([
        tx.package.findMany({ where: { destinationAgencyId: agencyId, status: { in: [...IN_AGENCY_STATUSES] } }, include: staffInclude, orderBy: { id: 'desc' }, take: 200 }),
        tx.package.count({ where: { destinationAgencyId: agencyId, status: { in: ['IN_TRANSIT', 'ARRIVED_DESTINATION', 'IN_CUSTOMS'] } } }),
      ]);
      return { agency: agencyDto(agency), expected, items: items.map(staffPackageDto) };
    });
  }
}
