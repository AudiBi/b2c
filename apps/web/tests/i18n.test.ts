import { describe, expect, it } from 'vitest';
import { LANGS, catalogs, format } from '../src/i18n';
import { publicPages, utilityPages } from '../src/routes';

/** Liste tous les chemins de clés d'un catalogue, avec la valeur feuille. */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => leaves(item, path ? `${path}.${key}` : key));
  return [[path, value]];
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('catalogues de traduction', () => {
  const reference = leaves(catalogs.fr);

  it.each(LANGS.filter((l) => l !== 'fr'))('%s : mêmes clés, mêmes tailles de listes et mêmes variables que le français', (lang) => {
    const other = leaves(catalogs[lang]);
    expect(other.map(([path]) => path)).toEqual(reference.map(([path]) => path));
    const otherByPath = new Map(other);
    for (const [path, text] of reference) {
      expect({ path, vars: placeholders(String(otherByPath.get(path))) }).toEqual({ path, vars: placeholders(String(text)) });
    }
  });

  it.each(LANGS)('%s : aucune valeur vide ni « undefined »', (lang) => {
    for (const [path, value] of leaves(catalogs[lang])) {
      expect(typeof value, path).toBe('string');
      expect(String(value).trim(), path).not.toBe('');
      expect(String(value), path).not.toMatch(/undefined|\[object/);
    }
  });

  it('les noms de langue sont identiques dans tous les catalogues (autonymes)', () => {
    for (const lang of LANGS) expect(catalogs[lang].lang).toEqual({ fr: 'Français', ht: 'Kreyòl ayisyen', en: 'English' });
  });

  it('aucun texte ne reprend la marque de la référence étudiée', () => {
    for (const lang of LANGS) {
      for (const [path, value] of leaves(catalogs[lang])) expect(String(value).toLowerCase(), path).not.toContain('shippex');
    }
  });

  it('le contenu n’invente ni prix, ni montant en devise, ni numéro de téléphone', () => {
    for (const lang of LANGS) {
      for (const [path, value] of leaves(catalogs[lang])) {
        const text = String(value);
        if (path === 'auth.fields.phoneHint' || path === 'validation.phone') continue; // exemples de format de saisie
        expect(text, path).not.toMatch(/[$€]\s?\d|\d\s?(USD|HTG|gourdes)/i);
        expect(text, path).not.toMatch(/\+\d{3}[\s\d]{6,}/);
      }
    }
  });

  it('la FAQ couvre les sujets du cahier des charges (≥ 10 questions) dans chaque langue', () => {
    for (const lang of LANGS) expect(catalogs[lang].faq.items.length).toBeGreaterThanOrEqual(10);
  });

  it('les textes légaux sont signalés comme projets à valider', () => {
    for (const lang of LANGS) {
      expect(catalogs[lang].legal.draftBanner.length).toBeGreaterThan(30);
      expect(catalogs[lang].legal.terms.sections.length).toBe(catalogs.fr.legal.terms.sections.length);
      expect(catalogs[lang].legal.privacy.sections.length).toBe(catalogs.fr.legal.privacy.sections.length);
    }
  });
});

describe('métadonnées de référencement', () => {
  const keys = [...publicPages, ...utilityPages].map((key) => (key === 'forgotPassword' || key === 'resetPassword' || key === 'verifyEmail' || key === 'acceptInvite' ? key : key));

  it.each(LANGS)('%s : un titre et une description de longueur raisonnable pour chaque page', (lang) => {
    for (const key of keys) {
      const entry = catalogs[lang].seo[key as keyof (typeof catalogs)['fr']['seo']];
      expect(entry, key).toBeDefined();
      expect(entry.title.length, key).toBeGreaterThan(3);
      expect(entry.title.length, key).toBeLessThanOrEqual(60);
      expect(entry.description.length, key).toBeGreaterThanOrEqual(20);
      expect(entry.description.length, key).toBeLessThanOrEqual(170);
    }
  });

  it.each(LANGS)('%s : les titres des pages publiques sont tous différents', (lang) => {
    const titles = publicPages.map((key) => catalogs[lang].seo[key as keyof (typeof catalogs)['fr']['seo']].title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('format()', () => {
  it('remplace les variables connues et laisse les autres', () => {
    expect(format('Bonjour {name}, {n} colis, {absent}', { name: 'Marie', n: 3 })).toBe('Bonjour Marie, 3 colis, {absent}');
  });
});
