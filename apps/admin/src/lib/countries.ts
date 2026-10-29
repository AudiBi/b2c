import type { Lang } from '../i18n';

/** Nom d'un pays (code ISO) dans la langue courante. */
export function countryName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
