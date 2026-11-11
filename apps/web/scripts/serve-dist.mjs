// Serveur de prévisualisation du site construit (dist/client) avec proxy vers l'API sur /v1.
// Sert à la recette locale et aux tests E2E ; ce n'est PAS un serveur de production (voir docs).
//   PORT=4173 API_URL=http://localhost:3100 node scripts/serve-dist.mjs
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/client');
const port = Number(process.env.PORT ?? 4173);
const api = new URL(process.env.API_URL ?? 'http://localhost:3100');

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function fileFor(pathname) {
  const target = normalize(join(root, decodeURIComponent(pathname)));
  if (target !== root && !target.startsWith(root + sep)) return null; // jamais en dehors de dist/client
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      const index = join(target, 'index.html');
      await stat(index);
      return index;
    }
    return target;
  } catch {
    return null;
  }
}

// Politique de sécurité de référence pour le site (à reprendre dans la configuration du serveur web de production) :
// aucun script ni style externe ou en ligne ; seuls les attributs style (posés par l'interface) sont tolérés.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// Envoie la version pré-compressée (.br puis .gz, produites au pré-rendu) quand le navigateur l'accepte, comme le serveur de production
// En-tête X-Robots-Tag des pages jamais référencées (comme nginx en production)
const robotsHeader = (pathname) => {
  if (/^\/(fr|ht|en)\/(account(\/|$)|forgot-password|reset-password|verify-email|accept-invite)/.test(pathname)) return 'noindex, nofollow';
  if (/^\/(fr|ht|en)\/login\/?$/.test(pathname)) return 'noindex, follow';
  return null;
};

const send = async (res, status, file, immutable, acceptEncoding = '', robots = null) => {
  let encoding = null;
  for (const candidate of [['br', '.br'], ['gzip', '.gz']]) {
    if (acceptEncoding.includes(candidate[0]) && (await stat(`${file}${candidate[1]}`).catch(() => null))) {
      encoding = candidate;
      break;
    }
  }
  res.writeHead(status, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
    ...(robots ? { 'X-Robots-Tag': robots } : {}),
    ...(encoding ? { 'Content-Encoding': encoding[0] } : {}),
    ...(extname(file) === '.html' ? SECURITY_HEADERS : {}),
  });
  createReadStream(encoding ? `${file}${encoding[1]}` : file).pipe(res);
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/health/')) {
    const proxied = httpRequest({ host: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host } }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    proxied.on('error', () => { res.writeHead(502); res.end('API injoignable'); });
    req.pipe(proxied);
    return;
  }

  // Une seule adresse par page : « /fr/services/ » est redirigé (301) vers « /fr/services » (comme nginx)
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    res.writeHead(301, { Location: `${url.pathname.replace(/\/+$/, '')}${url.search}` });
    return res.end();
  }

  const file = await fileFor(url.pathname);
  if (file) return send(res, 200, file, url.pathname.startsWith('/assets/'), req.headers['accept-encoding'], robotsHeader(url.pathname));
  // Espace client : coquille de l'application ; le reste : page 404
  if (/^\/(fr|ht|en)\/account(\/|$)/.test(url.pathname)) return send(res, 200, join(root, '200.html'), false, req.headers['accept-encoding'], robotsHeader(url.pathname));
  return send(res, 404, join(root, '404.html'), false, req.headers['accept-encoding'], 'noindex, nofollow');
}).listen(port, () => console.log(`Site servi sur http://localhost:${port} (API : ${api.origin})`));
