import type { Lang } from './i18n';

/** Chemins des pages (identiques dans toutes les langues), sans le préfixe de langue. */
export const paths = {
  home: '',
  about: '/about',
  services: '/services',
  air: '/services/air',
  sea: '/services/sea',
  international: '/services/international',
  local: '/services/local-delivery',
  calculator: '/calculator',
  tracking: '/tracking',
  locations: '/locations',
  howItWorks: '/how-it-works',
  faq: '/faq',
  contact: '/contact',
  register: '/register',
  login: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  acceptInvite: '/accept-invite',
  terms: '/terms',
  privacy: '/privacy',
  account: '/account',
  accountProfile: '/account/profile',
  accountAddresses: '/account/addresses',
  accountBeneficiaries: '/account/beneficiaries',
  accountReceiving: '/account/receiving-addresses',
  accountPrealerts: '/account/prealerts',
  accountPackages: '/account/packages',
  accountSecurity: '/account/security',
} as const;

export type PageKey = keyof typeof paths;

/** Les 17 pages publiques du cahier des charges, pré-rendues et référencées. */
export const publicPages = [
  'home', 'about', 'services', 'air', 'sea', 'international', 'local', 'calculator', 'tracking',
  'locations', 'howItWorks', 'faq', 'contact', 'register', 'login', 'terms', 'privacy',
] as const satisfies readonly PageKey[];

/** Pages utilitaires de l'authentification : pré-rendues (coquille) mais non référencées (noindex). */
export const utilityPages = ['forgotPassword', 'resetPassword', 'verifyEmail', 'acceptInvite'] as const satisfies readonly PageKey[];

export const localized = (lang: Lang, key: PageKey): string => `/${lang}${paths[key]}`;
export const localizedPath = (lang: Lang, path: string): string => `/${lang}${path === '/' ? '' : path}`;

export type SeoKey = Exclude<PageKey, `account${string}`> | 'account' | 'notFound';
