import { describe, expect, it } from 'vitest';
import { PACKAGE_STATUSES } from '@b2c/shared';
import { LANGS, catalogs } from '../src/i18n';
import { formatMoney, formatNumber, formatWeight, parseDecimal } from '../src/lib/format';

describe('saisie et affichage des nombres', () => {
  it('parseDecimal accepte la virgule et refuse tout ce qui n’est pas un nombre', () => {
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal(' 2.50 ')).toBe(2.5);
    expect(parseDecimal('1 250,75')).toBe(1250.75);
    expect(parseDecimal('0')).toBe(0);
    for (const bad of ['', '  ', 'abc', '1,2,3', '1e5', '--1', '2kg', 'Infinity', '٣']) expect(parseDecimal(bad)).toBeNull();
  });

  it('formate les montants selon la langue et la devise', () => {
    expect(formatMoney('11.5', 'USD', 'fr')).toMatch(/11,50/);
    expect(formatMoney('11.5', 'USD', 'en')).toBe('$11.50');
    // le créole se formate comme le français (pas de données de locale fiables)
    expect(formatMoney('11.5', 'USD', 'ht')).toBe(formatMoney('11.5', 'USD', 'fr'));
    expect(formatMoney('1250', 'HTG', 'fr')).toMatch(/1\s?250,00/);
  });

  it('une devise inconnue ne fait pas planter l’affichage', () => {
    expect(formatMoney('3', 'ZZ', 'fr')).toContain('3.00');
  });

  it('formate les poids avec leur unité', () => {
    expect(formatWeight('2.5', 'KG', 'fr')).toBe('2,5 kg');
    expect(formatWeight('4.536', 'LB', 'en')).toBe('4.536 lb');
    expect(formatWeight(null, 'KG', 'fr')).toBe('—');
    expect(formatNumber('1.23456', 'en')).toBe('1.235');
  });
});

describe('libellés des statuts de colis', () => {
  it.each(LANGS)('%s : les 17 statuts partagés ont tous un libellé', (lang) => {
    const labels = catalogs[lang].packageStatus as Record<string, string>;
    expect(Object.keys(labels).sort()).toEqual([...PACKAGE_STATUSES].sort());
    for (const status of PACKAGE_STATUSES) expect(labels[status].trim(), status).not.toBe('');
  });

  it.each(LANGS)('%s : les codes d’erreur visibles du client ont un message', (lang) => {
    const errors = catalogs[lang].auth.errors;
    for (const code of [
      'TARIFF_UNAVAILABLE', 'CATEGORY_RESTRICTED', 'CATEGORY_UNKNOWN', 'MISSING_DECLARED_VALUE', 'UNKNOWN_SURCHARGE',
      'DUPLICATE_PREALERT', 'PREALERT_LOCKED', 'PREALERT_NOT_FOUND', 'PACKAGE_NOT_FOUND', 'WAREHOUSE_NOT_FOUND',
      'TRACKING_NOT_FOUND', 'FILE_CONTENT_MISMATCH', 'FILE_REJECTED', 'FILE_KIND_NOT_ALLOWED', 'FILE_LIMIT',
      'UNSUPPORTED_FILE', 'PAYLOAD_TOO_LARGE', 'RATE_LIMITED',
    ]) {
      expect(errors[code], code).toBeTruthy();
    }
  });
});
