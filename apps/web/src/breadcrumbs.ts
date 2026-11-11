import type { Messages } from './i18n/fr';
import { parentPage, type PageKey } from './routes';

export interface Crumb {
  key: PageKey;
  label: string;
}

/** Libellé court d'une page (même source pour le fil d'Ariane visible et pour les données structurées). */
export function pageLabel(key: PageKey, m: Messages): string {
  if (key === 'terms') return m.footer.terms;
  if (key === 'privacy') return m.footer.privacy;
  const nav = m.nav as Record<string, string>;
  return nav[key] ?? m.seo[key as keyof Messages['seo']]?.title ?? key;
}

/** Chemin de la page dans le site : Accueil › (Parent ›) Page. Vide pour l'accueil. */
export function breadcrumbTrail(key: PageKey, m: Messages): Crumb[] {
  if (key === 'home') return [];
  const trail: PageKey[] = [key];
  for (let parent = parentPage[key]; parent; parent = parentPage[parent]) trail.unshift(parent);
  return ['home' as PageKey, ...trail].map((k) => ({ key: k, label: pageLabel(k, m) }));
}
