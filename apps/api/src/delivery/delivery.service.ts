import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type Beneficiary, type Package, type Route, type RouteStop } from '@prisma/client';
import {
  DEFAULT_DELIVERY_SETTINGS,
  FAILED_ATTEMPTS_ALERT,
  HANDOVER_CODE_MAX_FAILURES,
  HANDOVER_CODE_TTL_HOURS,
  formatTrackingNumber,
  type HandoverInput,
} from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService, type Tx } from '../database/db.service';
import { D } from '../finance/ledger.service';
import { CounterService } from '../infra/counter.service';
import { displayName, OutboxService } from '../notifications/outbox.service';
import { PackagesService, staffInclude } from '../packages/packages.service';
import type { AuthContext } from '../security/auth.types';

type DeliverySettings = { requireOtp: boolean; requireIdDocument: boolean; requirePhoto: boolean };

const IN_AGENCY = ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP'];
const routeReference = (year: number, sequence: number) => `TOU-${year}-${String(sequence).padStart(6, '0')}`;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const stopInclude = {
  package: { select: { id: true, trackingNumber: true, contentDescription: true, status: true } },
  customer: { include: { user: { select: { firstName: true, lastName: true, businessName: true, phone: true } } } },
} satisfies Prisma.RouteStopInclude;
type StopFull = RouteStop & Prisma.RouteStopGetPayload<{ include: typeof stopInclude }>;

const routeInclude = {
  agency: { select: { id: true, name: true, city: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { stops: true } },
} satisfies Prisma.RouteInclude;
type RouteFull = Route & Prisma.RouteGetPayload<{ include: typeof routeInclude }>;

export const routeDto = (r: RouteFull, counts?: { delivered: number; failed: number }) => ({
  id: r.id,
  reference: r.reference,
  status: r.status,
  plannedDate: isoDay(r.plannedDate),
  agency: r.agency,
  driver: { id: r.driver.id, name: `${r.driver.firstName} ${r.driver.lastName}` },
  notes: r.notes,
  startedAt: r.startedAt,
  completedAt: r.completedAt,
  stopCount: r._count.stops,
  ...(counts ?? {}),
  createdAt: r.createdAt,
});

type BeneficiaryOption = { id: string; fullName: string; idDocumentType: string | null; idDocumentLast4: string | null };

const stopDto = (s: StopFull, balance: { due: string; unbilled: boolean; currency: string | null } | null, beneficiaries: BeneficiaryOption[] = []) => ({
  id: s.id,
  routeId: s.routeId,
  sequence: s.sequence,
  status: s.status,
  address: s.addressSnapshot,
  instructions: s.instructions,
  package: { id: s.package.id, trackingNumber: s.package.trackingNumber, trackingNumberDisplay: formatTrackingNumber(s.package.trackingNumber), description: s.package.contentDescription, status: s.package.status },
  customer: { id: s.customer.id, customerCode: s.customer.customerCode, name: displayName(s.customer), phone: s.customer.user.phone },
  balanceDue: balance ? balance.due : null,
  balanceCurrency: balance ? balance.currency : null,
  unbilled: balance ? balance.unbilled : false,
  beneficiaries,
});

type Fail = { fail: AppException };
const isFail = (value: unknown): value is Fail => typeof value === 'object' && value !== null && 'fail' in value;

/** Tournées, remise au client (agence ou livreur), code de remise, tentatives échouées. */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly packages: PackagesService,
    private readonly counters: CounterService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------------------------

  async settings(tx: Tx): Promise<DeliverySettings> {
    const row = await tx.companySetting.findFirst({ where: { key: 'delivery' } });
    const value = (row?.value ?? {}) as Partial<DeliverySettings>;
    return {
      requireOtp: typeof value.requireOtp === 'boolean' ? value.requireOtp : DEFAULT_DELIVERY_SETTINGS.requireOtp,
      requireIdDocument: typeof value.requireIdDocument === 'boolean' ? value.requireIdDocument : DEFAULT_DELIVERY_SETTINGS.requireIdDocument,
      requirePhoto: typeof value.requirePhoto === 'boolean' ? value.requirePhoto : DEFAULT_DELIVERY_SETTINGS.requirePhoto,
    };
  }

  async readSettings(auth: AuthContext): Promise<DeliverySettings> {
    return this.db.run({ companyId: auth.companyId }, (tx) => this.settings(tx));
  }

  async updateSettings(auth: AuthContext, patch: Partial<DeliverySettings>): Promise<DeliverySettings> {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const before = await this.settings(tx);
      const after = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as DeliverySettings;
      await tx.companySetting.upsert({
        where: { companyId_key: { companyId: auth.companyId, key: 'delivery' } },
        create: { companyId: auth.companyId, key: 'delivery', value: after },
        update: { value: after },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'settings.delivery_updated', entityType: 'company', entityId: auth.companyId, before, after });
      return after;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Droits : un livreur n'agit que sur ses tournées (DEL-04)
  // ---------------------------------------------------------------------------------------------

  private canManage(auth: AuthContext, agencyId: string): boolean {
    return auth.permissions.can('delivery:assign', { type: 'AGENCY', id: agencyId });
  }

  private canSeeAgency(auth: AuthContext, agencyId: string): boolean {
    return auth.permissions.can('delivery:read', { type: 'AGENCY', id: agencyId });
  }

  /** Droit de remettre à l'agence : confirmer ET lire les livraisons de l'agence (un livreur seul n'a pas ce droit). */
  private canHandOverAtAgency(auth: AuthContext, agencyId: string): boolean {
    return auth.permissions.can('delivery:confirm', { type: 'AGENCY', id: agencyId }) && this.canSeeAgency(auth, agencyId);
  }

  private isRouteDriver(auth: AuthContext, route: { driverUserId: string }): boolean {
    return route.driverUserId === auth.userId && auth.permissions.has('delivery:read_assigned');
  }

  /** Une tournée est visible par son livreur et par ceux qui lisent les livraisons de son agence. */
  private canSeeRoute(auth: AuthContext, route: { driverUserId: string; agencyId: string }): boolean {
    return this.isRouteDriver(auth, route) || this.canSeeAgency(auth, route.agencyId);
  }

  // ---------------------------------------------------------------------------------------------
  // Solde dû (DEL-05)
  // ---------------------------------------------------------------------------------------------

  /**
   * Solde restant sur les factures actives du colis. Selon la politique de l'entreprise, un colis jamais
   * facturé est aussi bloqué (paiement à la remise) ; sinon sa remise est possible (autorisation manuelle).
   */
  async balanceOf(tx: Tx, packageId: string, policy: 'PAY_BEFORE_SHIPMENT' | 'PAY_BEFORE_RELEASE' | 'PAY_BEFORE_BOTH') {
    const links = await tx.invoicePackage.findMany({ where: { packageId, invoice: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } } }, include: { invoice: true } });
    let due = new D(0);
    let currency: string | null = null;
    for (const link of links) {
      const left = new D(link.invoice.total).sub(link.invoice.creditedTotal).sub(link.invoice.paidTotal);
      if (left.gt(0)) due = due.add(left);
      currency = link.invoice.currency;
    }
    const unbilled = links.length === 0 && (policy === 'PAY_BEFORE_RELEASE' || policy === 'PAY_BEFORE_BOTH');
    return { due, currency, unbilled, blocked: due.gt(0) || unbilled };
  }

  private async companyPolicy(tx: Tx, companyId: string) {
    return (await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { paymentPolicy: true } })).paymentPolicy;
  }

  /** Bénéficiaires autorisés encore valables aujourd'hui, par client. */
  private async activeBeneficiaries(tx: Tx, customerIds: string[]): Promise<Map<string, BeneficiaryOption[]>> {
    const result = new Map<string, BeneficiaryOption[]>();
    if (customerIds.length === 0) return result;
    const today = isoDay(new Date());
    const rows = await tx.beneficiary.findMany({ where: { customerId: { in: [...new Set(customerIds)] }, status: 'ACTIVE' }, orderBy: { fullName: 'asc' } });
    for (const b of rows) {
      if ((b.validFrom && isoDay(b.validFrom) > today) || (b.validTo && isoDay(b.validTo) < today)) continue;
      const list = result.get(b.customerId) ?? [];
      list.push({ id: b.id, fullName: b.fullName, idDocumentType: b.idDocumentType, idDocumentLast4: b.idDocumentLast4 });
      result.set(b.customerId, list);
    }
    return result;
  }

  /** Livreurs actifs que l'on peut affecter à une tournée. */
  async listDrivers(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const rows = await tx.user.findMany({ where: { kind: 'STAFF', status: 'ACTIVE', userRoles: { some: { role: { code: 'DRIVER' } } } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
      return { items: rows.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })) };
    });
  }

  /** Ce qu'il faut savoir avant une remise au comptoir : règle de preuves, bénéficiaires, solde, échecs précédents. */
  async handoverInfo(auth: AuthContext, packageId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId }, include: { customer: { include: { user: true } } } });
      if (!pkg || !pkg.customer || !pkg.destinationAgencyId || !this.canHandOverAtAgency(auth, pkg.destinationAgencyId)) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      const policy = await this.companyPolicy(tx, auth.companyId);
      const balance = await this.balanceOf(tx, pkg.id, policy);
      const authorized = await this.activeBeneficiaries(tx, [pkg.customer.id]);
      return {
        package: { id: pkg.id, trackingNumberDisplay: formatTrackingNumber(pkg.trackingNumber), status: pkg.status },
        customer: { id: pkg.customer.id, customerCode: pkg.customer.customerCode, name: displayName(pkg.customer) },
        settings: await this.settings(tx),
        beneficiaries: authorized.get(pkg.customer.id) ?? [],
        balance: { due: balance.due.toFixed(2), currency: balance.currency, unbilled: balance.unbilled, blocked: balance.blocked },
        failedAttempts: await tx.deliveryAttempt.count({ where: { packageId, outcome: 'FAILED' } }),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Tournées
  // ---------------------------------------------------------------------------------------------

  async createRoute(auth: AuthContext, input: { agencyId: string; driverUserId: string; plannedDate: string; notes?: string }) {
    if (!this.canManage(auth, input.agencyId)) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette agence');
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const agency = await tx.agency.findFirst({ where: { id: input.agencyId, status: 'ACTIVE' } });
      if (!agency) throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable ou inactive');
      const driver = await tx.user.findFirst({ where: { id: input.driverUserId, kind: 'STAFF', status: 'ACTIVE' }, select: { id: true } });
      const hasRole = driver ? await tx.userRole.findFirst({ where: { userId: driver.id, role: { code: 'DRIVER' } }, select: { id: true } }) : null;
      if (!driver || !hasRole) throw AppException.unprocessable('DRIVER_INVALID', "Le livreur doit être un membre actif du personnel ayant le rôle de livreur");
      const now = new Date();
      const year = now.getUTCFullYear();
      const reference = routeReference(year, await this.counters.next(tx, auth.companyId, 'route', year));
      const row = await tx.route.create({
        data: { companyId: auth.companyId, reference, agencyId: agency.id, driverUserId: driver.id, plannedDate: new Date(`${input.plannedDate}T00:00:00Z`), notes: input.notes, createdBy: auth.userId },
        include: routeInclude,
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'route.created', entityType: 'route', entityId: row.id, after: { reference, agencyId: agency.id, driverUserId: driver.id } });
      return routeDto(row);
    });
  }

  /** `mine` : « mes tournées » du livreur (seulement celles où il est désigné) ; sinon les tournées des agences que l'on gère. */
  async listRoutes(auth: AuthContext, query: { limit: number; cursor?: string; status?: Route['status']; agencyId?: string; date?: string }, mine = false) {
    const visibility: Prisma.RouteWhereInput[] = [];
    if (mine) {
      visibility.push({ driverUserId: auth.userId });
    } else {
      const agencyIds = auth.permissions.can('delivery:read') ? null : auth.permissions.scopeIds('delivery:read', 'AGENCY');
      if (agencyIds === null) visibility.push({});
      else if (agencyIds.length > 0) visibility.push({ agencyId: { in: agencyIds } });
    }
    if (visibility.length === 0) return { items: [], nextCursor: null };

    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.route.findMany({
        where: {
          AND: [
            { OR: visibility },
            {
              status: query.status,
              agencyId: query.agencyId,
              plannedDate: query.date ? new Date(`${query.date}T00:00:00Z`) : undefined,
              ...(query.cursor ? { id: { lt: query.cursor } } : {}),
            },
          ],
        },
        include: routeInclude,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map((r) => routeDto(r)), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  private async loadRoute(tx: Tx, auth: AuthContext, id: string, lock = false, mine = false): Promise<RouteFull> {
    if (lock) await tx.$queryRaw`SELECT id FROM routes WHERE id = ${id}::uuid FOR UPDATE`;
    const route = await tx.route.findUnique({ where: { id }, include: routeInclude });
    // Une tournée qu'on n'a pas le droit de voir est présentée comme inexistante
    const visible = route && (mine ? this.isRouteDriver(auth, route) : this.canSeeRoute(auth, route));
    if (!route || !visible) throw AppException.notFound('ROUTE_NOT_FOUND', 'Tournée introuvable');
    return route;
  }

  async getRoute(auth: AuthContext, id: string, mine = false) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const route = await this.loadRoute(tx, auth, id, false, mine);
      const policy = await this.companyPolicy(tx, auth.companyId);
      const stops = await tx.routeStop.findMany({ where: { routeId: id, status: { not: 'REMOVED' } }, include: stopInclude, orderBy: { sequence: 'asc' } });
      const authorized = await this.activeBeneficiaries(tx, stops.filter((s) => s.status === 'PENDING').map((s) => s.customerId));
      const rows = [];
      for (const stop of stops) {
        // Le solde ne concerne que les arrêts encore à traiter ; l'argent n'est montré qu'à ceux qui gèrent l'agence
        const showBalance = stop.status === 'PENDING' && this.canSeeAgency(auth, route.agencyId);
        const balance = showBalance ? await this.balanceOf(tx, stop.packageId, policy) : null;
        rows.push(stopDto(stop, balance ? { due: balance.due.toFixed(2), unbilled: balance.unbilled, currency: balance.currency } : null, stop.status === 'PENDING' ? (authorized.get(stop.customerId) ?? []) : []));
      }
      const counts = { delivered: stops.filter((s) => s.status === 'DELIVERED').length, failed: stops.filter((s) => s.status === 'FAILED').length };
      return { ...routeDto(route, counts), stops: rows, settings: await this.settings(tx) };
    });
  }

  async addStop(auth: AuthContext, routeId: string, input: { packageId: string; addressId?: string; instructions?: string }) {
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const route = await this.loadRoute(tx, auth, routeId, true);
        if (!this.canManage(auth, route.agencyId)) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette agence');
        if (route.status !== 'PLANNED') throw AppException.conflict('ROUTE_NOT_PLANNED', "On n'ajoute un arrêt qu'à une tournée planifiée");
        const pkg = await tx.package.findUnique({ where: { id: input.packageId }, include: { customer: { include: { user: true } } } });
        if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
        if (pkg.destinationAgencyId !== route.agencyId) throw AppException.conflict('WRONG_AGENCY', "Ce colis est destiné à une autre agence");
        if (!IN_AGENCY.includes(pkg.status)) throw AppException.conflict('PACKAGE_NOT_READY', "Le colis doit être reçu en agence ou prêt pour retrait");
        if (!pkg.customer || !pkg.customerId) throw AppException.conflict('CUSTOMER_REQUIRED', "Le colis n'a pas de client");
        const address = input.addressId
          ? await tx.customerAddress.findFirst({ where: { id: input.addressId, customerId: pkg.customerId, kind: 'DELIVERY' } })
          : await tx.customerAddress.findFirst({ where: { customerId: pkg.customerId, kind: 'DELIVERY' }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
        if (!address) throw AppException.unprocessable('NO_DELIVERY_ADDRESS', "Le client n'a pas d'adresse de livraison");
        const last = await tx.routeStop.aggregate({ where: { routeId }, _max: { sequence: true } });
        const stop = await tx.routeStop.create({
          data: {
            companyId: auth.companyId,
            routeId,
            packageId: pkg.id,
            customerId: pkg.customerId,
            sequence: (last._max.sequence ?? 0) + 1,
            instructions: input.instructions ?? address.instructions ?? undefined,
            addressSnapshot: {
              label: address.label,
              recipientName: address.recipientName,
              phone: address.phone,
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              region: address.region,
              country: address.country,
              postalCode: address.postalCode,
            },
          },
          include: stopInclude,
        });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'route.stop_added', entityType: 'route', entityId: routeId, after: { packageId: pkg.id, sequence: stop.sequence } });
        await this.outbox.emit(tx, {
          companyId: auth.companyId,
          eventCode: 'delivery.scheduled',
          aggregateType: 'package',
          aggregateId: pkg.id,
          customerId: pkg.customerId,
          payload: { customerName: displayName(pkg.customer), trackingNumber: formatTrackingNumber(pkg.trackingNumber), plannedDate: isoDay(route.plannedDate) },
        });
        return stopDto(stop, null);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('ALREADY_ON_ROUTE', 'Ce colis est déjà sur une tournée (ou a déjà figuré sur celle-ci)');
      throw error;
    }
  }

  async removeStop(auth: AuthContext, routeId: string, stopId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const route = await this.loadRoute(tx, auth, routeId, true);
      if (!this.canManage(auth, route.agencyId)) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette agence');
      if (route.status !== 'PLANNED') throw AppException.conflict('ROUTE_NOT_PLANNED', "On ne retire un arrêt que d'une tournée planifiée");
      const stop = await tx.routeStop.findFirst({ where: { id: stopId, routeId, status: 'PENDING' } });
      if (!stop) throw AppException.notFound('STOP_NOT_FOUND', 'Arrêt introuvable');
      await tx.routeStop.update({ where: { id: stopId }, data: { status: 'REMOVED' } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'route.stop_removed', entityType: 'route', entityId: routeId, after: { packageId: stop.packageId } });
    });
  }

  /** Départ de la tournée : tous les colis des arrêts passent « en cours de livraison » (tout ou rien). */
  async startRoute(auth: AuthContext, routeId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const route = await this.loadRoute(tx, auth, routeId, true);
      if (!this.canManage(auth, route.agencyId)) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette agence');
      if (route.status !== 'PLANNED') throw AppException.conflict('ROUTE_NOT_PLANNED', 'Cette tournée est déjà partie ou terminée');
      const stops = await tx.routeStop.findMany({ where: { routeId, status: 'PENDING' }, include: { package: { select: { id: true, trackingNumber: true, status: true } } } });
      if (stops.length === 0) throw AppException.conflict('ROUTE_EMPTY', "La tournée n'a aucun arrêt");
      const notReady = stops.filter((s) => !IN_AGENCY.includes(s.package.status));
      if (notReady.length > 0) {
        throw new AppException(409, 'PACKAGES_NOT_READY', "Certains colis ne sont plus prêts : retirez-les de la tournée", {
          packages: notReady.map((s) => ({ trackingNumber: s.package.trackingNumber, status: s.package.status })),
        });
      }
      for (const stop of stops) {
        await this.packages.transition(tx, auth.companyId, stop.packageId, 'OUT_FOR_DELIVERY', {
          actor: { userId: auth.userId, auth },
          owners: ['DELIVERY'],
          data: { routeId, routeReference: route.reference },
          locationLabel: route.agency.city,
        });
      }
      const now = new Date();
      const updated = await tx.route.update({ where: { id: routeId }, data: { status: 'IN_PROGRESS', startedAt: now }, include: routeInclude });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'route.started', entityType: 'route', entityId: routeId, after: { stops: stops.length } });
      return routeDto(updated);
    });
  }

  async cancelRoute(auth: AuthContext, routeId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const route = await this.loadRoute(tx, auth, routeId, true);
      if (!this.canManage(auth, route.agencyId)) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette agence');
      if (route.status !== 'PLANNED') throw AppException.conflict('ROUTE_NOT_PLANNED', "Seule une tournée planifiée peut être annulée");
      await tx.routeStop.updateMany({ where: { routeId, status: 'PENDING' }, data: { status: 'REMOVED' } });
      const updated = await tx.route.update({ where: { id: routeId }, data: { status: 'CANCELLED' }, include: routeInclude });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'route.cancelled', entityType: 'route', entityId: routeId });
      return routeDto(updated);
    });
  }

  async completeRoute(auth: AuthContext, routeId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const route = await this.loadRoute(tx, auth, routeId, true);
      if (!this.canManage(auth, route.agencyId)) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cette agence');
      if (route.status !== 'IN_PROGRESS') throw AppException.conflict('ROUTE_NOT_IN_PROGRESS', "Seule une tournée en cours peut être terminée");
      const pending = await tx.routeStop.count({ where: { routeId, status: 'PENDING' } });
      if (pending > 0) throw new AppException(409, 'ROUTE_HAS_PENDING_STOPS', 'Des arrêts ne sont pas traités (remis ou échoués)', { pending });
      const updated = await tx.route.update({ where: { id: routeId }, data: { status: 'COMPLETED', completedAt: new Date() }, include: routeInclude });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'route.completed', entityType: 'route', entityId: routeId });
      return routeDto(updated);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Code de remise (côté client)
  // ---------------------------------------------------------------------------------------------

  private hashCode(packageId: string, code: string): string {
    return createHmac('sha256', this.config.env.JWT_ACCESS_SECRET).update(`handover:${packageId}:${code}`).digest('hex');
  }

  /** Génère un nouveau code (l'ancien est annulé) et le montre une seule fois : seule son empreinte est conservée. */
  async generateCode(auth: AuthContext, packageId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = auth.kind === 'CUSTOMER' ? await tx.customer.findUnique({ where: { userId: auth.userId } }) : null;
      const pkg = customer ? await tx.package.findFirst({ where: { id: packageId, customerId: customer.id } }) : null;
      if (!customer || !pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      if (!['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'].includes(pkg.status)) {
        throw AppException.conflict('INVALID_STATE', "Le code de remise n'est disponible que lorsque le colis est en agence ou en cours de livraison");
      }
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${packageId}::uuid FOR UPDATE`;
      const recent = await tx.handoverCode.count({ where: { packageId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
      if (recent >= 5) throw new AppException(429, 'TOO_MANY_CODES', "Trop de codes demandés pour ce colis : réessayez dans une heure");
      const now = new Date();
      await tx.handoverCode.updateMany({ where: { packageId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(now.getTime() + HANDOVER_CODE_TTL_HOURS * 3_600_000);
      await tx.handoverCode.create({ data: { companyId: auth.companyId, packageId, customerId: customer.id, codeHash: this.hashCode(packageId, code), expiresAt } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'handover_code.generated', entityType: 'package', entityId: packageId });
      return { code, expiresAt };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Remise (cœur commun à l'agence et au livreur)
  // ---------------------------------------------------------------------------------------------

  private async checkProofs(
    tx: Tx,
    auth: AuthContext,
    pkg: Package & { destinationAgencyId: string | null },
    input: HandoverInput,
    settings: DeliverySettings,
  ): Promise<{ beneficiary: Beneficiary | null; recipientName: string; otpVerified: boolean; override: { reason: string } | null } | Fail> {
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: pkg.customerId! }, include: { user: true } });
    let beneficiary: Beneficiary | null = null;
    if (input.recipientKind === 'BENEFICIARY') {
      beneficiary = await tx.beneficiary.findFirst({ where: { id: input.beneficiaryId, customerId: customer.id, status: 'ACTIVE' } });
      const today = isoDay(new Date());
      const outOfDates = beneficiary && ((beneficiary.validFrom && isoDay(beneficiary.validFrom) > today) || (beneficiary.validTo && isoDay(beneficiary.validTo) < today));
      if (!beneficiary || outOfDates) return { fail: AppException.unprocessable('BENEFICIARY_INVALID', "Ce bénéficiaire n'est pas autorisé à retirer ce colis (inconnu, révoqué ou hors dates)") };
    }
    const recipientName = input.recipientName ?? beneficiary?.fullName ?? displayName(customer);

    // Pièce d'identité : type et 4 derniers caractères seulement
    if (settings.requireIdDocument && (!input.idDocumentType || !input.idDocumentLast4)) {
      return { fail: AppException.unprocessable('ID_DOCUMENT_REQUIRED', "La pièce d'identité de la personne qui reçoit est obligatoire (type et 4 derniers caractères)") };
    }
    if (beneficiary?.idDocumentLast4 && input.idDocumentLast4 && beneficiary.idDocumentLast4.toUpperCase() !== input.idDocumentLast4.toUpperCase()) {
      return { fail: AppException.unprocessable('ID_MISMATCH', "La pièce présentée ne correspond pas à celle déclarée pour ce bénéficiaire") };
    }

    // Photo de preuve : un fichier PHOTO déjà joint à CE colis
    if (settings.requirePhoto && !input.proofFileId) return { fail: AppException.unprocessable('PROOF_PHOTO_REQUIRED', 'Une photo de preuve est obligatoire') };
    if (input.proofFileId) {
      const file = await tx.fileObject.findFirst({ where: { id: input.proofFileId, ownerType: 'PACKAGE', ownerId: pkg.id, kind: 'PHOTO' }, select: { id: true } });
      if (!file) return { fail: AppException.unprocessable('PROOF_FILE_INVALID', "La photo de preuve doit être une photo jointe à ce colis") };
    }

    // Code de remise : les essais erronés sont comptés même si l'opération échoue (la transaction est validée)
    let otpVerified = false;
    if (settings.requireOtp && !input.otp && input.recipientKind !== 'RECIPIENT') return { fail: AppException.unprocessable('OTP_REQUIRED', 'Le code de remise du client est obligatoire') };
    if (input.otp) {
      const active = await tx.handoverCode.findFirst({ where: { packageId: pkg.id, usedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!active || active.expiresAt < new Date()) {
        return { fail: AppException.conflict('OTP_NOT_AVAILABLE', "Aucun code valide : le client doit en générer un depuis son espace") };
      }
      if (active.failedAttempts >= HANDOVER_CODE_MAX_FAILURES) {
        return { fail: AppException.conflict('OTP_LOCKED', 'Trop d’essais erronés : le client doit générer un nouveau code') };
      }
      const given = Buffer.from(this.hashCode(pkg.id, input.otp), 'hex');
      const expected = Buffer.from(active.codeHash, 'hex');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        const attempts = active.failedAttempts + 1;
        await tx.handoverCode.update({ where: { id: active.id }, data: { failedAttempts: attempts, ...(attempts >= HANDOVER_CODE_MAX_FAILURES ? { revokedAt: new Date() } : {}) } });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'handover_code.failed', entityType: 'package', entityId: pkg.id, after: { attempts } });
        return { fail: new AppException(422, 'OTP_INVALID', 'Code de remise incorrect', { remaining: Math.max(0, HANDOVER_CODE_MAX_FAILURES - attempts) }) };
      }
      otpVerified = true;
    }

    // Solde dû (DEL-05) : bloquant, sauf dérogation tracée de quelqu'un qui en a le droit
    const policy = await this.companyPolicy(tx, auth.companyId);
    const balance = await this.balanceOf(tx, pkg.id, policy);
    let override: { reason: string } | null = null;
    if (balance.blocked) {
      const scope = pkg.destinationAgencyId ? ({ type: 'AGENCY', id: pkg.destinationAgencyId } as const) : undefined;
      if (!input.overrideBalance) {
        return { fail: new AppException(409, 'BALANCE_DUE', balance.unbilled ? "Ce colis n'est pas encore facturé" : 'Un solde reste dû sur ce colis', { due: balance.due.toFixed(2), currency: balance.currency, unbilled: balance.unbilled }) };
      }
      if (!auth.permissions.can('delivery:override_balance', scope)) {
        return { fail: AppException.forbidden('OVERRIDE_NOT_ALLOWED', "Vous n'avez pas le droit d'autoriser une remise malgré un solde dû") };
      }
      override = { reason: input.overrideBalance.reason };
    }
    return { beneficiary, recipientName, otpVerified, override };
  }

  /** Remise réussie : preuves déjà contrôlées. Écrit statut, tentative, code utilisé et arrêt. */
  private async finishHandover(
    tx: Tx,
    auth: AuthContext,
    pkg: Package,
    input: HandoverInput,
    proofs: { beneficiary: Beneficiary | null; recipientName: string; otpVerified: boolean; override: { reason: string } | null },
    channel: 'ROUTE' | 'AGENCY',
    stop: RouteStop | null,
    asDriver: boolean,
  ) {
    const agency = pkg.destinationAgencyId ? await tx.agency.findUnique({ where: { id: pkg.destinationAgencyId }, select: { city: true } }) : null;
    await this.packages.transition(tx, auth.companyId, pkg.id, 'DELIVERED', {
      actor: asDriver ? { userId: auth.userId, bypassPermission: true } : { userId: auth.userId, auth },
      owners: ['DELIVERY'],
      data: { channel },
      locationLabel: agency?.city ?? null,
    });
    const now = new Date();
    await tx.handoverCode.updateMany({ where: { packageId: pkg.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
    await tx.deliveryAttempt.create({
      data: {
        companyId: auth.companyId,
        packageId: pkg.id,
        routeStopId: stop?.id,
        channel,
        outcome: 'SUCCEEDED',
        recipientKind: input.recipientKind,
        recipientName: proofs.recipientName,
        beneficiaryId: proofs.beneficiary?.id,
        idDocumentType: input.idDocumentType,
        idDocumentLast4: input.idDocumentLast4?.toUpperCase(),
        otpVerified: proofs.otpVerified,
        balanceOverridden: !!proofs.override,
        overrideReason: proofs.override?.reason,
        proofFileId: input.proofFileId,
        actorUserId: auth.userId,
        attemptedAt: now,
      },
    });
    if (stop) await tx.routeStop.update({ where: { id: stop.id }, data: { status: 'DELIVERED' } });
    await this.audit.record(tx, {
      companyId: auth.companyId,
      action: proofs.override ? 'delivery.completed_with_override' : 'delivery.completed',
      entityType: 'package',
      entityId: pkg.id,
      after: { channel, recipientKind: input.recipientKind, otpVerified: proofs.otpVerified, balanceOverridden: !!proofs.override, overrideReason: proofs.override?.reason ?? null },
    });
  }

  /** Remise au comptoir de l'agence. */
  async handoverAtAgency(auth: AuthContext, packageId: string, input: HandoverInput) {
    const result = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${packageId}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUnique({ where: { id: packageId } });
      // Hors périmètre : indistinguable d'un colis inexistant
      if (!pkg || !pkg.destinationAgencyId || !this.canHandOverAtAgency(auth, pkg.destinationAgencyId)) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      if (pkg.status !== 'READY_FOR_PICKUP') throw AppException.conflict('INVALID_STATE', 'Le colis doit être « prêt pour retrait » pour être remis au comptoir');
      if (!pkg.customerId) throw AppException.conflict('CUSTOMER_REQUIRED', "Le colis n'a pas de client");
      const settings = await this.settings(tx);
      const proofs = await this.checkProofs(tx, auth, pkg, input, settings);
      if (isFail(proofs)) return proofs;
      await this.finishHandover(tx, auth, pkg, input, proofs, 'AGENCY', null, false);
      return { ok: true as const };
    });
    if (isFail(result)) throw result.fail;
    return { delivered: true };
  }

  private async loadStop(tx: Tx, auth: AuthContext, stopId: string) {
    const stop = await tx.routeStop.findUnique({ where: { id: stopId } });
    if (!stop) throw AppException.notFound('STOP_NOT_FOUND', 'Arrêt introuvable');
    await tx.$queryRaw`SELECT id FROM routes WHERE id = ${stop.routeId}::uuid FOR UPDATE`;
    const route = await tx.route.findUniqueOrThrow({ where: { id: stop.routeId } });
    // Livreur de la tournée, ou responsable de l'agence : tout autre cas est un 404
    const asDriver = this.isRouteDriver(auth, route) && auth.permissions.has('delivery:confirm');
    const asManager = this.canHandOverAtAgency(auth, route.agencyId);
    if (!asDriver && !asManager) throw AppException.notFound('STOP_NOT_FOUND', 'Arrêt introuvable');
    if (route.status !== 'IN_PROGRESS') throw AppException.conflict('ROUTE_NOT_IN_PROGRESS', "La tournée n'est pas en cours");
    if (stop.status !== 'PENDING') throw AppException.conflict('STOP_ALREADY_HANDLED', 'Cet arrêt est déjà traité');
    return { stop, route, asDriver: asDriver && !asManager };
  }

  /** Remise par le livreur sur un arrêt de sa tournée. */
  async deliverStop(auth: AuthContext, stopId: string, input: HandoverInput) {
    const result = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const { stop, asDriver } = await this.loadStop(tx, auth, stopId);
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${stop.packageId}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUniqueOrThrow({ where: { id: stop.packageId } });
      if (pkg.status !== 'OUT_FOR_DELIVERY') throw AppException.conflict('INVALID_STATE', "Le colis n'est pas en cours de livraison");
      const settings = await this.settings(tx);
      const proofs = await this.checkProofs(tx, auth, pkg, input, settings);
      if (isFail(proofs)) return proofs;
      await this.finishHandover(tx, auth, pkg, input, proofs, 'ROUTE', stop, asDriver);
      return { ok: true as const };
    });
    if (isFail(result)) throw result.fail;
    return { delivered: true };
  }

  /** Livraison non aboutie : le colis revient « prêt pour retrait » à l'agence, le client est prévenu. */
  async failStop(auth: AuthContext, stopId: string, input: { reason: string; note?: string; rescheduleFor?: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const { stop, asDriver } = await this.loadStop(tx, auth, stopId);
      const pkg = await tx.package.findUniqueOrThrow({ where: { id: stop.packageId }, include: staffInclude });
      await this.packages.transition(tx, auth.companyId, pkg.id, 'READY_FOR_PICKUP', {
        // Le motif détaillé reste dans la tentative (privée) ; l'historique visible du client n'en montre que le code
        reason: `Livraison non aboutie : ${input.reason}`,
        actor: asDriver ? { userId: auth.userId, bypassPermission: true } : { userId: auth.userId, auth },
        owners: ['DELIVERY'],
        skipNotification: true,
        data: { channel: 'ROUTE', failureReason: input.reason },
        locationLabel: pkg.agency?.city ?? null,
      });
      await tx.deliveryAttempt.create({
        data: {
          companyId: auth.companyId,
          packageId: pkg.id,
          routeStopId: stop.id,
          channel: 'ROUTE',
          outcome: 'FAILED',
          failureReason: input.reason,
          note: input.note,
          rescheduleFor: input.rescheduleFor ? new Date(`${input.rescheduleFor}T00:00:00Z`) : undefined,
          actorUserId: auth.userId,
        },
      });
      await tx.routeStop.update({ where: { id: stop.id }, data: { status: 'FAILED' } });
      // Les codes déjà donnés restent valables : le client peut les réutiliser à la prochaine tentative
      const failedAttempts = await tx.deliveryAttempt.count({ where: { packageId: pkg.id, outcome: 'FAILED' } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'delivery.failed', entityType: 'package', entityId: pkg.id, after: { reason: input.reason, failedAttempts } });
      if (pkg.customer) {
        await this.outbox.emit(tx, {
          companyId: auth.companyId,
          eventCode: 'delivery.failed',
          aggregateType: 'package',
          aggregateId: pkg.id,
          customerId: pkg.customerId,
          payload: { customerName: displayName(pkg.customer), trackingNumber: formatTrackingNumber(pkg.trackingNumber) },
        });
      }
      return { failed: true, failedAttempts, returnSuggested: failedAttempts >= FAILED_ATTEMPTS_ALERT };
    });
  }

  /** Historique des tentatives d'un colis (personnel de l'agence). */
  async attempts(auth: AuthContext, packageId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId }, select: { destinationAgencyId: true, originWarehouseId: true } });
      const allowed = pkg && ((pkg.destinationAgencyId && this.canSeeAgency(auth, pkg.destinationAgencyId)) || auth.permissions.can('package:read', { type: 'WAREHOUSE', id: pkg.originWarehouseId }));
      if (!allowed) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      const rows = await tx.deliveryAttempt.findMany({ where: { packageId }, orderBy: { attemptedAt: 'desc' } });
      return {
        items: rows.map((a) => ({
          id: a.id,
          channel: a.channel,
          outcome: a.outcome,
          failureReason: a.failureReason,
          note: a.note,
          rescheduleFor: a.rescheduleFor ? isoDay(a.rescheduleFor) : null,
          recipientName: a.recipientName,
          recipientKind: a.recipientKind,
          idDocumentType: a.idDocumentType,
          idDocumentLast4: a.idDocumentLast4,
          otpVerified: a.otpVerified,
          balanceOverridden: a.balanceOverridden,
          overrideReason: a.overrideReason,
          attemptedAt: a.attemptedAt,
        })),
      };
    });
  }
}
