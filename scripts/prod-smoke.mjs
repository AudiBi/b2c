// Contrôle de fumée d'un déploiement de production, par le point d'entrée public (nginx), comme un visiteur.
//   SMOKE_URL=https://exemple.com node scripts/prod-smoke.mjs
// Variables facultatives :
//   SMOKE_HTTP_URL        adresse HTTP du même serveur (vérifie la redirection vers HTTPS)
//   SMOKE_ADMIN_URL       adresse HTTPS du panel d'administration : contrôles du panel ; la connexion de la plateforme passe alors par lui
//   SMOKE_INSECURE=true   accepte un certificat auto-signé (essai local UNIQUEMENT)
//   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD   compte de la plateforme (jamais journalisé) : vérifie l'obligation de la
//                         double authentification puis son activation. ATTENTION : active la double authentification de ce compte.
//   SMOKE_COMPANY_SLUG    entreprise à créer par ce compte (nom, préfixes fixes) pour vérifier la chaîne complète
// Ne crée rien d'autre ; sort avec le code 1 au premier contrôle en échec.
import { createHmac } from 'node:crypto';

const base = (process.env.SMOKE_URL ?? '').replace(/\/$/, '');
if (!base) throw new Error('SMOKE_URL requis, par exemple https://exemple.com');
if (process.env.SMOKE_INSECURE === 'true') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const adminBase = (process.env.SMOKE_ADMIN_URL ?? '').replace(/\/$/, '');
const call = async (path, init = {}) => {
  const { base: target = base, ...options } = init;
  const res = await fetch(target + path, { redirect: 'manual', ...options });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* pas du JSON */ }
  return { res, text, json, status: res.status, header: (n) => res.headers.get(n) };
};
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const jsonInit = (body, token, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });

// --- TOTP (RFC 6238) : même algorithme que l'application d'authentification de l'utilisateur ------------------------------
function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 1000 / 30);

// --- 1. Disponibilité et en-têtes ------------------------------------------------------------------------------------
const ready = await call('/health/ready');
check('/health/ready répond 200 avec PostgreSQL et Redis', ready.status === 200 && ready.json?.checks?.database === true && ready.json?.checks?.redis === true, JSON.stringify(ready.json?.checks));

const home = await call('/fr');
check('page d\'accueil /fr servie (200, HTML)', home.status === 200 && (home.header('content-type') ?? '').includes('text/html'));
check('CSP stricte sur les pages', (home.header('content-security-policy') ?? '').includes("script-src 'self'") && (home.header('content-security-policy') ?? '').includes("frame-ancestors 'none'"));
check('HSTS, nosniff, referrer-policy présents', !!home.header('strict-transport-security') && home.header('x-content-type-options') === 'nosniff' && !!home.header('referrer-policy'));
check('version du serveur non divulguée', !/\d/.test(home.header('server') ?? ''), home.header('server') ?? '(absent)');
check('/fr/account renvoie la coquille de l\'application (200)', (await call('/fr/account')).status === 200);
const missing = await call('/fr/page-qui-n-existe-pas');
check('page inconnue : vrai statut 404 avec la page 404', missing.status === 404 && missing.text.length > 200);
check('/docs (documentation de l\'API) non exposée', (await call('/docs')).status === 404);
const apiUnknown = await call('/v1/route-inconnue');
check('API : route inconnue en 404 JSON, sans X-Powered-By', apiUnknown.status === 404 && !apiUnknown.header('x-powered-by'), `statut ${apiUnknown.status}`);
check('/health/ready exposé mais pas /health/autre', (await call('/health/autre')).status === 404);
const asset = /\/assets\/[^"']+\.js/.exec(home.text)?.[0];
if (asset) {
  const a = await call(asset);
  check('ressource /assets : cache longue durée immuable et CSP', (a.header('cache-control') ?? '').includes('immutable') && !!a.header('content-security-policy'), asset);
}
if (process.env.SMOKE_HTTP_URL) {
  const http = await fetch(process.env.SMOKE_HTTP_URL.replace(/\/$/, '') + '/fr', { redirect: 'manual' });
  check('HTTP redirigé vers HTTPS (301)', http.status === 301 && (http.headers.get('location') ?? '').startsWith('https://'), http.headers.get('location') ?? '');
}

// --- 1 bis. Panel d'administration : application séparée, adresse séparée -----------------------------------------------
if (adminBase) {
  const login = await call('/login', { base: adminBase });
  check('panel : écran de connexion servi (200, HTML)', login.status === 200 && (login.header('content-type') ?? '').includes('text/html'));
  check(
    'panel : CSP stricte, cadres interdits, jamais indexé, aucun Referer sortant, HSTS',
    (login.header('content-security-policy') ?? '').includes("frame-ancestors 'none'") &&
      login.header('x-frame-options') === 'DENY' &&
      /noindex/.test(login.header('x-robots-tag') ?? '') &&
      login.header('referrer-policy') === 'no-referrer' &&
      !!login.header('strict-transport-security'),
  );
  check("panel : un chemin d'écran (/users) est résolu par l'application (200)", (await call('/users', { base: adminBase })).status === 200);
  const adminAsset = /\/assets\/[^"']+\.js/.exec(login.text)?.[0];
  if (adminAsset) check('panel : ressources en cache longue durée immuable', ((await call(adminAsset, { base: adminBase })).header('cache-control') ?? '').includes('immutable'), adminAsset);
  check('panel : API joignable par son adresse (/health/ready)', (await call('/health/ready', { base: adminBase })).status === 200);
  check('le site ne sert pas le panel (/users inconnu : vrai 404)', (await call('/users')).status === 404);
}

// --- 2. Limite de débit par IP derrière nginx : un client ne peut pas la contourner en falsifiant X-Forwarded-For ------
const codes = [];
for (let i = 0; i < 34; i += 1) {
  const r = await call('/v1/public/tracking/EEZZZZZZZZZZ', { headers: { 'X-Forwarded-For': ip() } }); // adresse falsifiée à chaque requête
  codes.push(r.status);
}
check('falsifier X-Forwarded-For ne contourne pas la limite (429 observé, nginx écrase l\'en-tête)', codes.includes(429), `${codes.filter((c) => c === 429).length} refus sur 34`);

// --- 3. Compte de la plateforme : double authentification obligatoire -------------------------------------------------
const email = process.env.SMOKE_ADMIN_EMAIL;
const password = process.env.SMOKE_ADMIN_PASSWORD;
if (email && password) {
  // Si le panel est fourni, la connexion passe par lui (avec son en-tête d'identité) : c'est le vrai chemin du personnel
  const via = adminBase ? { base: adminBase } : {};
  const appHeader = adminBase ? { 'X-Client-App': 'admin' } : {};
  const login = (extra = {}) => call('/v1/auth/login', { ...jsonInit({ email, password, ...extra }, undefined, { 'X-Forwarded-For': ip(), ...appHeader }), ...via });
  const first = await login();
  if (first.status === 200) {
    const token = first.json.accessToken;
    const cookie = first.res.headers.get('set-cookie') ?? '';
    check('cookie de renouvellement : HttpOnly, Secure, SameSite=Lax, chemin /v1/auth', /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\/v1\/auth/i.test(cookie));
    if (adminBase) check('cookies du panel distincts de ceux du site (b2c_admin_refresh, jamais b2c_refresh)', /b2c_admin_refresh=/.test(cookie) && !/(^|, )b2c_refresh=/.test(cookie), cookie.split(';')[0].split('=')[0]);
    const blocked = await call('/v1/admin/users', { headers: { Authorization: `Bearer ${token}` } });
    check('sans second facteur, le compte est enfermé (403 TOTP_ENROLLMENT_REQUIRED)', blocked.status === 403 && blocked.json?.error?.code === 'TOTP_ENROLLMENT_REQUIRED', `${blocked.status} ${blocked.json?.error?.code ?? ''}`);
    const setup = await call('/v1/me/2fa/setup', jsonInit({ password }, token));
    check('activation de la double authentification : clé fournie', setup.status === 200 && !!setup.json?.secret, `${setup.status}`);
    if (setup.status === 200) {
      const enable = await call('/v1/me/2fa/enable', jsonInit({ code: totp(setup.json.secret, stepNow()) }, token));
      check('code TOTP calculé accepté, 10 codes de secours remis', enable.status === 200 && enable.json?.recoveryCodes?.length === 10, `${enable.status}`);
      const again = await login();
      check('connexion avec le mot de passe seul : TOTP_REQUIRED', again.status === 401 && again.json?.error?.code === 'TOTP_REQUIRED');
      const replay = await login({ totpCode: totp(setup.json.secret, stepNow()) });
      check('code déjà utilisé (rejeu) refusé', replay.status === 401 && replay.json?.error?.code === 'INVALID_TOTP', `${replay.status}`);
      const next = await login({ totpCode: totp(setup.json.secret, stepNow() + 1) });
      check('code du pas suivant accepté', next.status === 200, `${next.status}`);
      const admin = await call('/v1/admin/users', { headers: { Authorization: `Bearer ${next.json?.accessToken}` } });
      check('avec le second facteur, l\'administration est ouverte (200)', admin.status === 200, `${admin.status}`);
      const slug = process.env.SMOKE_COMPANY_SLUG;
      if (slug) {
        const created = await call('/v1/platform/companies', jsonInit({
          name: 'Entreprise de contrôle', slug, trackingPrefix: 'XX', customerCodePrefix: 'XX',
          adminEmail: `admin@${slug}.example.com`, adminFirstName: 'Contrôle', adminLastName: 'Fumée',
        }, next.json?.accessToken, { 'X-Forwarded-For': ip() }));
        check('création d\'une entreprise par la plateforme', created.status === 201, `${created.status} ${created.json?.error?.code ?? ''}`);
      }
    }
  } else if (first.json?.error?.code === 'TOTP_REQUIRED') {
    console.log('  (le compte a déjà la double authentification : contrôles du second facteur ignorés)');
  } else {
    check('connexion du compte de la plateforme', false, `${first.status} ${first.json?.error?.code ?? ''}`);
  }
}

console.log(failures === 0 ? '\nTous les contrôles de fumée sont réussis.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
