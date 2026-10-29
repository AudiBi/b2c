// Serveur de prévisualisation du panel construit (dist) avec proxy vers l'API sur /v1.
// Sert à la recette locale et aux tests E2E ; ce n'est PAS un serveur de production (voir docs/ADMIN.md).
//   PORT=4174 API_URL=http://localhost:3100 node scripts/serve-dist.mjs
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT ?? 4174);
const api = new URL(process.env.API_URL ?? 'http://localhost:3100');

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function fileFor(pathname) {
  const target = normalize(join(root, decodeURIComponent(pathname)));
  if (target !== root && !target.startsWith(root + sep)) return null; // jamais en dehors de dist
  try {
    const info = await stat(target);
    return info.isFile() ? target : null;
  } catch {
    return null;
  }
}

// Même politique que la production (docker/nginx/admin.conf.template) : aucun script ni style externe ou en ligne
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
};

const send = (res, status, file, immutable) => {
  res.writeHead(status, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...SECURITY_HEADERS,
  });
  createReadStream(file).pipe(res);
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
  const file = await fileFor(url.pathname);
  if (file) return send(res, 200, file, url.pathname.startsWith('/assets/'));
  // Application monopage : tout autre chemin est résolu par le routeur du navigateur
  return send(res, 200, join(root, 'index.html'));
}).listen(port, () => console.log(`Panel servi sur http://localhost:${port} (API : ${api.origin})`));
