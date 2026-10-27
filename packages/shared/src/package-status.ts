import type { PermissionCode } from './permissions';

/** Les 17 statuts d'un colis (voir docs/DOMAIN_MODEL.md §4). */
export const PACKAGE_STATUSES = [
  'PREALERT_CREATED',
  'AWAITING_RECEIPT',
  'RECEIVED_AT_WAREHOUSE',
  'UNDER_INSPECTION',
  'REGISTERED_WEIGHED',
  'AWAITING_PAYMENT',
  'READY_TO_SHIP',
  'IN_TRANSIT',
  'ARRIVED_DESTINATION',
  'IN_CUSTOMS',
  'RECEIVED_AT_AGENCY',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'ON_HOLD',
  'RETURNED',
  'CANCELLED',
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const TERMINAL_STATUSES: readonly PackageStatus[] = ['DELIVERED', 'RETURNED', 'CANCELLED'];
export const isTerminal = (status: PackageStatus) => TERMINAL_STATUSES.includes(status);

/**
 * Module propriétaire d'une transition. L'API générique de changement de statut n'accepte que PACKAGES et
 * BILLING (autorisation manuelle en attendant la facturation) ; les autres seront déclenchées par les
 * modules lots (phase 6), livraison (6/8) et paiements (7) via la même fonction serveur.
 */
export type TransitionOwner = 'SYSTEM' | 'PACKAGES' | 'BILLING' | 'SHIPMENTS' | 'DELIVERY';

export interface TransitionRule {
  from: PackageStatus;
  to: PackageStatus;
  permission: PermissionCode | null;
  owner: TransitionOwner;
  reasonRequired: boolean;
}

const rule = (
  from: PackageStatus,
  to: PackageStatus,
  permission: PermissionCode | null,
  owner: TransitionOwner,
  reasonRequired = false,
): TransitionRule => ({ from, to, permission, owner, reasonRequired });

const HOLDABLE: PackageStatus[] = PACKAGE_STATUSES.filter(
  (status) => !isTerminal(status) && status !== 'PREALERT_CREATED' && status !== 'ON_HOLD',
);

/**
 * Table des transitions autorisées : TOUTE autre paire est refusée.
 * La reprise depuis ON_HOLD (retour au statut précédent) est gérée par `isTransitionAllowed`.
 */
export const TRANSITION_RULES: readonly TransitionRule[] = [
  rule('PREALERT_CREATED', 'AWAITING_RECEIPT', null, 'SYSTEM'),
  rule('PREALERT_CREATED', 'CANCELLED', 'package:cancel', 'PACKAGES', true),
  rule('AWAITING_RECEIPT', 'CANCELLED', 'package:cancel', 'PACKAGES', true),
  rule('AWAITING_RECEIPT', 'RECEIVED_AT_WAREHOUSE', 'package:receive', 'PACKAGES'),
  // Réception saisie par erreur, doublon ou colis fusionné dans le colis attendu d'un client
  rule('RECEIVED_AT_WAREHOUSE', 'CANCELLED', 'package:cancel', 'PACKAGES', true),
  rule('UNDER_INSPECTION', 'CANCELLED', 'package:cancel', 'PACKAGES', true),
  rule('RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION', 'package:inspect', 'PACKAGES'),
  rule('RECEIVED_AT_WAREHOUSE', 'REGISTERED_WEIGHED', 'package:register', 'PACKAGES'),
  rule('UNDER_INSPECTION', 'REGISTERED_WEIGHED', 'package:register', 'PACKAGES'),
  rule('REGISTERED_WEIGHED', 'AWAITING_PAYMENT', 'package:authorize_shipment', 'BILLING'),
  rule('REGISTERED_WEIGHED', 'READY_TO_SHIP', 'package:authorize_shipment', 'BILLING', true),
  rule('AWAITING_PAYMENT', 'READY_TO_SHIP', 'package:authorize_shipment', 'BILLING', true),
  rule('READY_TO_SHIP', 'IN_TRANSIT', 'shipment:dispatch', 'SHIPMENTS'),
  rule('IN_TRANSIT', 'ARRIVED_DESTINATION', 'shipment:receive', 'SHIPMENTS'),
  rule('ARRIVED_DESTINATION', 'IN_CUSTOMS', 'shipment:receive', 'SHIPMENTS'),
  rule('ARRIVED_DESTINATION', 'RECEIVED_AT_AGENCY', 'agency:receive', 'DELIVERY'),
  rule('IN_CUSTOMS', 'RECEIVED_AT_AGENCY', 'agency:receive', 'DELIVERY'),
  rule('RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'agency:receive', 'DELIVERY'),
  rule('RECEIVED_AT_AGENCY', 'OUT_FOR_DELIVERY', 'delivery:assign', 'DELIVERY'),
  rule('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'delivery:assign', 'DELIVERY'),
  rule('READY_FOR_PICKUP', 'DELIVERED', 'delivery:confirm', 'DELIVERY'),
  rule('OUT_FOR_DELIVERY', 'DELIVERED', 'delivery:confirm', 'DELIVERY'),
  rule('OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'delivery:confirm', 'DELIVERY', true),
  rule('UNDER_INSPECTION', 'RETURNED', 'package:return', 'PACKAGES', true),
  rule('IN_CUSTOMS', 'RETURNED', 'package:return', 'PACKAGES', true),
  rule('READY_FOR_PICKUP', 'RETURNED', 'package:return', 'PACKAGES', true),
  ...HOLDABLE.map((from) => rule(from, 'ON_HOLD', 'package:hold', 'PACKAGES', true)),
  rule('ON_HOLD', 'RETURNED', 'package:return', 'PACKAGES', true),
  rule('ON_HOLD', 'CANCELLED', 'package:cancel', 'PACKAGES', true),
];

const BY_PAIR = new Map(TRANSITION_RULES.map((r) => [`${r.from}>${r.to}`, r]));

/** Règle applicable, ou undefined si la paire est interdite. `previousStatus` autorise la reprise depuis ON_HOLD. */
export function findTransition(from: PackageStatus, to: PackageStatus, previousStatus?: PackageStatus | null): TransitionRule | undefined {
  const direct = BY_PAIR.get(`${from}>${to}`);
  if (direct) return direct;
  if (from === 'ON_HOLD' && previousStatus && to === previousStatus && HOLDABLE.includes(to)) {
    return rule('ON_HOLD', to, 'package:release_hold', 'PACKAGES');
  }
  return undefined;
}

export const isTransitionAllowed = (from: PackageStatus, to: PackageStatus, previousStatus?: PackageStatus | null) =>
  findTransition(from, to, previousStatus) !== undefined;

export const HOLD_REASON_CODES = ['DAMAGED', 'UNIDENTIFIED', 'SUSPICIOUS_CONTENT', 'PROHIBITED_ITEM', 'CUSTOMS', 'OTHER'] as const;
export type HoldReasonCode = (typeof HOLD_REASON_CODES)[number];

/** Statuts avant réception physique : le colis n'est pas encore en entrepôt. */
export const PRE_RECEIPT_STATUSES: readonly PackageStatus[] = ['PREALERT_CREATED', 'AWAITING_RECEIPT'];
