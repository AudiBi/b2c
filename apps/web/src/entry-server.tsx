import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { AppRoutes } from './App';
import { AppProviders, createQueryClient } from './providers';
import { HeadContext, type HeadCollector } from './seo';
import { LANGS } from './i18n';
import { paths, publicPages, utilityPages } from './routes';

export interface PrerenderTarget {
  lang: (typeof LANGS)[number];
  /** Chemin sans préfixe de langue, par exemple « /services/air » ('' pour l'accueil). */
  path: string;
  index: boolean;
}

/** Toutes les pages à produire : 17 pages publiques et 4 pages utilitaires, dans chaque langue. */
export const prerenderTargets: PrerenderTarget[] = LANGS.flatMap((lang) => [
  ...publicPages.map((key) => ({ lang, path: paths[key], index: true })),
  ...utilityPages.map((key) => ({ lang, path: paths[key], index: false })),
]);

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
