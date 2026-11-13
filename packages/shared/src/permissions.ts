/**
 * Catalogue unique des permissions. Format `ressource:action`.
 * Les suffixes `_own` / `_assigned` désignent l'accès limité à ses propres objets.
 * Toute permission utilisée par l'API doit figurer ici ; la base est synchronisée par `npm run db:seed`.
 */
export const PERMISSIONS = {
  // Plateforme (hors données métier des entreprises)
  'company:manage': 'Créer, suspendre et lister les entreprises',
  'platform:read_health': 'Consulter la santé de la plateforme',
  // Identité
  'user:read': "Lire les utilisateurs de l'entreprise",
  'user:create': 'Inviter un utilisateur du personnel',
  'user:update': 'Modifier un utilisateur',
  'user:disable': 'Désactiver ou réactiver un utilisateur',
  'role:read': 'Lire les rôles et leurs permissions',
  'role:assign': 'Attribuer et retirer des rôles',
  'role:manage': 'Créer, modifier et supprimer les rôles personnalisés',
  'audit:read': "Consulter le journal d'audit",
  'settings:read': "Lire les paramètres de l'entreprise",
  'settings:update': "Modifier les paramètres de l'entreprise",
  // Compte personnel
  'profile:read_own': 'Lire son propre profil',
  'profile:update_own': 'Modifier son propre profil',
  'team:manage_own': 'Gérer les sous-utilisateurs de son compte professionnel',
  // Clients
  'customer:read': 'Lire les clients',
  'customer:create': 'Créer un client',
  'customer:update': 'Modifier un client',
  // Préalertes et colis
  'prealert:read': 'Lire toutes les préalertes',
  'prealert:read_own': 'Lire ses préalertes',
  'prealert:create_own': 'Déclarer un achat',
  'prealert:match': 'Rapprocher une préalerte et un colis',
  'package:read': 'Lire tous les colis',
  'package:read_own': 'Lire ses colis',
  'package:update': 'Modifier un colis',
  'package:receive': 'Réceptionner un colis',
  'package:inspect': 'Vérifier un colis',
  'package:register': 'Enregistrer et peser un colis',
  'package:hold': 'Retenir un colis (anomalie)',
  'package:release_hold': "Lever la retenue d'un colis",
  'package:return': 'Retourner un colis',
  'package:cancel': 'Annuler un colis',
  'package:authorize_shipment': "Autoriser l'expédition d'un colis (en attente de paiement ou prêt à expédier)",
  // Entrepôts, expéditions, agences
  'warehouse:read': 'Lire les entrepôts',
  'warehouse:manage': 'Gérer les entrepôts',
  'warehouse:move': 'Déplacer des colis en entrepôt',
  'shipment:read': 'Lire les lots de transport',
  'shipment:manage': 'Créer et préparer les lots',
  'shipment:dispatch': "Déclarer le départ d'un lot",
  'shipment:receive': "Déclarer l'arrivée d'un lot",
  'agency:read': 'Lire les agences',
  'agency:manage': 'Gérer les agences',
  'agency:receive': 'Réceptionner des colis en agence',
  // Tarification
  'rate:read': 'Lire les grilles tarifaires',
  'rate:manage': 'Gérer les grilles tarifaires',
  'quote:create': 'Calculer un devis ou une estimation',
  // Livraison
  'delivery:read': 'Lire toutes les livraisons',
  'delivery:read_assigned': 'Lire les livraisons qui me sont assignées',
  'delivery:assign': 'Affecter des livraisons et des tournées',
  'delivery:confirm': 'Confirmer une remise',
  'delivery:override_balance': 'Autoriser une remise malgré un solde dû',
  // Finance
  'invoice:read': 'Lire toutes les factures',
  'invoice:read_own': 'Lire ses factures',
  'invoice:create': 'Créer une facture',
  'invoice:void': 'Annuler une facture',
  'discount:apply': 'Appliquer une remise',
  'price:override': 'Fixer à la main le prix d’un colis (motif obligatoire, tracé)',
  'payment:read': 'Lire tous les paiements',
  'payment:read_own': 'Lire ses paiements',
  'payment:declare_own': 'Déclarer un paiement par virement ou mobile',
  'payment:record_cash': 'Enregistrer un paiement en espèces',
  'payment:refund': 'Rembourser un paiement',
  'payment:reconcile': 'Rapprocher les paiements',
  'payment:export': 'Exporter les données comptables',
  // Notifications, réclamations, rapports
  'notification:read': 'Lire les notifications envoyées',
  'notification:read_own': 'Lire ses notifications',
  'notification:template_manage': 'Gérer les modèles de notification',
  'claim:read': 'Lire toutes les réclamations',
  'claim:read_own': 'Lire ses réclamations',
  'claim:create_own': 'Ouvrir une réclamation',
  'claim:manage': 'Traiter les réclamations',
  'report:read': 'Consulter les tableaux de bord',
  'report:export': 'Exporter des rapports',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
