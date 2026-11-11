/** Configuration du site, fixée à la construction (variables VITE_* du .env de la racine). */
export const config = {
  /** Nom de marque complet (VITE_BRAND_NAME) : pied de page, aperçu des réseaux sociaux, données structurées. */
  brandName: import.meta.env.VITE_BRAND_NAME ?? 'B2C Shipping Express',
  /** Nom court (VITE_BRAND_SHORT_NAME), pour les titres de page : ils restent sous la limite d'affichage des moteurs de recherche. */
  brandShortName: import.meta.env.VITE_BRAND_SHORT_NAME ?? 'B2C',
  /** Entreprise servie par ce site (identifiant public). Une construction du site = une entreprise. */
  companySlug: import.meta.env.VITE_COMPANY_SLUG ?? 'demo',
  /** Adresse du panel d'administration (personnel). Vide : aucun lien proposé. */
  adminUrl: import.meta.env.VITE_ADMIN_URL ?? '',
  /** Vide = même origine (proxy en développement, reverse proxy en production). */
  apiBase: import.meta.env.VITE_API_URL ?? '',
} as const;
