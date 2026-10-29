// Pré-rendu : produit un fichier HTML complet par page publique et par langue, à partir du rendu serveur React.
// Résultat dans dist/client (à déployer tel quel derrière un serveur web statique).
//   SITE_URL=https://exemple.com npm run build   (URL publique : canonical, hreflang, sitemap)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist/client');
const siteUrl = (process.env.SITE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
if (!process.env.SITE_URL) console.warn(`SITE_URL non défini : utilisation de ${siteUrl} pour les URL canoniques et le sitemap.`);

const template = await readFile(join(outDir, 'index.html'), 'utf8');
const { render, prerenderTargets } = await import(pathToFileURL(join(root, 'dist/server/entry-server.js')).href);

const LANGS = ['fr', 'ht', 'en'];
const OG_LOCALE = { fr: 'fr_FR', ht: 'ht_HT', en: 'en_US' };
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlOf = (lang, path) => `${siteUrl}/${lang}${path}`;

function headTags({ lang, path, index, head }) {
  const tags = [`<title>${esc(head.title ?? '')}</title>`];
  if (head.description) tags.push(`<meta name="description" content="${esc(head.description)}" />`);
  if (!index) {
    tags.push('<meta name="robots" content="noindex" />');
  } else {
    tags.push(`<link rel="canonical" href="${esc(urlOf(lang, path))}" />`);
    for (const other of LANGS) tags.push(`<link rel="alternate" hreflang="${other}" href="${esc(urlOf(other, path))}" />`);
    tags.push(`<link rel="alternate" hreflang="x-default" href="${esc(urlOf('fr', path))}" />`);
    tags.push(
      '<meta property="og:type" content="website" />',
      `<meta property="og:title" content="${esc(head.title ?? '')}" />`,
      `<meta property="og:description" content="${esc(head.description ?? '')}" />`,
      `<meta property="og:url" content="${esc(urlOf(lang, path))}" />`,
      `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`,
      `<meta property="og:image" content="${siteUrl}/og-image.png" />`,
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      '<meta property="og:image:alt" content="B2C — Business to Customer" />',
      '<meta name="twitter:card" content="summary_large_image" />',
      `<meta name="twitter:image" content="${siteUrl}/og-image.png" />`,
    );
  }
  return tags.join('\n    ');
}

function page({ lang, path, index }) {
  const url = `/${lang}${path}`;
  const { html, head } = render(url);
  return template
    .replace('<html lang="fr">', `<html lang="${lang}">`)
    .replace('<!--app-head-->', headTags({ lang, path, index, head }))
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

// Page d'erreur 404 (rendu de la page « introuvable » en français)
await write(join(outDir, '404.html'), page({ lang: 'fr', path: '/page-introuvable', index: false }));

// Coquille de l'application pour les pages qui ne se pré-rendent pas (espace client, protégé par la connexion)
await write(
  join(outDir, '200.html'),
  template.replace('<!--app-head-->', '<meta name="robots" content="noindex" />\n    <title>…</title>').replace('<!--app-html-->', ''),
);

// Racine : choix de la langue (redirection selon la préférence mémorisée ou la langue du navigateur)
await write(
  join(outDir, 'index.html'),
  `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Langue / Lang / Language</title>
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
      <p><a href="/fr/" lang="fr" hreflang="fr">Français</a> <a href="/ht/" lang="ht" hreflang="ht">Kreyòl ayisyen</a> <a href="/en/" lang="en" hreflang="en">English</a></p>
    </main>
  </body>
</html>
`,
);

// sitemap.xml (pages référencées uniquement) et robots.txt
const indexed = prerenderTargets.filter((t) => t.index);
const paths = [...new Set(indexed.map((t) => t.path))];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${indexed
  .map(
    (t) => `  <url>
    <loc>${esc(urlOf(t.lang, t.path))}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(urlOf(l, t.path))}" />`).join('\n')}
  </url>`,
  )
  .join('\n')}
</urlset>
`;
await write(join(outDir, 'sitemap.xml'), sitemap);
await write(
  join(outDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n${LANGS.map((l) => `Disallow: /${l}/account`).join('\n')}\nSitemap: ${siteUrl}/sitemap.xml\n`,
);

console.log(`Pré-rendu terminé : ${count} pages (${paths.length} chemins × ${LANGS.length} langues, dont pages utilitaires), 404.html, 200.html, sitemap.xml, robots.txt.`);
