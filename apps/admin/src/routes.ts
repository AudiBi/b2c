/**
 * Chemins du panel d'administration. Pas de préfixe de langue : la langue est un choix de l'utilisateur (mémorisé),
 * pas une partie de l'adresse. Les clés gardent le nom qu'elles avaient dans le site pour que les écrans portés restent identiques.
 */
export const paths = {
  home: '/',
  login: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  acceptInvite: '/accept-invite',
  accountSecurity: '/security',
  accountStaffReception: '/reception',
  accountStaffPackages: '/packages',
  accountStaffWarehouse: '/warehouse',
  accountStaffShipments: '/shipments',
  accountStaffAgency: '/agency',
  accountStaffRoutes: '/routes',
  accountStaffMyRoutes: '/my-routes',
  accountStaffClaims: '/claims',
  accountStaffBilling: '/billing',
  accountStaffPayments: '/payments',
  accountStaffNotifications: '/notifications',
  accountStaffDashboard: '/dashboard',
  accountStaffAudit: '/audit',
  users: '/users',
  roles: '/roles',
  companies: '/companies',
} as const;

export type PageKey = keyof typeof paths;

/** Les chemins ne dépendent pas de la langue ; le paramètre reste pour la compatibilité des écrans portés. */
export const localized = (_lang: string, key: PageKey): string => paths[key];
export const localizedPath = (_lang: string, path: string): string => path;
