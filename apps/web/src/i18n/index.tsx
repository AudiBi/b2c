import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Messages } from './fr';

export const LANGS = ['fr', 'ht', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'fr';

/**
 * Registre des textes déjà chargés. Chaque langue est un module séparé : le navigateur ne télécharge que celle de la page
 * (loadCatalog), le rendu serveur et les tests chargent les trois (i18n/all).
 */
export const catalogs = {} as Record<Lang, Messages>;

export function registerCatalog(lang: Lang, messages: Messages): void {
  catalogs[lang] = messages;
}

const loaders: Record<Lang, () => Promise<Messages>> = {
  fr: () => import('./fr').then((module) => module.fr),
  ht: () => import('./ht').then((module) => module.ht as Messages),
  en: () => import('./en').then((module) => module.en as Messages),
};

/** Charge (une seule fois) les textes d'une langue. */
export async function loadCatalog(lang: Lang): Promise<Messages> {
  if (!catalogs[lang]) registerCatalog(lang, await loaders[lang]());
  return catalogs[lang];
}

/** Vrai quand les textes de la langue sont disponibles ; les charge sinon (changement de langue dans le navigateur). */
export function useCatalogReady(lang: Lang): boolean {
  const [, refresh] = useState(0);
  const ready = !!catalogs[lang];
  useEffect(() => {
    if (ready) return;
    let active = true;
    void loadCatalog(lang).then(() => active && refresh((n) => n + 1));
    return () => {
      active = false;
    };
  }, [lang, ready]);
  return ready;
}

export const isLang = (value: string | undefined): value is Lang => !!value && (LANGS as readonly string[]).includes(value);

/** Remplace {nom} par la valeur correspondante. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

interface I18nValue {
  lang: Lang;
  m: Messages;
}

// Sans fournisseur (page « langue inconnue ») : le français, déjà chargé par le point d'entrée
const I18nContext = createContext<I18nValue>({
  lang: DEFAULT_LANG,
  get m() {
    return catalogs[DEFAULT_LANG];
  },
});

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => ({ lang, m: catalogs[lang] }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

const STORAGE_KEY = 'b2c.lang';

/** Langue préférée : choix mémorisé, sinon langue du navigateur, sinon français. */
export function detectLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(stored ?? undefined)) return stored as Lang;
  } catch {
    /* stockage indisponible */
  }
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const base = candidate.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}

export function rememberLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* stockage indisponible */
  }
}
