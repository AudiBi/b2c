// Contrôleur SEO du site CONSTRUIT (dist/client) : lit le HTML pré-rendu comme le ferait un moteur de recherche qui n'exécute
// pas JavaScript, et échoue (code 1) à la moindre anomalie vérifiable.
//   npm run build:web && npm run seo:check [-w @b2c/web]
// Ce contrôleur ne mesure ni la performance ni l'indexation réelle : voir docs/SEO.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/client');
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/client introuvable : lancer « npm run build:web » d’abord.');
  process.exit(2);
}

const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

// ---------------------------------------------------------------------------------------------
// Lecture des pages
// ---------------------------------------------------------------------------------------------
const pages = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'assets') walk(file);
    } else if (entry.name === 'index.html') {
      pages.push(file);
    }
  }
})(root);

const urlPathOf = (file) => '/' + relative(root, dirname(file)).split(sep).join('/').replace(/^\.$/, '');
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
const metaContent = (html, name) => attr((html.match(new RegExp(`<meta [^>]*name="${name}"[^>]*>`)) ?? [''])[0], 'content');
const unescape = (value) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const data = pages.map((file) => {
  const html = readFileSync(file, 'utf8');
  const path = urlPathOf(file);
  const robots = metaContent(html, 'robots') ?? '';
  return {
    file,
    path,
    html,
    lang: (html.match(/<html lang="([^"]+)"/) ?? [])[1],
    title: unescape((html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? ''),
    description: unescape(metaContent(html, 'description') ?? ''),
    robots,
    indexable: !/noindex/.test(robots),
    canonical: (html.match(/<link rel="canonical" href="([^"]+)"/) ?? [])[1],
    h1: (html.match(/<h1[ >]/g) ?? []).length,
    isLangRoot: path === '/',
  };
});

const origin = (() => {
  const home = data.find((p) => p.path === '/fr');
  return home?.canonical ? new URL(home.canonical).origin : undefined;
})();
check(!!origin, 'la page /fr n’a pas d’URL canonique');
const publicUrl = (path) => `${origin}${path}`;
const byPath = new Map(data.map((p) => [p.path, p]));
const indexable = data.filter((p) => p.indexable && !p.isLangRoot);

// ---------------------------------------------------------------------------------------------
// Contrôles par page
// ---------------------------------------------------------------------------------------------
const titles = new Map();
const descriptions = new Map();
const inbound = new Map();
for (const page of data) {
  const where = page.path || '/';
  if (page.isLangRoot) {
    check(/noindex/.test(page.robots) && /follow/.test(page.robots), `${where} : la page de choix de la langue doit être « noindex, follow »`);
    continue;
  }
  const lang = page.path.split('/')[1];
  check(page.lang === lang, `${where} : <html lang="${page.lang}"> au lieu de « ${lang} »`);
  check(page.title.length >= 10, `${where} : titre absent ou trop court`);
  check(page.title.length <= 70, `${where} : titre trop long (${page.title.length} caractères)`);
  check(page.description.length > 0, `${where} : description absente`);
  check(page.h1 === 1, `${where} : ${page.h1} balises h1`);
  check(/<meta charset=/.test(page.html) && /<meta name="viewport"/.test(page.html), `${where} : charset ou viewport absent`);
  check(/<link rel="icon"/.test(page.html) && /apple-touch-icon/.test(page.html), `${where} : icônes absentes`);
  check(/<main[ >]/.test(page.html), `${where} : aucun repère <main>`);

  if (page.indexable) {
    check(page.description.length >= 90 && page.description.length <= 165, `${where} : description de ${page.description.length} caractères (attendu 90 à 165)`);
    check(page.canonical === publicUrl(page.path), `${where} : canonical « ${page.canonical} » différente de l’adresse de la page`);
    check(!/noindex|nofollow/.test(page.robots), `${where} : robots restrictif sur une page référencée`);
    check(!titles.has(page.title), `${where} : titre identique à ${titles.get(page.title)}`);
    titles.set(page.title, where);
    check(!descriptions.has(page.description), `${where} : description identique à ${descriptions.get(page.description)}`);
    descriptions.set(page.description, where);

    // Variantes de langue : réciproques (chaque variante pointe vers toutes les autres, et vers elle-même)
    const alternates = [...page.html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    const langs = alternates.map(([l]) => l).sort();
    check(JSON.stringify(langs) === JSON.stringify(['en', 'fr', 'ht', 'x-default']), `${where} : hreflang incomplets (${langs})`);
    const suffix = page.path.replace(/^\/(fr|ht|en)/, '');
    for (const [l, href] of alternates) {
      if (l === 'x-default') continue;
      check(href === publicUrl(`/${l}${suffix}`), `${where} : hreflang ${l} → ${href}`);
      const other = byPath.get(`/${l}${suffix}`);
      check(!!other && other.indexable, `${where} : la variante ${l} n’existe pas ou n’est pas référencée`);
    }

    // Open Graph et Twitter
    for (const property of ['og:title', 'og:description', 'og:url', 'og:image', 'og:locale', 'og:site_name']) check(page.html.includes(`property="${property}"`), `${where} : ${property} absent`);
    for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) check(page.html.includes(`name="${name}"`), `${where} : ${name} absent`);
    check(page.html.includes(`<meta property="og:url" content="${page.canonical}"`), `${where} : og:url différente de la canonical`);

    // Données structurées
    const scripts = [...page.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    check(scripts.length === 1, `${where} : ${scripts.length} blocs JSON-LD`);
    try {
      const graph = JSON.parse(scripts[0])['@graph'];
      const types = graph.map((n) => [n['@type']].flat()[0]);
      for (const needed of ['Organization', 'WebSite']) check(types.includes(needed), `${where} : JSON-LD sans ${needed}`);
      check(types.some((t) => ['WebPage', 'AboutPage', 'ContactPage'].includes(t)), `${where} : JSON-LD sans WebPage`);
      check(!types.includes('FAQPage'), `${where} : FAQPage non autorisé`);
      const webPage = graph.find((n) => ['WebPage', 'AboutPage', 'ContactPage'].includes(n['@type']));
      check(webPage?.url === page.canonical && webPage?.inLanguage === lang, `${where} : WebPage incohérente avec la page (url ou langue)`);
      check(types.includes('BreadcrumbList') === (suffix !== ''), `${where} : fil d’Ariane des données structurées ${suffix === '' ? 'inattendu' : 'absent'}`);
      check(suffix === '' || page.html.includes('class="breadcrumbs"'), `${where} : fil d’Ariane visible absent`);
    } catch (error) {
      problems.push(`${where} : JSON-LD invalide (${error.message})`);
    }
  } else {
    check(!page.canonical, `${where} : page non référencée avec une canonical`);
  }

  // Liens internes et images
  for (const match of page.html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>/g)) {
    const href = match[1];
    if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
    const target = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
    inbound.set(target, (inbound.get(target) ?? 0) + 1);
    const known = byPath.has(target) || existsSync(join(root, target)) || /^\/(fr|ht|en)\/account/.test(target) || target === '/' || target.startsWith('/#');
    check(known, `${where} : lien interne cassé « ${href} »`);
  }
  for (const img of page.html.matchAll(/<img [^>]*>/g)) {
    const tag = img[0];
    check(/ alt="/.test(tag), `${where} : image sans attribut alt (${attr(tag, 'src')})`);
    check(/ width="\d+"/.test(tag) && / height="\d+"/.test(tag), `${where} : image sans dimensions (${attr(tag, 'src')})`);
  }
  check(!/undefined|\[object Object\]/.test(page.html.replace(/<script[\s\S]*?<\/script>/g, '')), `${where} : valeur « undefined » dans le HTML`);
}

// Pages orphelines : toute page référencée reçoit au moins un lien interne d'une autre page
for (const page of indexable) {
  const links = inbound.get(page.path) ?? 0;
  check(page.path === '/fr' || links > 0 || page.path.startsWith('/ht') || page.path.startsWith('/en'), `${page.path} : page orpheline (aucun lien interne)`);
}
for (const lang of ['fr', 'ht', 'en']) for (const page of indexable.filter((p) => p.path.startsWith(`/${lang}`))) check((inbound.get(page.path) ?? 0) > 0 || page.path === `/${lang}`, `${page.path} : aucun lien interne entrant`);

// ---------------------------------------------------------------------------------------------
// sitemap.xml, robots.txt, pages d'erreur
// ---------------------------------------------------------------------------------------------
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(new Set(locs).size === locs.length, 'sitemap : adresses en double');
for (const loc of locs) {
  const path = new URL(loc).pathname;
  const page = byPath.get(path);
  check(!!page, `sitemap : ${loc} n’existe pas dans le site`);
  check(page?.indexable === true, `sitemap : ${loc} est « noindex »`);
  check(page?.canonical === loc, `sitemap : ${loc} n’est pas la canonical de sa page`);
}
for (const page of indexable) check(locs.includes(publicUrl(page.path)), `sitemap : ${page.path} (page référencée) absente`);
const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
check(robots.includes(`Sitemap: ${origin}/sitemap.xml`), 'robots.txt : ligne Sitemap absente ou incorrecte');
for (const lang of ['fr', 'ht', 'en']) check(robots.includes(`Disallow: /${lang}/account`), `robots.txt : /${lang}/account non exclu`);
check(robots.includes('Disallow: /v1/'), 'robots.txt : /v1/ non exclu');
check(!/Disallow:\s*\/(assets|\*\.js|\*\.css)?\s*$/m.test(robots), 'robots.txt : les ressources de rendu ne doivent pas être bloquées');
const notFound = readFileSync(join(root, '404.html'), 'utf8');
check(/noindex/.test(metaContent(notFound, 'robots') ?? ''), '404.html : doit être « noindex »');
check(/noindex/.test(readFileSync(join(root, '200.html'), 'utf8')), '200.html (espace client) : doit être « noindex »');

// Ressources : chaque fichier compressible a ses versions .gz et .br
for (const file of ['sitemap.xml', 'fr/index.html']) check(existsSync(join(root, `${file}.gz`)) && existsSync(join(root, `${file}.br`)), `${file} : versions pré-compressées absentes`);
for (const entry of readdirSync(join(root, 'assets'))) if (/\.(js|css)$/.test(entry) && statSync(join(root, 'assets', entry)).size >= 256) check(existsSync(join(root, 'assets', `${entry}.gz`)), `assets/${entry} : version .gz absente`);

// ---------------------------------------------------------------------------------------------
console.log(`Contrôle SEO : ${data.length} pages lues, ${indexable.length} référencées, ${locs.length} adresses dans le sitemap.`);
if (problems.length > 0) {
  console.error(`\n${problems.length} anomalie(s) :`);
  for (const message of problems) console.error(` ✗ ${message}`);
  process.exit(1);
}
console.log('Aucune anomalie.');
