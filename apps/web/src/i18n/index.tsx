import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en } from './en';
import { fr, type Messages } from './fr';
import { ht } from './ht';

export const LANGS = ['fr', 'ht', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'fr';

export const catalogs: Record<Lang, Messages> = { fr, ht, en };

export const isLang = (value: string | undefined): value is Lang => !!value && (LANGS as readonly string[]).includes(value);

/** Remplace {nom} par la valeur correspondante. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

interface I18nValue {
  lang: Lang;
  m: Messages;
}

const I18nContext = createContext<I18nValue>({ lang: DEFAULT_LANG, m: fr });

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
