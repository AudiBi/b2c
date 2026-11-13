import { Injectable } from '@nestjs/common';
import { Prisma, type Agency, type Customer, type Package, type PackageEvent, type Warehouse } from '@prisma/client';
import {
  findTransition,
  formatTrackingNumber,
  isTerminal,
  type HoldReasonCode,
  type PackageStatus,
  type CreateCounterPackageInput,
  type ReceivePackageInput,
  type RegisterPackageInput,
  type TransitionOwner,
  type EventCode,
} from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import { displayName, OutboxService } from '../notifications/outbox.service';
import { calculate, PricingError, toDimensionUnit, toWeightUnit } from '../pricing/calculator';
import { PricingService, toCardData } from '../pricing/pricing.service';
import type { AuthContext } from '../security/auth.types';
import { TrackingNumberService } from './tracking-number.service';

const D = Prisma.Decimal;

/** Normalise un numéro de suivi marchand pour le rapprochement : majuscules, sans espaces. */
export const normalizeSupplierTracking = (value: string | undefined | null): string | null => {
  const clean = value?.toUpperCase().replace(/\s+/g, '');
  return clean ? clean : null;
};

export interface TransitionOptions {
  reason?: string;
  holdReasonCode?: HoldReasonCode;
  data?: Record<string, unknown>;
  /** Acteur : `auth` (contrôle des permissions et des portées) ; `bypassPermission` pour les actes du propriétaire (client) ou du système. */
  actor: { userId: string | null; auth?: AuthContext; bypassPermission?: boolean };
  /** Limite les modules propriétaires acceptés (l'API générique n'accepte que PACKAGES et BILLING). */
  owners?: readonly TransitionOwner[];
  visibility?: 'PUBLIC' | 'PRIVATE';
  /** Lieu affiché dans l'historique ; absent : ville de l'entrepôt d'origine. null : aucun lieu. */
  locationLabel?: string | null;
  /** L'appelant envoie lui-même la notification adaptée (évite le message automatique de ce statut). */
  skipNotification?: boolean;
}

type PackageWithRelations = Package & { warehouse: Warehouse; agency: Agency | null; customer: (Customer & { user: { firstName: string; lastName: string; businessName: string | null } }) | null };

export const staffInclude = {
  warehouse: true,
  agency: true,
  customer: { include: { user: { select: { firstName: true, lastName: true, businessName: true } } } },
} satisfies Prisma.PackageInclude;

const decimalOrNull = (value: Prisma.Decimal | null) => (value ? value.toString() : null);

/** Vue complète pour le personnel. */
export function staffPackageDto(pkg: PackageWithRelations) {
  const customerName = pkg.customer
    ? pkg.customer.customerType === 'BUSINESS' && pkg.customer.user.businessName
      ? pkg.customer.user.businessName
      : `${pkg.customer.user.firstName} ${pkg.customer.user.lastName}`
    : null;
  return {
    id: pkg.id,
    trackingNumber: pkg.trackingNumber,
    trackingNumberDisplay: formatTrackingNumber(pkg.trackingNumber),
    status: pkg.status,
    previousStatus: pkg.previousStatus,
    customer: pkg.customer ? { id: pkg.customer.id, customerCode: pkg.customer.customerCode, name: customerName } : null,
    senderName: pkg.senderName,
    recipientName: pkg.recipientName,
    warehouse: { id: pkg.warehouse.id, reference: pkg.warehouse.reference, name: pkg.warehouse.name, city: pkg.warehouse.city },
    originCountry: pkg.originCountry,
    originCity: pkg.originCity,
    destinationCountry: pkg.destinationCountry,
    destinationCity: pkg.destinationCity,
    transportMode: pkg.transportMode,
    supplierTracking: pkg.supplierTracking,
    contentDescription: pkg.contentDescription,
    declaredValue: decimalOrNull(pkg.declaredValue),
    declaredCurrency: pkg.declaredCurrency,
    insured: pkg.insured,
    groupId: pkg.groupId,
    measures: {
      actualWeightKg: decimalOrNull(pkg.actualWeightKg),
      lengthCm: decimalOrNull(pkg.lengthCm),
      widthCm: decimalOrNull(pkg.widthCm),
      heightCm: decimalOrNull(pkg.heightCm),
      volumetricWeight: decimalOrNull(pkg.volumetricWeight),
      billableWeight: decimalOrNull(pkg.billableWeight),
      weightUnit: pkg.weightUnit,
    },
    pricing: pkg.pricingSnapshot
      ? {
          rateCardId: pkg.rateCardId,
          freight: decimalOrNull(pkg.shippingFee),
          extras: decimalOrNull(pkg.extraFees),
          currency: pkg.feeCurrency,
          detail: pkg.pricingSnapshot,
        }
      : null,
    destinationAgencyId: pkg.destinationAgencyId,
    locationId: pkg.locationId,
    agencyInfo: pkg.agency,
    receivedAt: pkg.receivedAt,
    registeredAt: pkg.registeredAt,
    createdAt: pkg.createdAt,
    version: pkg.version,
  };
}

const PICKUP_STATUSES = ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];

/** Point de retrait montré au client : seulement lorsque le colis est réellement arrivé dans une agence. */
export function pickupPoint(agency: Agency | null, status: string, publicOnly = false) {
  if (!agency || !PICKUP_STATUSES.includes(status) || (publicOnly && !agency.publicVisible)) return null;
  return { name: agency.name, kind: agency.kind, city: agency.city, country: agency.country, addressLine: agency.addressLine, phone: agency.phone, hours: agency.hours, ready: status === 'READY_FOR_PICKUP' };
}

/**
 * Vue du client propriétaire. Les montants calculés à la pesée sont « provisoires » : la facture (phase 7)
 * fait foi. Ne contient ni identité du personnel, ni notes internes.
 */
export function ownerPackageDto(pkg: PackageWithRelations) {
  const staff = staffPackageDto(pkg);
  return {
    id: staff.id,
    trackingNumber: staff.trackingNumber,
    trackingNumberDisplay: staff.trackingNumberDisplay,
    status: staff.status,
    transportMode: staff.transportMode,
    supplierTracking: staff.supplierTracking,
    contentDescription: staff.contentDescription,
    origin: { country: staff.originCountry, city: staff.originCity, warehouse: staff.warehouse.name },
    destination: { country: staff.destinationCountry, city: staff.destinationCity },
    measures: {
      actualWeightKg: staff.measures.actualWeightKg,
      billableWeight: staff.measures.billableWeight,
      weightUnit: staff.measures.weightUnit,
    },
    fees: staff.pricing && staff.pricing.freight !== null
      ? { freight: staff.pricing.freight, extras: staff.pricing.extras, currency: staff.pricing.currency, provisional: true }
      : null,
    pickup: pickupPoint(staff.agencyInfo, staff.status),
    receivedAt: staff.receivedAt,
    createdAt: staff.createdAt,
  };
}

/** Motifs de retenue qu'on ne montre pas à quiconque détient le numéro de suivi (le client propriétaire les voit). */
const PRIVATE_HOLD_REASONS = new Set(['SUSPICIOUS_CONTENT', 'PROHIBITED_ITEM']);

/**
 * Événement visible par le client ou publiquement : jamais l'acteur, jamais le texte libre du personnel.
 * Pour le suivi public, un motif sensible est remplacé par « OTHER ».
 */
export function publicEventDto(event: PackageEvent, audience: 'OWNER' | 'PUBLIC' = 'OWNER') {
  const data = (event.data ?? {}) as { holdReasonCode?: string };
  const code = data.holdReasonCode ?? null;
  return {
    type: event.eventType,
    status: event.toStatus,
    occurredAt: event.occurredAt,
    location: event.locationLabel,
    reasonCode: audience === 'PUBLIC' && code && PRIVATE_HOLD_REASONS.has(code) ? 'OTHER' : code,
  };
}

@Injectable()
export class PackagesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly tracking: TrackingNumberService,
    private readonly pricing: PricingService,
    private readonly counters: CounterService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Machine d'états : SEUL point d'écriture du statut d'un colis
  // ---------------------------------------------------------------------------------------------

  async transition(tx: Tx, companyId: string, packageId: string, to: PackageStatus, options: TransitionOptions): Promise<PackageWithRelations> {
    // Verrou de ligne : deux changements simultanés se sérialisent, le second voit le nouveau statut
    await tx.$queryRaw`SELECT id FROM packages WHERE id = ${packageId}::uuid FOR UPDATE`;
    const pkg = await tx.package.findUnique({ where: { id: packageId }, include: staffInclude });
    if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');

    const rule = findTransition(pkg.status, to, pkg.previousStatus);
    if (!rule) {
      throw new AppException(409, 'INVALID_TRANSITION', `Transition interdite : ${pkg.status} → ${to}`, { from: pkg.status, to });
    }
    if (options.owners && !options.owners.includes(rule.owner)) {
      throw new AppException(409, 'TRANSITION_NOT_AVAILABLE', "Cette transition est pilotée par un autre module (lot, livraison ou paiement)", { from: pkg.status, to, owner: rule.owner });
    }
    if (!options.actor.bypassPermission) {
      const auth = options.actor.auth;
      if (!auth || !rule.permission) throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante');
      // Portée selon la famille de la permission : agence de destination pour agency:* et delivery:*, entrepôt d'origine sinon
      const scope = /^(agency|delivery):/.test(rule.permission)
        ? pkg.destinationAgencyId ? ({ type: 'AGENCY', id: pkg.destinationAgencyId } as const) : undefined
        : ({ type: 'WAREHOUSE', id: pkg.originWarehouseId } as const);
      if (!auth.permissions.can(rule.permission, scope)) {
        throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante');
      }
    }
    const reason = options.reason?.trim();
    if (rule.reasonRequired && !reason) throw AppException.badRequest('REASON_REQUIRED', 'Un motif est obligatoire pour cette transition');

    const now = new Date();
    const leavingHold = pkg.status === 'ON_HOLD';
    const enteringHold = to === 'ON_HOLD';
    const holdReasonCode = options.holdReasonCode ?? 'OTHER';

    if (enteringHold) {
      await tx.packageHold.create({
        data: { companyId, packageId, reasonCode: holdReasonCode, note: reason, openedBy: options.actor.userId },
      });
    }
    if (leavingHold) {
      await tx.packageHold.updateMany({
        where: { packageId, releasedAt: null },
        data: { releasedAt: now, releasedBy: options.actor.userId },
      });
    }

    const updated = await tx.package.update({
      where: { id: packageId },
      data: {
        status: to,
        previousStatus: enteringHold ? pkg.status : null,
        version: { increment: 1 },
        ...(to === 'RECEIVED_AT_WAREHOUSE' ? { receivedAt: now } : {}),
      },
      include: staffInclude,
    });

    await tx.packageEvent.create({
      data: {
        companyId,
        packageId,
        fromStatus: pkg.status,
        toStatus: to,
        eventType: 'STATUS_CHANGE',
        actorUserId: options.actor.userId,
        reason: reason ?? null,
        visibility: options.visibility ?? 'PUBLIC',
        locationLabel: options.locationLabel === undefined ? pkg.warehouse.city : options.locationLabel,
        data: ({ ...(options.data ?? {}), ...(enteringHold ? { holdReasonCode } : {}) } as Prisma.InputJsonValue),
        occurredAt: now,
      },
    });
    // Une reprise après retenue ne ré-annonce pas l'étape déjà annoncée
    if (!leavingHold && !options.skipNotification) await this.emitForStatus(tx, companyId, updated, to);
    await this.audit.record(tx, {
      companyId,
      action: 'package.status_changed',
      entityType: 'package',
      entityId: packageId,
      actorUserId: options.actor.userId ?? undefined,
      before: { status: pkg.status },
      after: { status: to, reason: reason ?? null },
    });
    return updated;
  }

  private async emitForStatus(tx: Tx, companyId: string, pkg: PackageWithRelations, to: PackageStatus): Promise<void> {
    const events: Partial<Record<PackageStatus, EventCode>> = {
      RECEIVED_AT_WAREHOUSE: 'package.received',
      IN_TRANSIT: 'shipment.dispatched',
      ARRIVED_DESTINATION: 'shipment.arrived',
      READY_FOR_PICKUP: 'package.available_at_agency',
      ON_HOLD: 'package.incident',
      DELIVERED: 'package.delivered',
    };
    await this.emitPackageEvent(tx, companyId, pkg, events[to]);
  }

  /** Notification liée à un colis (sans client : rien à notifier). */
  async emitPackageEvent(tx: Tx, companyId: string, pkg: PackageWithRelations, eventCode: EventCode | undefined): Promise<void> {
    if (!eventCode || !pkg.customer) return;
    await this.outbox.emit(tx, {
      companyId,
      eventCode,
      aggregateType: 'package',
      aggregateId: pkg.id,
      customerId: pkg.customerId,
      payload: {
        customerName: displayName(pkg.customer),
        trackingNumber: formatTrackingNumber(pkg.trackingNumber),
        warehouseCity: pkg.warehouse.city,
        agencyName: pkg.agency?.name ?? '',
        agencyCity: pkg.agency?.city ?? '',
      },
    });
  }

  /** Changement de statut demandé par le personnel (API générique : modules PACKAGES et BILLING seulement). */
  async transitionByStaff(auth: AuthContext, packageId: string, input: { to: PackageStatus; reason?: string; holdReasonCode?: HoldReasonCode }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const updated = await this.transition(tx, auth.companyId, packageId, input.to, {
        reason: input.reason,
        holdReasonCode: input.holdReasonCode,
        actor: { userId: auth.userId, auth },
        owners: ['PACKAGES', 'BILLING'],
      });
      if (input.to === 'CANCELLED') {
        await tx.prealert.updateMany({ where: { packageId, status: 'OPEN' }, data: { status: 'CANCELLED' } });
      }
      return staffPackageDto(updated);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Réception en entrepôt et rapprochement
  // ---------------------------------------------------------------------------------------------

  private assertWarehouseScope(auth: AuthContext, permission: 'package:receive' | 'package:register' | 'package:read' | 'package:update', warehouseId: string): void {
    if (!auth.permissions.can(permission, { type: 'WAREHOUSE', id: warehouseId })) {
      throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante pour cet entrepôt');
    }
  }

  async receive(auth: AuthContext, input: ReceivePackageInput) {
    this.assertWarehouseScope(auth, 'package:receive', input.warehouseId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, status: 'ACTIVE' } });
      if (!warehouse) throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable ou inactif');

      const supplier = normalizeSupplierTracking(input.supplierTracking);
      const matchExpected = (pkg: PackageWithRelations, method: string, manual: boolean) => this.receiveExpected(tx, auth, pkg, warehouse, input, method, manual);

      // 1. Choix manuel de l'agent
      if (input.expectedPackageId) {
        const expected = await tx.package.findFirst({ where: { id: input.expectedPackageId, status: 'AWAITING_RECEIPT' }, include: staffInclude });
        if (!expected) throw AppException.conflict('NOT_EXPECTED', "Ce colis n'est pas en attente de réception");
        return matchExpected(expected, 'MANUAL_SELECTION', true);
      }

      // 2. Rapprochement automatique : numéro de suivi du marchand, correspondance EXACTE
      if (supplier) {
        const bySupplier = await tx.package.findMany({ where: { supplierTracking: supplier, status: 'AWAITING_RECEIPT' }, include: staffInclude, take: 6 });
        if (bySupplier.length === 1) return matchExpected(bySupplier[0], 'SUPPLIER_TRACKING', false);
        if (bySupplier.length > 1) throw this.ambiguous(bySupplier);
      }

      // 3. Code client lu sur l'étiquette
      let customer: Customer | null = null;
      if (input.customerCode) {
        customer = await tx.customer.findFirst({ where: { customerCode: input.customerCode } });
        if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Code client inconnu');
        const expected = await tx.package.findMany({ where: { customerId: customer.id, status: 'AWAITING_RECEIPT' }, include: staffInclude, take: 6 });
        if (expected.length === 1) return matchExpected(expected[0], 'CUSTOMER_CODE_SINGLE', false);
        if (expected.length > 1) throw this.ambiguous(expected);
      }

      // 4. Aucun colis attendu : nouveau colis (identifié par le code client, sinon non identifié)
      const created = await this.createReceived(tx, auth, warehouse, customer, input, supplier);
      return { package: staffPackageDto(created), match: { status: customer ? 'NO_PREALERT' : 'UNIDENTIFIED', method: customer ? 'CUSTOMER_CODE' : 'NONE' } };
    });
  }

  /** Colis créé au comptoir : le client (avec ou sans accès au site) dépose un colis pour un destinataire. Aboutit à « reçu en entrepôt ». */
  async createAtCounter(auth: AuthContext, input: CreateCounterPackageInput) {
    this.assertWarehouseScope(auth, 'package:receive', input.warehouseId);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, status: 'ACTIVE' } });
      if (!warehouse) throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable ou inactif');
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
      if (input.destinationAgencyId && !(await tx.agency.findUnique({ where: { id: input.destinationAgencyId }, select: { id: true } }))) {
        throw AppException.notFound('AGENCY_NOT_FOUND', 'Agence introuvable');
      }
      if (input.legacyTrackingNumber && (await tx.package.findFirst({ where: { legacyTrackingNumber: input.legacyTrackingNumber }, select: { id: true } }))) {
        throw AppException.conflict('LEGACY_TRACKING_EXISTS', 'Cet ancien numéro de suivi existe déjà');
      }
      const created = await this.createReceived(
        tx,
        auth,
        warehouse,
        customer,
        { warehouseId: input.warehouseId, transportMode: input.transportMode, notes: input.notes } as ReceivePackageInput,
        null,
      );
      const updated = await tx.package.update({
        where: { id: created.id },
        data: {
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          recipientCity: input.recipientCity,
          destinationCity: input.recipientCity ?? created.destinationCity,
          destinationAgencyId: input.destinationAgencyId,
          contentDescription: input.contentDescription,
          legacyTrackingNumber: input.legacyTrackingNumber,
          createdAtCounter: true,
        },
        include: staffInclude,
      });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'package.created_at_counter',
        entityType: 'package',
        entityId: created.id,
        after: { customerCode: customer.customerCode, recipientName: input.recipientName, legacyTrackingNumber: input.legacyTrackingNumber ?? null },
      });
      return staffPackageDto(updated);
    });
  }

  ambiguous(candidates: PackageWithRelations[]): AppException {
    return new AppException(409, 'AMBIGUOUS_MATCH', 'Plusieurs colis attendus correspondent : choisissez-en un (expectedPackageId)', {
      candidates: candidates.map((c) => ({ id: c.id, trackingNumber: c.trackingNumber, supplierTracking: c.supplierTracking, customerCode: c.customer?.customerCode ?? null, description: c.contentDescription })),
    });
  }

  async receiveExpected(tx: Tx, auth: AuthContext, expected: PackageWithRelations, warehouse: Warehouse, input: ReceivePackageInput, method: string, manual: boolean) {
    // L'entrepôt réel peut différer de celui que le client avait choisi
    if (expected.originWarehouseId !== warehouse.id) {
      await tx.package.update({
        where: { id: expected.id },
        data: { originWarehouseId: warehouse.id, originCountry: warehouse.country, originCity: warehouse.city },
      });
    }
    const updated = await this.transition(tx, auth.companyId, expected.id, 'RECEIVED_AT_WAREHOUSE', {
      actor: { userId: auth.userId, auth },
      data: { matchMethod: method, matchedPrealert: true },
    });
    if (input.senderName || input.notes) {
      await tx.package.update({ where: { id: expected.id }, data: { senderName: input.senderName ?? undefined } });
    }
    if (input.notes) await this.addNoteInternal(tx, auth, expected.id, input.notes);
    await tx.prealert.updateMany({
      where: { packageId: expected.id },
      data: { status: manual ? 'MATCHED_MANUAL' : 'MATCHED_AUTO', matchedByUserId: auth.userId, matchedAt: new Date() },
    });
    return { package: staffPackageDto(updated), match: { status: manual ? 'MATCHED_MANUAL' : 'MATCHED_AUTO', method } };
  }

  async createReceived(tx: Tx, auth: AuthContext, warehouse: Warehouse, customer: Customer | null, input: ReceivePackageInput, supplier: string | null) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { trackingPrefix: true } });
    const trackingNumber = await this.tracking.issue(tx, company.trackingPrefix);
    const delivery = customer
      ? await tx.customerAddress.findFirst({ where: { customerId: customer.id, kind: 'DELIVERY' }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] })
      : null;
    const now = new Date();
    const created = await tx.package.create({
      data: {
        companyId: auth.companyId,
        trackingNumber,
        customerId: customer?.id ?? null,
        senderName: input.senderName,
        originWarehouseId: warehouse.id,
        originCountry: warehouse.country,
        originCity: warehouse.city,
        // Marché initial : Haïti, à défaut d'adresse de livraison du client
        destinationCountry: delivery?.country ?? 'HT',
        destinationCity: delivery?.city ?? null,
        transportMode: input.transportMode ?? null,
        supplierTracking: supplier,
        status: 'RECEIVED_AT_WAREHOUSE',
        receivedAt: now,
        createdBy: auth.userId,
      },
      include: staffInclude,
    });
    await tx.packageEvent.create({
      data: {
        companyId: auth.companyId,
        packageId: created.id,
        fromStatus: null,
        toStatus: 'RECEIVED_AT_WAREHOUSE',
        eventType: 'RECEIVED',
        actorUserId: auth.userId,
        locationLabel: warehouse.city,
        data: { identified: customer !== null, matchedPrealert: false },
        occurredAt: now,
      },
    });
    await this.audit.record(tx, {
      companyId: auth.companyId,
      action: customer ? 'package.received_without_prealert' : 'package.received_unidentified',
      entityType: 'package',
      entityId: created.id,
      after: { warehouse: warehouse.reference, customerCode: customer?.customerCode ?? null },
    });
    if (input.notes) await this.addNoteInternal(tx, auth, created.id, input.notes);
    await this.emitPackageEvent(tx, auth.companyId, created, 'package.received');
    return created;
  }

  // ---------------------------------------------------------------------------------------------
  // Identification d'un colis reçu sans client
  // ---------------------------------------------------------------------------------------------

  async identify(auth: AuthContext, packageId: string, input: { customerCode: string; mergeIntoPackageId?: string; transportMode?: 'AIR' | 'SEA' }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${packageId}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUnique({ where: { id: packageId }, include: staffInclude });
      if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      this.assertWarehouseScope(auth, 'package:update', pkg.originWarehouseId);
      if (pkg.customerId) throw AppException.conflict('ALREADY_IDENTIFIED', 'Ce colis a déjà un client');
      if (pkg.status !== 'RECEIVED_AT_WAREHOUSE' && pkg.status !== 'UNDER_INSPECTION') {
        throw AppException.conflict('INVALID_STATE', "Un colis ne s'identifie qu'après réception et avant la pesée");
      }
      const customer = await tx.customer.findFirst({ where: { customerCode: input.customerCode } });
      if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Code client inconnu');

      if (input.mergeIntoPackageId) {
        const expected = await tx.package.findFirst({
          where: { id: input.mergeIntoPackageId, customerId: customer.id, status: 'AWAITING_RECEIPT' },
          include: staffInclude,
        });
        if (!expected) throw AppException.conflict('NOT_EXPECTED', "Le colis attendu n'existe pas pour ce client ou n'est plus en attente");
        // Le colis physique est fusionné dans le colis attendu : le client garde le numéro de suivi qu'il connaît
        await tx.package.update({
          where: { id: expected.id },
          data: { originWarehouseId: pkg.originWarehouseId, originCountry: pkg.originCountry, originCity: pkg.originCity, senderName: pkg.senderName ?? expected.senderName },
        });
        const received = await this.transition(tx, auth.companyId, expected.id, 'RECEIVED_AT_WAREHOUSE', {
          actor: { userId: auth.userId, auth },
          data: { matchMethod: 'IDENTIFICATION', mergedFrom: pkg.trackingNumber },
        });
        await tx.prealert.updateMany({ where: { packageId: expected.id }, data: { status: 'MATCHED_MANUAL', matchedByUserId: auth.userId, matchedAt: new Date() } });
        await tx.fileObject.updateMany({ where: { ownerType: 'PACKAGE', ownerId: pkg.id }, data: { ownerId: expected.id } });
        // Les notes internes et le fil du colis non identifié sont conservés dans son historique
        await this.transition(tx, auth.companyId, pkg.id, 'CANCELLED', {
          reason: `Fusionné dans ${expected.trackingNumber}`,
          actor: { userId: auth.userId, bypassPermission: true },
          visibility: 'PRIVATE',
          data: { mergedInto: expected.trackingNumber },
        });
        return { package: staffPackageDto(received), merged: { cancelledTrackingNumber: pkg.trackingNumber } };
      }

      const updated = await tx.package.update({
        where: { id: pkg.id },
        data: { customerId: customer.id, transportMode: input.transportMode ?? pkg.transportMode, version: { increment: 1 } },
        include: staffInclude,
      });
      await tx.packageEvent.create({
        data: {
          companyId: auth.companyId,
          packageId: pkg.id,
          eventType: 'IDENTIFIED',
          actorUserId: auth.userId,
          visibility: 'PRIVATE',
          data: { customerCode: customer.customerCode },
        },
      });
      await this.emitPackageEvent(tx, auth.companyId, updated, 'package.identified');
      await this.audit.record(tx, { companyId: auth.companyId, action: 'package.identified', entityType: 'package', entityId: pkg.id, after: { customerCode: customer.customerCode } });
      return { package: staffPackageDto(updated), merged: null };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Enregistrement, pesée et calcul des frais
  // ---------------------------------------------------------------------------------------------

  async register(auth: AuthContext, packageId: string, input: RegisterPackageInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM packages WHERE id = ${packageId}::uuid FOR UPDATE`;
      const pkg = await tx.package.findUnique({ where: { id: packageId }, include: staffInclude });
      if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      this.assertWarehouseScope(auth, 'package:register', pkg.originWarehouseId);
      if (pkg.status !== 'RECEIVED_AT_WAREHOUSE' && pkg.status !== 'UNDER_INSPECTION') {
        throw AppException.conflict('INVALID_STATE', "Un colis ne se pèse qu'après réception (statut reçu ou en vérification)");
      }
      if (!pkg.customerId) throw AppException.conflict('CUSTOMER_REQUIRED', "Identifiez le client avant de peser le colis");
      // Le mode connu (préalerte) ne se change pas ici ; il ne se renseigne que s'il manque
      const mode = pkg.transportMode ?? input.transportMode;
      if (!mode) throw AppException.conflict('TRANSPORT_MODE_REQUIRED', 'Le mode de transport doit être connu avant la pesée');

      let categoryId: string | null = null;
      if (input.categoryCode) {
        const category = await tx.packageCategory.findFirst({ where: { code: input.categoryCode.toUpperCase(), active: true } });
        if (!category) throw AppException.badRequest('CATEGORY_UNKNOWN', 'Catégorie de marchandise inconnue');
        categoryId = category.id;
      }

      // Mesures réelles dans les unités canoniques (kg, cm)
      const weightKg = toWeightUnit(new D(String(input.weight.value)), input.weight.unit, 'KG').toDecimalPlaces(3, D.ROUND_HALF_UP);
      const cm = (v: number) => toDimensionUnit(new D(String(v)), input.dimensions.unit, 'CM').toDecimalPlaces(2, D.ROUND_HALF_UP);
      const [lengthCm, widthCm, heightCm] = [cm(input.dimensions.length), cm(input.dimensions.width), cm(input.dimensions.height)];
      if (weightKg.lte(0) || lengthCm.lte(0) || widthCm.lte(0) || heightCm.lte(0)) {
        throw AppException.badRequest('MEASURES_TOO_SMALL', 'Mesures trop petites après conversion');
      }

      // Frais calculés à partir des MESURES RÉELLES et de la grille active (jamais inventés)
      const card = await this.pricing.findActiveCard(tx, { transportMode: mode, originCountry: pkg.originCountry, destinationCountry: pkg.destinationCountry });
      let snapshot: Prisma.InputJsonValue | null = null;
      let pricingData: Prisma.PackageUncheckedUpdateInput = {};
      if (card) {
        const data = toCardData(card);
        if (input.insured && !data.surcharges.some((s) => s.code === 'INSURANCE' && s.optional)) {
          throw AppException.badRequest('INSURANCE_UNAVAILABLE', "Cette grille ne propose pas d'assurance");
        }
        try {
          const result = calculate(data, {
            weight: input.weight,
            dimensions: input.dimensions,
            categoryCode: input.categoryCode,
            declaredValue: input.declaredValue,
            optionalSurcharges: input.insured ? ['INSURANCE'] : [],
            quantity: input.quantity,
          });
          const freight = new D(result.freight);
          snapshot = { kind: 'COMPUTED_AT_WEIGHING', card: { id: card.id, name: card.name, version: card.version }, result } as unknown as Prisma.InputJsonValue;
          pricingData = {
            volumetricWeight: result.volumetricWeight ? new D(result.volumetricWeight) : null,
            // Volume et unités ne sont pas des poids : le détail est dans l'instantané du calcul
            billableWeight: result.basis === 'WEIGHT' ? new D(result.billableWeight) : null,
            weightUnit: result.basis === 'WEIGHT' ? result.weightUnit : null,
            shippingFee: freight,
            extraFees: new D(result.total).sub(freight),
            feeCurrency: result.currency,
          };
        } catch (error) {
          if (!(error instanceof PricingError)) throw error;
          if (error.code !== 'NO_RULE_FOR_WEIGHT') throw AppException.badRequest(error.code, error.message);
          snapshot = { kind: 'TARIFF_UNAVAILABLE', reason: error.code, card: { id: card.id, name: card.name, version: card.version } } as unknown as Prisma.InputJsonValue;
        }
      } else {
        snapshot = { kind: 'TARIFF_UNAVAILABLE', reason: 'NO_ACTIVE_RATE_CARD' } as unknown as Prisma.InputJsonValue;
      }

      await tx.package.update({
        where: { id: packageId },
        data: {
          actualWeightKg: weightKg,
          lengthCm,
          widthCm,
          heightCm,
          contentDescription: input.contentDescription ?? pkg.contentDescription,
          declaredValue: input.declaredValue !== undefined ? new D(String(input.declaredValue)) : pkg.declaredValue,
          declaredCurrency: input.declaredCurrency ?? pkg.declaredCurrency,
          insured: input.insured,
          quantity: input.quantity,
          categoryId,
          registeredAt: new Date(),
          transportMode: mode,
          pricingSnapshot: snapshot ?? Prisma.DbNull,
          ...(card ? { rateCardId: card.id } : {}),
          ...pricingData,
        },
      });
      await tx.packageEvent.create({
        data: {
          companyId: auth.companyId,
          packageId,
          eventType: 'WEIGHED',
          actorUserId: auth.userId,
          visibility: 'PRIVATE',
          locationLabel: pkg.warehouse.city,
          data: { weightKg: weightKg.toString(), lengthCm: lengthCm.toString(), widthCm: widthCm.toString(), heightCm: heightCm.toString(), tariff: (snapshot as { kind?: string })?.kind },
        },
      });
      const updated = await this.transition(tx, auth.companyId, packageId, 'REGISTERED_WEIGHED', { actor: { userId: auth.userId, auth } });
      return staffPackageDto(updated);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Notes, groupes
  // ---------------------------------------------------------------------------------------------

  private async addNoteInternal(tx: Tx, auth: AuthContext, packageId: string, note: string) {
    await tx.packageEvent.create({
      data: { companyId: auth.companyId, packageId, eventType: 'NOTE', actorUserId: auth.userId, reason: note, visibility: 'PRIVATE' },
    });
  }

  async addNote(auth: AuthContext, packageId: string, note: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId } });
      if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      this.assertWarehouseScope(auth, 'package:update', pkg.originWarehouseId);
      await this.addNoteInternal(tx, auth, packageId, note);
      return { status: 'noted' };
    });
  }

  /** Regroupe des colis du même client en un seul groupe (consolidation). */
  async group(auth: AuthContext, packageIds: string[]) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const unique = [...new Set(packageIds)];
      if (unique.length !== packageIds.length) throw AppException.badRequest('DUPLICATE_PACKAGES', 'Colis en double');
      const packages = await tx.package.findMany({ where: { id: { in: unique } } });
      if (packages.length !== unique.length) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Un des colis est introuvable');
      for (const pkg of packages) this.assertWarehouseScope(auth, 'package:update', pkg.originWarehouseId);
      const customers = new Set(packages.map((p) => p.customerId));
      if (customers.size !== 1 || customers.has(null)) throw AppException.badRequest('GROUP_CUSTOMER_MISMATCH', 'Les colis doivent appartenir au même client identifié');
      if (packages.some((p) => p.groupId)) throw AppException.conflict('ALREADY_GROUPED', 'Un des colis est déjà dans un groupe');
      if (packages.some((p) => isTerminal(p.status))) throw AppException.conflict('INVALID_STATE', 'Un colis terminé ne peut pas être regroupé');
      const sequence = await this.counters.next(tx, auth.companyId, 'package-group');
      const group = await tx.packageGroup.create({
        data: { companyId: auth.companyId, customerId: packages[0].customerId!, reference: `GRP-${String(sequence).padStart(6, '0')}`, createdBy: auth.userId },
      });
      await tx.package.updateMany({ where: { id: { in: unique } }, data: { groupId: group.id } });
      await tx.packageEvent.createMany({
        data: unique.map((id) => ({ companyId: auth.companyId, packageId: id, eventType: 'GROUPED', actorUserId: auth.userId, visibility: 'PRIVATE' as const, data: { group: group.reference } })),
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'package.grouped', entityType: 'package_group', entityId: group.id, after: { reference: group.reference, count: unique.length } });
      return { id: group.id, reference: group.reference, packageIds: unique };
    });
  }

  async ungroup(auth: AuthContext, groupId: string) {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const group = await tx.packageGroup.findUnique({ where: { id: groupId }, include: { packages: true } });
      if (!group) throw AppException.notFound('GROUP_NOT_FOUND', 'Groupe introuvable');
      for (const pkg of group.packages) this.assertWarehouseScope(auth, 'package:update', pkg.originWarehouseId);
      await tx.package.updateMany({ where: { groupId }, data: { groupId: null } });
      await tx.packageEvent.createMany({
        data: group.packages.map((p) => ({ companyId: auth.companyId, packageId: p.id, eventType: 'UNGROUPED', actorUserId: auth.userId, visibility: 'PRIVATE' as const, data: { group: group.reference } })),
      });
      await tx.packageGroup.delete({ where: { id: groupId } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'package.ungrouped', entityType: 'package_group', entityId: groupId });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Lecture (personnel)
  // ---------------------------------------------------------------------------------------------

  /** Entrepôts sur lesquels l'utilisateur peut lire les colis ; undefined = tous. */
  private readableWarehouses(auth: AuthContext): string[] | undefined {
    return auth.permissions.can('package:read') ? undefined : auth.permissions.scopeIds('package:read', 'WAREHOUSE');
  }

  async list(auth: AuthContext, query: { limit: number; cursor?: string; status?: PackageStatus; q?: string; customerId?: string; warehouseId?: string; unidentified?: 'true' | 'false' }) {
    const restrict = this.readableWarehouses(auth);
    const q = query.q?.toUpperCase().replace(/[\s-]/g, '');
    const code = query.q?.toUpperCase().trim(); // code client tel que saisi (« TT-000002 »), contrairement aux numéros de suivi
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.package.findMany({
        where: {
          status: query.status,
          customerId: query.unidentified === 'true' ? null : query.customerId,
          ...(query.unidentified === 'false' ? { customerId: { not: null } } : {}),
          originWarehouseId: restrict ? { in: query.warehouseId ? restrict.filter((id) => id === query.warehouseId) : restrict } : query.warehouseId,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
          ...(q ? { OR: [{ trackingNumber: { contains: q } }, { supplierTracking: { contains: q } }, { customer: { customerCode: { contains: code } } }] } : {}),
        },
        include: staffInclude,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map(staffPackageDto), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  async get(auth: AuthContext, packageId: string) {
    const result = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId }, include: staffInclude });
      if (!pkg) return null;
      const [events, holds, prealert] = await Promise.all([
        tx.packageEvent.findMany({ where: { packageId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
        tx.packageHold.findMany({ where: { packageId }, orderBy: { openedAt: 'asc' } }),
        tx.prealert.findUnique({ where: { packageId } }),
      ]);
      return { pkg, events, holds, prealert };
    });
    // Hors portée = comme inexistant (ne révèle pas les colis des autres entrepôts)
    if (!result || !auth.permissions.can('package:read', { type: 'WAREHOUSE', id: result.pkg.originWarehouseId })) {
      throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
    }
    return {
      ...staffPackageDto(result.pkg),
      events: result.events.map((e) => ({
        id: e.id, type: e.eventType, from: e.fromStatus, to: e.toStatus, actorUserId: e.actorUserId, reason: e.reason,
        visibility: e.visibility, location: e.locationLabel, data: e.data, occurredAt: e.occurredAt,
      })),
      holds: result.holds.map((h) => ({ id: h.id, reasonCode: h.reasonCode, note: h.note, openedAt: h.openedAt, releasedAt: h.releasedAt })),
      prealert: result.prealert
        ? { id: result.prealert.id, storeName: result.prealert.storeName, orderNumber: result.prealert.orderNumber, purchaseAmount: result.prealert.purchaseAmount.toString(), purchaseCurrency: result.prealert.purchaseCurrency, status: result.prealert.status }
        : null,
    };
  }

  /** Colis attendus (préalertes ouvertes), pour retrouver rapidement le client lorsqu'un colis arrive. */
  async expected(auth: AuthContext, query: { q?: string; customerCode?: string; limit: number }) {
    const q = query.q?.toUpperCase().replace(/[\s-]/g, '');
    const code = query.q?.toUpperCase().trim();
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.package.findMany({
        where: {
          status: 'AWAITING_RECEIPT',
          ...(query.customerCode ? { customer: { customerCode: query.customerCode } } : {}),
          ...(q ? { OR: [{ supplierTracking: { contains: q } }, { trackingNumber: { contains: q } }, { customer: { customerCode: { contains: code } } }, { prealert: { storeName: { contains: query.q, mode: 'insensitive' } } }, { prealert: { orderNumber: { contains: query.q, mode: 'insensitive' } } }] } : {}),
        },
        include: { ...staffInclude, prealert: true },
        orderBy: { id: 'desc' },
        take: query.limit,
      }),
    );
    return {
      items: rows.map((pkg) => ({
        ...staffPackageDto(pkg),
        prealert: pkg.prealert ? { storeName: pkg.prealert.storeName, orderNumber: pkg.prealert.orderNumber, description: pkg.prealert.description } : null,
      })),
    };
  }
}
