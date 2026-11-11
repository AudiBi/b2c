import { describe, expect, it } from 'vitest';
import { prerenderTargets, render } from '../src/entry-server';
import { breadcrumbTrail } from '../src/breadcrumbs';
import { LANGS, catalogs } from '../src/i18n';
import { buildHeadTags, buildJsonLd, pageDescription, pageTitle, ROBOTS_INDEX, type SiteSeo } from '../src/seo-head';

const site: SiteSeo = { siteUrl: 'https://exemple.test', brandName: 'B2C' };
const indexed = prerenderTargets.filter((t) => t.index);
const jsonLdOf = (tags: string[]) => {
  const script = tags.find((tag) => tag.startsWith('<script type="application/ld+json">'));
  return script ? (JSON.parse(script.slice(script.indexOf('>') + 1, -'</script>'.length)) as { '@graph': Record<string, any>[] }) : undefined;
};

describe('métadonnées : titres et descriptions', () => {
  it.each(LANGS)('%s : chaque page référencée a un titre et une description uniques, de bonne longueur', (lang) => {
    const rows = indexed.filter((t) => t.lang === lang).map((t) => ({ key: t.key, title: pageTitle(lang, t.key, 'B2C'), description: pageDescription(lang, t.key) }));
    expect(rows).toHaveLength(16);
    expect(new Set(rows.map((r) => r.title)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.description)).size).toBe(rows.length);
    for (const row of rows) {
      expect({ key: row.key, ok: row.title.length >= 20 && row.title.length <= 66 }).toEqual({ key: row.key, ok: true });
      expect({ key: row.key, ok: row.description.length >= 95 && row.description.length <= 165 }).toEqual({ key: row.key, ok: true });
    }
  });

  it('les métadonnées ne sont pas les mêmes d’une langue à l’autre (aucune langue mélangée)', () => {
    for (const { key } of indexed.filter((t) => t.lang === 'fr')) {
      const titles = LANGS.map((lang) => pageTitle(lang, key, 'B2C'));
      expect(new Set(titles).size).toBe(3);
    }
  });

  it.each(['/fr', '/en/services/air', '/ht/faq'])('%s : le titre posé par l’application dans le navigateur est celui du pré-rendu', (url) => {
    const [, lang, ...rest] = url.split('/');
    const target = prerenderTargets.find((t) => t.lang === lang && t.path === (rest.length ? `/${rest.join('/')}` : ''))!;
    expect(render(url).head.title).toBe(pageTitle(target.lang, target.key, 'B2C'));
  });
});

describe('balises <head> des pages référencées', () => {
  it.each(indexed.map((t) => [`/${t.lang}${t.path}`, t] as const))('%s : canonical, hreflang réciproques, robots, Open Graph et Twitter', (url, target) => {
    const tags = buildHeadTags(target, site).join('\n');
    const canonical = `https://exemple.test${url}`;
    expect(tags).toContain(`<link rel="canonical" href="${canonical}" />`);
    for (const lang of LANGS) expect(tags).toContain(`hreflang="${lang}" href="https://exemple.test/${lang}${target.path}"`);
    expect(tags).toContain(`hreflang="x-default" href="https://exemple.test/fr${target.path}"`);
    expect(tags).toContain(`<meta name="robots" content="${ROBOTS_INDEX}" />`);
    for (const property of ['og:site_name', 'og:title', 'og:description', 'og:url', 'og:locale', 'og:image', 'og:image:alt']) expect(tags).toContain(`property="${property}"`);
    for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) expect(tags).toContain(`name="${name}"`);
    expect(tags).toContain(`<meta property="og:url" content="${canonical}" />`);
    expect(tags.match(/<title>/g)).toHaveLength(1);
    expect(tags.match(/name="description"/g)).toHaveLength(1);
  });

  it('les pages non référencées portent noindex, sans canonical ni Open Graph ni données structurées', () => {
    const login = prerenderTargets.find((t) => t.key === 'login' && t.lang === 'fr')!;
    const forgot = prerenderTargets.find((t) => t.key === 'forgotPassword' && t.lang === 'fr')!;
    expect(login.index).toBe(false);
    for (const [target, follow] of [[login, 'follow'], [forgot, 'nofollow']] as const) {
      const tags = buildHeadTags(target, site).join('\n');
      expect(tags).toContain(`<meta name="robots" content="noindex, ${follow}" />`);
      expect(tags).not.toMatch(/canonical|og:|twitter:|ld\+json/);
    }
    // Aucune page non référencée dans le sitemap : la liste des pages référencées exclut la connexion et les pages utilitaires
    expect(indexed.map((t) => t.key)).not.toEqual(expect.arrayContaining(['login']));
    expect(indexed.every((t) => !/account|forgot|reset|verify|accept-invite|login/.test(t.path))).toBe(true);
  });

  it('les codes de vérification des outils pour webmasters ne sont publiés que s’ils sont fournis', () => {
    const home = prerenderTargets.find((t) => t.key === 'home' && t.lang === 'fr')!;
    expect(buildHeadTags(home, site).join('')).not.toMatch(/google-site-verification|msvalidate/);
    const tags = buildHeadTags(home, { ...site, googleVerification: 'abc"123', bingVerification: 'xyz' }).join('\n');
    expect(tags).toContain('<meta name="google-site-verification" content="abc&quot;123" />');
    expect(tags).toContain('<meta name="msvalidate.01" content="xyz" />');
  });
});

describe('données structurées JSON-LD', () => {
  it.each(indexed.map((t) => [`/${t.lang}${t.path}`, t] as const))('%s : JSON valide, identifiants cohérents, aucune donnée inventée', (url, target) => {
    const ld = jsonLdOf(buildHeadTags(target, site));
    expect(ld).toBeDefined();
    const graph = ld!['@graph'];
    const ids = graph.map((n) => n['@id']);
    expect(new Set(ids).size).toBe(ids.length);
    const types = graph.map((n) => (Array.isArray(n['@type']) ? n['@type'][0] : n['@type']));
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
    expect(types.filter((t) => ['WebPage', 'AboutPage', 'ContactPage'].includes(t))).toHaveLength(1);
    expect(types).not.toContain('FAQPage'); // Google n'affiche plus ce résultat enrichi pour ce type de site
    const webPage = graph.find((n) => ['WebPage', 'AboutPage', 'ContactPage'].includes(n['@type']))!;
    expect(webPage).toMatchObject({ url: `https://exemple.test${url}`, inLanguage: target.lang, name: pageTitle(target.lang, target.key, 'B2C'), description: pageDescription(target.lang, target.key) });
    // Aucune coordonnée n'est publiée tant qu'elle n'est pas fournie
    const org = graph.find((n) => n['@type'] === 'Organization')!;
    expect(org).not.toHaveProperty('telephone');
    expect(org).not.toHaveProperty('email');
    expect(org).not.toHaveProperty('contactPoint');
    expect(org).not.toHaveProperty('address');
    expect(org).not.toHaveProperty('sameAs');
    // Toutes les adresses sont absolues
    for (const match of JSON.stringify(graph).matchAll(/"(?:url|item)":"([^"]+)"/g)) expect(match[1]).toMatch(/^https:\/\/exemple\.test\//);
  });

  it.each(LANGS)('%s : le fil d’Ariane des données structurées est celui qui est affiché', (lang) => {
    for (const target of indexed.filter((t) => t.lang === lang && t.key !== 'home')) {
      const ld = jsonLdOf(buildHeadTags(target, site))!;
      const list = ld['@graph'].find((n) => n['@type'] === 'BreadcrumbList')!;
      const trail = breadcrumbTrail(target.key, catalogs[lang]);
      expect(list.itemListElement.map((i: any) => i.name)).toEqual(trail.map((c) => c.label));
      expect(list.itemListElement.map((i: any) => i.position)).toEqual(trail.map((_, i) => i + 1));
      const html = render(`/${lang}${target.path}`).html;
      const visible = [...(html.match(/<nav class="breadcrumbs"[\s\S]*?<\/nav>/)?.[0].matchAll(/<(?:a|span)[^>]*>([^<]+)<\/(?:a|span)>/g) ?? [])].map((m) => m[1].replace(/&#x27;/g, '’'));
      expect(visible.length).toBe(trail.length);
    }
    // L'accueil n'a pas de fil d'Ariane
    const home = indexed.find((t) => t.lang === lang && t.key === 'home')!;
    expect(jsonLdOf(buildHeadTags(home, site))!['@graph'].some((n) => n['@type'] === 'BreadcrumbList')).toBe(false);
    expect(render(`/${lang}`).html).not.toContain('class="breadcrumbs"');
  });

  it('les 4 pages de service décrivent un Service rattaché à l’organisation, la page « services » une liste de ces 4 services', () => {
    for (const key of ['air', 'sea', 'international', 'local'] as const) {
      const target = indexed.find((t) => t.lang === 'en' && t.key === key)!;
      const service = jsonLdOf(buildHeadTags(target, site))!['@graph'].find((n) => n['@type'] === 'Service')!;
      expect(service).toMatchObject({ name: catalogs.en.nav[key], provider: { '@id': 'https://exemple.test/#organization' }, description: catalogs.en.servicePages[key].lead });
    }
    const services = indexed.find((t) => t.lang === 'fr' && t.key === 'services')!;
    const list = jsonLdOf(buildHeadTags(services, site))!['@graph'].find((n) => n['@type'] === 'ItemList')!;
    expect(list.itemListElement).toHaveLength(4);
    expect(jsonLdOf(buildHeadTags(indexed.find((t) => t.lang === 'fr' && t.key === 'faq')!, site))!['@graph'].some((n) => n['@type'] === 'Service')).toBe(false);
  });

  it('les coordonnées fournies sont publiées (contactPoint, sameAs, LocalBusiness si adresse) ; le texte est protégé contre l’injection', () => {
    const rich: SiteSeo = {
      ...site,
      brandName: 'Marque </script><b>',
      organization: { email: 'contact@exemple.test', telephone: '+509 0000 0000', sameAs: ['https://www.facebook.com/exemple'], address: { streetAddress: '1 rue Test', addressLocality: 'Port-au-Prince', addressCountry: 'HT' } },
    };
    const home = indexed.find((t) => t.lang === 'fr' && t.key === 'home')!;
    const tags = buildHeadTags(home, rich);
    const script = tags.find((tag) => tag.startsWith('<script type="application/ld+json">'))!;
    expect(script.slice(0, -'</script>'.length)).not.toContain('</');
    const org = jsonLdOf(tags)!['@graph'][0];
    expect(org['@type']).toEqual(['Organization', 'LocalBusiness']);
    expect(org).toMatchObject({ email: 'contact@exemple.test', telephone: '+509 0000 0000', sameAs: ['https://www.facebook.com/exemple'], address: { '@type': 'PostalAddress', addressLocality: 'Port-au-Prince' } });
    expect(org.contactPoint).toMatchObject({ contactType: 'customer service', email: 'contact@exemple.test' });
    expect(buildJsonLd(home, rich)).toHaveProperty('@context', 'https://schema.org');
  });
});
