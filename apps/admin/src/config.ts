/** Configuration du panel, fixée à la construction (variables VITE_* du .env de la racine). */
export const config = {
  /** Nom de marque affiché (VITE_BRAND_NAME). */
  brandName: import.meta.env.VITE_BRAND_NAME ?? 'B2C',
  /** Entreprise gérée par ce panel (identifiant public). Une construction du panel = une entreprise. */
  companySlug: import.meta.env.VITE_COMPANY_SLUG ?? 'demo',
  /** Adresse du site public (lien « Voir le site »). Vide : lien masqué. */
  siteUrl: import.meta.env.VITE_SITE_URL ?? '',
  /** Vide = même origine (proxy en développement, reverse proxy en production). */
  apiBase: import.meta.env.VITE_API_URL ?? '',
} as const;
