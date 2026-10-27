/** Configuration du site, fixée à la construction (variables VITE_* du .env de la racine). */
export const config = {
  /** Nom de marque PROVISOIRE : à remplacer par la marque de l'entreprise (VITE_BRAND_NAME). */
  brandName: import.meta.env.VITE_BRAND_NAME ?? 'TransitHaïti',
  /** Entreprise servie par ce site (identifiant public). Une construction du site = une entreprise. */
  companySlug: import.meta.env.VITE_COMPANY_SLUG ?? 'demo',
  /** Vide = même origine (proxy en développement, reverse proxy en production). */
  apiBase: import.meta.env.VITE_API_URL ?? '',
} as const;
