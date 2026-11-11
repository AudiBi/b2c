import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import './i18n/all';
import { AppRoutes } from './App';
import { preloadAllPages } from './page-preload';
import { AppProviders, createQueryClient } from './providers';
import { HeadContext, type HeadCollector } from './seo';
import { LANGS } from './i18n';
import { noindexPublicPages, paths, publicPages, utilityPages, type PageKey } from './routes';
export { buildHeadTags, jsonLdScript, pageDescription, pageTitle, pageUrl, ROBOTS_INDEX, type SiteSeo } from './seo-head';

export interface PrerenderTarget {
  lang: (typeof LANGS)[number];
  key: PageKey;
  /** Chemin sans préfixe de langue, par exemple « /services/air » ('' pour l'accueil). */
  path: string;
  index: boolean;
  /** Pages non référencées : leurs liens sont-ils suivis ? (connexion : oui ; pages utilitaires : non) */
  follow: boolean;
}

/** Toutes les pages à produire : 17 pages publiques (dont la connexion, non référencée) et 4 pages utilitaires, dans chaque langue. */
export const prerenderTargets: PrerenderTarget[] = LANGS.flatMap((lang) => [
  ...publicPages.map((key) => ({ lang, key: key as PageKey, path: paths[key], index: !noindexPublicPages.includes(key), follow: true })),
  ...utilityPages.map((key) => ({ lang, key: key as PageKey, path: paths[key], index: false, follow: false })),
]);

/** À appeler une fois avant les rendus : charge les pages à chargement différé. */
export const prepare = preloadAllPages;

export function render(url: string): { html: string; head: HeadCollector } {
  const head: HeadCollector = {};
  const html = renderToString(
    <HeadContext.Provider value={head}>
      <AppProviders client={createQueryClient()}>
        <StaticRouter location={url}>
          <AppRoutes />
        </StaticRouter>
      </AppProviders>
    </HeadContext.Provider>,
  );
  return { html, head };
}
