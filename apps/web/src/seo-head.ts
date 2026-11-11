import { breadcrumbTrail } from './breadcrumbs';
import { LANGS, catalogs, type Lang } from './i18n';
import { localizedPath, paths, type PageKey } from './routes';

/** Informations de l'entreprise publiées dans les données structurées. Tout est facultatif : rien n'est inventé. */
export interface SiteOrganization {
  email?: string;
  telephone?: string;
  /** Profils officiels (réseaux sociaux) : adresses complètes. */
  sameAs?: string[];
  /** Adresse postale structurée : ajoute le type LocalBusiness. */
  address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string; addressCountry?: string };
}

export interface SiteSeo {
  /** URL publique du site, sans barre finale (« https://exemple.com »). */
  siteUrl: string;
  /** Nom complet (og:site_name, données structurées). */
  brandName: string;
  /** Nom court des titres de page (par défaut : le nom complet). */
  shortName?: string;
  /** Codes de vérification des outils pour webmasters (balises meta). */
  googleVerification?: string;
  bingVerification?: string;
  organization?: SiteOrganization;
}

export interface HeadPage {
  lang: Lang;
  key: PageKey;
  /** Chemin sans préfixe de langue (« /services/air », '' pour l'accueil). */
  path: string;
  index: boolean;
  /** Pages non référencées : liens suivis ou non. */
  follow?: boolean;
}

const OG_LOCALE: Record<Lang, string> = { fr: 'fr_FR', ht: 'ht_HT', en: 'en_US' };
export const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

const SERVICE_KEYS = ['air', 'sea', 'international', 'local'] as const;
const SERVICE_TYPE: Record<(typeof SERVICE_KEYS)[number], string> = {
  air: 'Air freight forwarding',
  sea: 'Sea freight forwarding',
  international: 'International freight forwarding',
  local: 'Local package delivery and pickup',
};

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const pageUrl = (site: SiteSeo, lang: Lang, path: string) => `${site.siteUrl}${localizedPath(lang, path)}`;

/** Titre de la page (accueil : marque d'abord) : même règle que le titre appliqué dans le navigateur. */
export function pageTitle(lang: Lang, key: PageKey, brand: string): string {
  const entry = catalogs[lang].seo[key as keyof (typeof catalogs)[Lang]['seo']];
  return key === 'home' ? `${brand} | ${entry.title}` : `${entry.title} | ${brand}`;
}

export function pageDescription(lang: Lang, key: PageKey): string {
  return catalogs[lang].seo[key as keyof (typeof catalogs)[Lang]['seo']].description;
}

function organizationNode(site: SiteSeo) {
  const org = site.organization ?? {};
  const node: Record<string, unknown> = {
    '@type': org.address ? ['Organization', 'LocalBusiness'] : 'Organization',
    '@id': `${site.siteUrl}/#organization`,
    name: site.brandName,
    ...(site.shortName && site.shortName !== site.brandName ? { alternateName: site.shortName } : {}),
    url: `${site.siteUrl}/`,
    logo: { '@type': 'ImageObject', url: `${site.siteUrl}/apple-touch-icon.png`, width: 180, height: 180 },
    image: `${site.siteUrl}/og-image.png`,
    areaServed: { '@type': 'Country', name: 'Haiti' },
  };
  if (org.email) node.email = org.email;
  if (org.telephone) node.telephone = org.telephone;
  if (org.sameAs?.length) node.sameAs = org.sameAs;
  if (org.address) node.address = { '@type': 'PostalAddress', ...org.address };
  if (org.email || org.telephone) {
    node.contactPoint = {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      ...(org.email ? { email: org.email } : {}),
      ...(org.telephone ? { telephone: org.telephone } : {}),
      availableLanguage: ['French', 'Haitian Creole', 'English'],
      areaServed: 'HT',
    };
  }
  return node;
}

const WEBPAGE_TYPE: Partial<Record<PageKey, string>> = { about: 'AboutPage', contact: 'ContactPage' };

/**
 * Données structurées JSON-LD d'une page indexée : Organization, WebSite, WebPage (ou sous-type), BreadcrumbList et, pour les
 * pages de service, Service. Chaque information provient du contenu visible du site ou de la configuration fournie ; FAQPage
 * n'est volontairement pas utilisé (Google ne l'affiche plus que pour des sites officiels de santé ou d'administration).
 */
export function buildJsonLd(page: HeadPage, site: SiteSeo): object {
  const m = catalogs[page.lang];
  const url = pageUrl(site, page.lang, page.path);
  const title = pageTitle(page.lang, page.key, site.shortName ?? site.brandName);
  const description = pageDescription(page.lang, page.key);
  const graph: Record<string, unknown>[] = [
    organizationNode(site),
    {
      '@type': 'WebSite',
      '@id': `${site.siteUrl}/#website`,
      url: `${site.siteUrl}/`,
      name: site.brandName,
      ...(site.shortName && site.shortName !== site.brandName ? { alternateName: site.shortName } : {}),
      inLanguage: [...LANGS],
      publisher: { '@id': `${site.siteUrl}/#organization` },
    },
  ];

  const trail = breadcrumbTrail(page.key, m);
  graph.push({
    '@type': WEBPAGE_TYPE[page.key] ?? 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: page.lang,
    isPartOf: { '@id': `${site.siteUrl}/#website` },
    about: { '@id': `${site.siteUrl}/#organization` },
    primaryImageOfPage: { '@type': 'ImageObject', url: `${site.siteUrl}/og-image.png`, width: 1200, height: 630 },
    ...(trail.length > 0 ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
  });

  if (trail.length > 0) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: trail.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.label,
        // Le dernier élément est la page courante : son adresse est facultative mais cohérente avec la canonical
        item: pageUrl(site, page.lang, paths[crumb.key]),
      })),
    });
  }

  if ((SERVICE_KEYS as readonly string[]).includes(page.key)) {
    const kind = page.key as (typeof SERVICE_KEYS)[number];
    graph.push({
      '@type': 'Service',
      '@id': `${url}#service`,
      name: m.nav[kind],
      serviceType: SERVICE_TYPE[kind],
      description: m.servicePages[kind].lead,
      url,
      provider: { '@id': `${site.siteUrl}/#organization` },
      areaServed: { '@type': 'Country', name: 'Haiti' },
      mainEntityOfPage: { '@id': `${url}#webpage` },
    });
  }

  if (page.key === 'services') {
    graph.push({
      '@type': 'ItemList',
      '@id': `${url}#services`,
      name: m.nav.services,
      itemListElement: SERVICE_KEYS.map((kind, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: m.nav[kind],
        url: pageUrl(site, page.lang, paths[kind]),
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Sérialise le JSON-LD pour une balise <script> : « < » est échappé pour ne jamais pouvoir fermer la balise. */
export const jsonLdScript = (data: object) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/** Balises <head> propres à une page (titre, description, robots, canonical, hreflang, Open Graph, Twitter, JSON-LD, vérifications). */
export function buildHeadTags(page: HeadPage, site: SiteSeo): string[] {
  const title = pageTitle(page.lang, page.key, site.shortName ?? site.brandName);
  const description = pageDescription(page.lang, page.key);
  const url = pageUrl(site, page.lang, page.path);
  const tags = [`<title>${esc(title)}</title>`, `<meta name="description" content="${esc(description)}" />`];

  if (site.googleVerification) tags.push(`<meta name="google-site-verification" content="${esc(site.googleVerification)}" />`);
  if (site.bingVerification) tags.push(`<meta name="msvalidate.01" content="${esc(site.bingVerification)}" />`);

  if (!page.index) {
    tags.push(`<meta name="robots" content="noindex, ${page.follow ? 'follow' : 'nofollow'}" />`);
    return tags;
  }

  const imageAlt = `${site.brandName} — ${catalogs[page.lang].seo.home.title}`;
  tags.push(
    `<meta name="robots" content="${ROBOTS_INDEX}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    ...LANGS.map((other) => `<link rel="alternate" hreflang="${other}" href="${esc(pageUrl(site, other, page.path))}" />`),
    `<link rel="alternate" hreflang="x-default" href="${esc(pageUrl(site, 'fr', page.path))}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(site.brandName)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[page.lang]}" />`,
    ...LANGS.filter((other) => other !== page.lang).map((other) => `<meta property="og:locale:alternate" content="${OG_LOCALE[other]}" />`),
    `<meta property="og:image" content="${site.siteUrl}/og-image.png" />`,
    '<meta property="og:image:type" content="image/png" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc(imageAlt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${site.siteUrl}/og-image.png" />`,
    `<meta name="twitter:image:alt" content="${esc(imageAlt)}" />`,
    jsonLdScript(buildJsonLd(page, site)),
  );
  return tags;
}
