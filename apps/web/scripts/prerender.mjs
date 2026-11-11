// Pré-rendu : produit un fichier HTML complet par page publique et par langue, à partir du rendu serveur React.
// Résultat dans dist/client (à déployer tel quel derrière un serveur web statique).
//   SITE_URL=https://exemple.com npm run build   (URL publique : canonical, hreflang, sitemap)
// Variables facultatives (aucune valeur n'est inventée : ce qui n'est pas fourni n'est pas publié) :
//   VITE_BRAND_NAME                  nom de la marque (titres, Open Graph, données structurées)
//   SEO_GOOGLE_SITE_VERIFICATION     code de vérification Google Search Console (balise meta)
//   SEO_BING_SITE_VERIFICATION       code de vérification Bing Webmaster Tools (balise meta)
//   SEO_ORGANIZATION_JSON            {"email":"…","telephone":"…","sameAs":["https://…"],"address":{"streetAddress":"…","addressLocality":"…","addressCountry":"HT"}}
//   SEO_API_URL                      API joignable à la construction : e-mail, premier téléphone et réseaux sociaux publics de l'entreprise
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist/client');
const siteUrl = (process.env.SITE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
if (!process.env.SITE_URL) console.warn(`SITE_URL non défini : utilisation de ${siteUrl} pour les URL canoniques et le sitemap.`);

const template = await readFile(join(outDir, 'index.html'), 'utf8');
const { render, prepare, prerenderTargets, buildHeadTags } = await import(pathToFileURL(join(root, 'dist/server/entry-server.js')).href);
await prepare();

const LANGS = ['fr', 'ht', 'en'];

// Fichier JavaScript des textes de chaque langue (téléchargé à la demande) : préchargé pour éviter une cascade de requêtes
const manifest = JSON.parse(await readFile(join(outDir, '.vite/manifest.json'), 'utf8'));
for (const l of LANGS) if (!manifest[`src/i18n/${l}.ts`]) throw new Error(`Textes « ${l} » introuvables dans le manifeste de construction`);
const catalogFile = Object.fromEntries(LANGS.map((l) => [l, `/${manifest[`src/i18n/${l}.ts`].file}`]));

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlOf = (lang, path) => `${siteUrl}/${lang}${path}`;

// Informations de l'entreprise publiées dans les données structurées (facultatives)
async function organization() {
  const found = {};
  if (process.env.SEO_API_URL) {
    try {
      const slug = process.env.VITE_COMPANY_SLUG ?? 'demo';
      const response = await fetch(`${process.env.SEO_API_URL.replace(/\/$/, '')}/v1/public/companies/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contact = (await response.json()).contact ?? {};
      if (contact.email) found.email = contact.email;
      if (contact.phones?.[0]) found.telephone = contact.phones[0];
      const social = [contact.facebook, contact.instagram, contact.tiktok, contact.youtube].filter((u) => typeof u === 'string' && /^https:\/\//.test(u));
      if (social.length > 0) found.sameAs = social;
      console.log(`Coordonnées publiques lues depuis l'API : ${Object.keys(found).join(', ') || 'aucune'}.`);
    } catch (error) {
      console.warn(`SEO_API_URL injoignable (${error.message}) : données structurées sans coordonnées.`);
    }
  }
  if (process.env.SEO_ORGANIZATION_JSON) {
    try {
      Object.assign(found, JSON.parse(process.env.SEO_ORGANIZATION_JSON));
    } catch {
      throw new Error('SEO_ORGANIZATION_JSON n’est pas un JSON valide');
    }
  }
  return Object.keys(found).length > 0 ? found : undefined;
}

const site = {
  siteUrl,
  brandName: process.env.VITE_BRAND_NAME ?? 'B2C',
  googleVerification: process.env.SEO_GOOGLE_SITE_VERIFICATION || undefined,
  bingVerification: process.env.SEO_BING_SITE_VERIFICATION || undefined,
  organization: await organization(),
};

function page(target) {
  const { lang, path } = target;
  const { html } = render(`/${lang}${path}`);
  return template
    .replace('<html lang="fr">', `<html lang="${lang}">`)
    .replace('<!--app-head-->', [`<link rel="modulepreload" href="${catalogFile[lang]}" />`, ...buildHeadTags(target, site)].join('\n    '))
    .replace('<!--app-html-->', html);
}

async function write(file, content) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

let count = 0;
for (const target of prerenderTargets) {
  await write(join(outDir, target.lang, target.path, 'index.html'), page(target));
  count += 1;
}

// Page d'erreur 404 (rendu de la page « introuvable » en français) : jamais indexée
await write(join(outDir, '404.html'), page({ lang: 'fr', key: 'notFound', path: '/page-introuvable', index: false, follow: false }));

// Coquille de l'application pour les pages qui ne se pré-rendent pas (espace client, protégé par la connexion)
await write(
  join(outDir, '200.html'),
  template.replace('<!--app-head-->', '<meta name="robots" content="noindex, nofollow" />\n    <title>…</title>').replace('<!--app-html-->', ''),
);

// Racine : choix de la langue (redirection selon la préférence mémorisée ou la langue du navigateur). Non référencée : seules
// les pages de chaque langue le sont ; ses liens sont suivis pour que les moteurs les découvrent.
const verification = [
  site.googleVerification ? `<meta name="google-site-verification" content="${esc(site.googleVerification)}" />` : '',
  site.bingVerification ? `<meta name="msvalidate.01" content="${esc(site.bingVerification)}" />` : '',
]
  .filter(Boolean)
  .join('\n    ');
await write(
  join(outDir, 'index.html'),
  `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0b2545" />
    <meta name="robots" content="noindex, follow" />
    <title>${esc(site.brandName)} | Langue / Lang / Language</title>
    <meta name="description" content="Choisissez votre langue · Chwazi lang ou · Choose your language" />
    ${verification ? `${verification}\n    ` : ''}<link rel="canonical" href="${siteUrl}/" />
    ${LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${urlOf(l, '')}" />`).join('\n    ')}
    <link rel="alternate" hreflang="x-default" href="${urlOf('fr', '')}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-48.png" sizes="48x48" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="stylesheet" href="/language.css" />
    <script src="/language.js" defer></script>
  </head>
  <body>
    <main>
      <h1>Choisissez votre langue · Chwazi lang ou · Choose your language</h1>
      <p><a href="/fr" lang="fr" hreflang="fr">Français</a> <a href="/ht" lang="ht" hreflang="ht">Kreyòl ayisyen</a> <a href="/en" lang="en" hreflang="en">English</a></p>
    </main>
  </body>
</html>
`,
);

// sitemap.xml (pages référencées uniquement, avec leurs variantes de langue) et robots.txt
const indexed = prerenderTargets.filter((t) => t.index);
const paths = [...new Set(indexed.map((t) => t.path))];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${indexed
  .map(
    (t) => `  <url>
    <loc>${esc(urlOf(t.lang, t.path))}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(urlOf(l, t.path))}" />`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(urlOf('fr', t.path))}" />
  </url>`,
  )
  .join('\n')}
</urlset>
`;
await write(join(outDir, 'sitemap.xml'), sitemap);
// Les ressources nécessaires au rendu (/assets/, images) restent autorisées. L'espace client et l'API ne sont pas à explorer ;
// ce fichier n'est PAS une protection (l'accès est contrôlé par la connexion et par l'en-tête X-Robots-Tag du serveur web).
await write(
  join(outDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n${LANGS.map((l) => `Disallow: /${l}/account`).join('\n')}\nDisallow: /v1/\nSitemap: ${siteUrl}/sitemap.xml\n`,
);

console.log(`Pré-rendu terminé : ${count} pages (${paths.length} chemins référencés × ${LANGS.length} langues + pages non référencées), 404.html, 200.html, sitemap.xml, robots.txt.`);

// Pré-compression (gzip et Brotli) : le serveur web envoie ces fichiers tels quels (gzip_static) au lieu de compresser à chaque requête
await rm(join(outDir, '.vite'), { recursive: true, force: true });
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.xml', '.txt', '.json']);
let compressed = 0;
async function compressTree(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await compressTree(file);
    else if (COMPRESSIBLE.has(extname(entry.name)) && (await stat(file)).size >= 256) {
      const content = await readFile(file);
      await writeFile(`${file}.gz`, gzipSync(content, { level: 9 }));
      await writeFile(`${file}.br`, brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: content.length } }));
      compressed += 1;
    }
  }
}
await compressTree(outDir);
console.log(`Pré-compression : ${compressed} fichiers (.gz et .br).`);
