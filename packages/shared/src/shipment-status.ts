import type { PermissionCode } from './permissions';
import type { PackageStatus } from './package-status';

/**
 * Statuts d'un lot de transport.
 *   OPEN → DISPATCHED → ARRIVED → (IN_CUSTOMS) → CLOSED ; OPEN → CANCELLED.
 * Les dates de départ et d'arrivée sont celles où le personnel a RÉELLEMENT saisi l'événement : aucune date
 * prévue ni position n'est jamais affichée sans source (exigence SHP-05).
 */
export const SHIPMENT_STATUSES = ['OPEN', 'DISPATCHED', 'ARRIVED', 'IN_CUSTOMS', 'CLOSED', 'CANCELLED'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_TERMINAL: readonly ShipmentStatus[] = ['CLOSED', 'CANCELLED'];

export interface ShipmentTransition {
  from: ShipmentStatus;
  to: ShipmentStatus;
  permission: PermissionCode;
  /** Statut des colis avant l'événement, et après. Absent : l'événement ne change pas le statut des colis. */
  packages?: { from: PackageStatus; to: PackageStatus };
}

export const SHIPMENT_TRANSITIONS: readonly ShipmentTransition[] = [
  { from: 'OPEN', to: 'DISPATCHED', permission: 'shipment:dispatch', packages: { from: 'READY_TO_SHIP', to: 'IN_TRANSIT' } },
  { from: 'OPEN', to: 'CANCELLED', permission: 'shipment:manage' },
  { from: 'DISPATCHED', to: 'ARRIVED', permission: 'shipment:receive', packages: { from: 'IN_TRANSIT', to: 'ARRIVED_DESTINATION' } },
  { from: 'ARRIVED', to: 'IN_CUSTOMS', permission: 'shipment:receive', packages: { from: 'ARRIVED_DESTINATION', to: 'IN_CUSTOMS' } },
  { from: 'ARRIVED', to: 'CLOSED', permission: 'shipment:manage' },
  { from: 'IN_CUSTOMS', to: 'CLOSED', permission: 'shipment:manage' },
];

export const findShipmentTransition = (from: ShipmentStatus, to: ShipmentStatus): ShipmentTransition | undefined =>
  SHIPMENT_TRANSITIONS.find((t) => t.from === from && t.to === to);

/** Statuts de colis qui peuvent être chargés dans un lot (I12 : poids, dimensions et client connus). */
export const LOADABLE_PACKAGE_STATUS: PackageStatus = 'READY_TO_SHIP';

/** Statuts de colis considérés comme présents dans un entrepôt (inventaire). */
export const IN_WAREHOUSE_STATUSES: readonly PackageStatus[] = [
  'RECEIVED_AT_WAREHOUSE',
  'UNDER_INSPECTION',
  'REGISTERED_WEIGHED',
  'AWAITING_PAYMENT',
  'READY_TO_SHIP',
  'ON_HOLD',
];

/** Statuts de colis présents dans une agence. */
export const IN_AGENCY_STATUSES: readonly PackageStatus[] = ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];
