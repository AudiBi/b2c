import { PERMISSION_CODES, type PermissionCode } from './permissions';

export const SCOPE_TYPES = ['COMPANY', 'WAREHOUSE', 'AGENCY', 'ROUTE'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const ROLE_CODES = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'LOGISTICS_MANAGER',
  'WAREHOUSE_MANAGER',
  'RECEPTION_AGENT',
  'BILLING_AGENT',
  'AGENCY_MANAGER',
  'CUSTOMER_SERVICE',
  'DRIVER',
  'CUSTOMER_INDIVIDUAL',
  'CUSTOMER_BUSINESS',
  'AUDITOR',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  permissions: readonly PermissionCode[];
  /** Portées possibles d'une attribution de ce rôle (la première est la portée par défaut). */
  allowedScopes: readonly ScopeType[];
  /** PLATFORM : équipe de la plateforme ; STAFF : personnel d'une entreprise (invitation) ; CUSTOMER : inscription libre. */
  audience: 'PLATFORM' | 'STAFF' | 'CUSTOMER';
}

/** Permissions de lecture seule : celles qui se terminent par `:read` ou `:export`. */
export function isReadOnlyPermission(code: PermissionCode): boolean {
  return code.endsWith(':read') || code.endsWith(':export');
}

const TENANT_PERMISSIONS = PERMISSION_CODES.filter(
  (code) => !code.startsWith('company:') && !code.startsWith('platform:'),
);
// Les permissions « _own » concernent les comptes clients, pas le personnel.
const STAFF_ALL = TENANT_PERMISSIONS.filter((code) => !code.endsWith('_own') && !code.endsWith('_assigned'));

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super administrateur',
    description: 'Administre la plateforme et crée les entreprises. Sans accès aux données métier des entreprises.',
    audience: 'PLATFORM',
    allowedScopes: ['COMPANY'],
    permissions: [
      'company:manage', 'platform:read_health', 'user:read', 'user:create', 'user:disable',
      'role:read', 'role:assign', 'audit:read',
    ],
  },
  {
    code: 'COMPANY_ADMIN',
    name: "Administrateur de l'entreprise",
    description: 'Accès complet aux données et à la configuration de son entreprise.',
    audience: 'STAFF',
    allowedScopes: ['COMPANY'],
    permissions: STAFF_ALL,
  },
  {
    code: 'LOGISTICS_MANAGER',
    name: 'Responsable logistique',
    description: 'Pilote les lots de transport, les manifestes et le suivi des colis.',
    audience: 'STAFF',
    allowedScopes: ['COMPANY'],
    permissions: [
      'customer:read', 'package:read', 'package:hold', 'package:release_hold', 'package:return', 'package:authorize_shipment',
      'shipment:read', 'shipment:manage', 'shipment:dispatch', 'shipment:receive',
      'warehouse:read', 'agency:read', 'rate:read', 'quote:create',
      'delivery:read', 'delivery:assign', 'report:read', 'prealert:read',
    ],
  },
  {
    code: 'WAREHOUSE_MANAGER',
    name: "Responsable d'entrepôt",
    description: "Supervise la réception, le stockage et les sorties d'un entrepôt.",
    audience: 'STAFF',
    allowedScopes: ['WAREHOUSE'],
    permissions: [
      'customer:read', 'prealert:read', 'prealert:match',
      'package:read', 'package:update', 'package:receive', 'package:inspect', 'package:register',
      'package:hold', 'package:release_hold',
      'warehouse:read', 'warehouse:manage', 'warehouse:move',
      'shipment:read', 'shipment:manage', 'report:read',
    ],
  },
  {
    code: 'RECEPTION_AGENT',
    name: 'Agent de réception',
    description: 'Réceptionne, pèse et enregistre les colis en entrepôt.',
    audience: 'STAFF',
    allowedScopes: ['WAREHOUSE'],
    permissions: [
      'customer:read', 'prealert:read', 'prealert:match',
      'package:read', 'package:receive', 'package:inspect', 'package:register', 'package:hold',
      'warehouse:read', 'warehouse:move',
    ],
  },
  {
    code: 'BILLING_AGENT',
    name: 'Agent de facturation',
    description: 'Établit les factures et enregistre les paiements.',
    audience: 'STAFF',
    allowedScopes: ['COMPANY'],
    permissions: [
      'customer:read', 'package:read', 'package:authorize_shipment', 'rate:read', 'quote:create',
      'invoice:read', 'invoice:create', 'invoice:void', 'discount:apply',
      'payment:read', 'payment:record_cash', 'payment:refund', 'payment:reconcile', 'payment:export',
    ],
  },
  {
    code: 'AGENCY_MANAGER',
    name: "Responsable d'agence",
    description: "Gère la réception, le retrait et les livraisons d'une agence.",
    audience: 'STAFF',
    allowedScopes: ['AGENCY'],
    permissions: [
      'customer:read', 'package:read', 'package:hold',
      'agency:read', 'agency:receive',
      'delivery:read', 'delivery:assign', 'delivery:confirm', 'delivery:override_balance',
      'invoice:read', 'payment:read', 'payment:record_cash', 'report:read',
    ],
  },
  {
    code: 'CUSTOMER_SERVICE',
    name: 'Agent de service client',
    description: "Répond aux clients et traite les réclamations. Ne manipule pas d'argent.",
    audience: 'STAFF',
    allowedScopes: ['COMPANY'],
    permissions: [
      'customer:read', 'customer:update', 'prealert:read', 'package:read',
      'invoice:read', 'payment:read', 'notification:read',
      'claim:read', 'claim:manage', 'quote:create',
    ],
  },
  {
    code: 'DRIVER',
    name: 'Livreur',
    description: 'Voit et confirme uniquement les livraisons qui lui sont assignées.',
    audience: 'STAFF',
    allowedScopes: ['COMPANY', 'ROUTE'],
    permissions: ['delivery:read_assigned', 'delivery:confirm'],
  },
  {
    code: 'CUSTOMER_INDIVIDUAL',
    name: 'Client individuel',
    description: 'Accède uniquement à ses propres colis, factures et paiements.',
    audience: 'CUSTOMER',
    allowedScopes: ['COMPANY'],
    permissions: [
      'profile:read_own', 'profile:update_own', 'prealert:create_own', 'prealert:read_own',
      'package:read_own', 'invoice:read_own', 'payment:read_own',
      'claim:create_own', 'claim:read_own', 'quote:create',
    ],
  },
  {
    code: 'CUSTOMER_BUSINESS',
    name: 'Client professionnel',
    description: 'Comme un client individuel, avec gestion de sous-utilisateurs.',
    audience: 'CUSTOMER',
    allowedScopes: ['COMPANY'],
    permissions: [
      'profile:read_own', 'profile:update_own', 'team:manage_own',
      'prealert:create_own', 'prealert:read_own', 'package:read_own',
      'invoice:read_own', 'payment:read_own',
      'claim:create_own', 'claim:read_own', 'quote:create',
    ],
  },
  {
    code: 'AUDITOR',
    name: 'Auditeur en lecture seule',
    description: "Lit toutes les données de l'entreprise, y compris le journal d'audit. Aucune écriture.",
    audience: 'STAFF',
    allowedScopes: ['COMPANY'],
    permissions: STAFF_ALL.filter(isReadOnlyPermission),
  },
];

export const ROLE_BY_CODE: ReadonlyMap<RoleCode, RoleDefinition> = new Map(
  ROLE_DEFINITIONS.map((role) => [role.code, role]),
);

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}
