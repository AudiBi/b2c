import type { Lang } from '../i18n';

/** Le créole n'a pas toujours de données de locale dans le navigateur : on formate alors comme le français. */
const locale = (lang: Lang) => (lang === 'ht' ? 'fr' : lang);

export function formatMoney(amount: string | number, currency: string, lang: Lang): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale(lang), { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatNumber(value: string | number, lang: Lang, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits }).format(Number(value));
}

const WEIGHT_LABEL = { KG: 'kg', LB: 'lb' } as const;
export function formatWeight(value: string | number | null | undefined, unit: 'KG' | 'LB', lang: Lang): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, lang)} ${WEIGHT_LABEL[unit]}`;
}

export function formatDateTime(iso: string | Date, lang: Lang): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Nombre saisi par un humain : accepte la virgule décimale ; null si ce n'est pas un nombre fini. */
export function parseDecimal(input: string): number | null {
  const text = input.trim().replace(/\s/g, '').replace(',', '.');
  if (text === '' || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
