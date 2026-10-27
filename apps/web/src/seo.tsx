import { createContext, useContext, useEffect } from 'react';
import { config } from './config';
import { useI18n } from './i18n';
import type { SeoKey } from './routes';

/** Collecte du titre et de la description pendant le rendu serveur (injectés ensuite dans <head>). */
export interface HeadCollector {
  title?: string;
  description?: string;
}

export const HeadContext = createContext<HeadCollector | null>(null);

/** Titre et description de la page : écrits dans <head> au pré-rendu, appliqués au document côté navigateur. */
export function usePageMeta(key: SeoKey): void {
  const { m } = useI18n();
  const collector = useContext(HeadContext);
  const entry = m.seo[key];
  const title = key === 'home' ? `${config.brandName} | ${entry.title}` : `${entry.title} | ${config.brandName}`;

  if (collector) {
    collector.title = title;
    collector.description = entry.description;
  }

  useEffect(() => {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', entry.description);
  }, [title, entry.description]);
}
