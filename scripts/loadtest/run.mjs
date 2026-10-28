// Test de charge du suivi public et du calculateur (phase 9).
//   npm run loadtest            (Docker doit tourner : npm run docker:up)
//
// Ce que fait le script, sur la base de TEST uniquement (jamais celle de développement) :
//   1. prépare l'entreprise « e2e » (grille tarifaire de recette) et y insère un volume réaliste de colis
//      (LOAD_PACKAGES, 20 000 par défaut) avec leur historique ;
//   2. démarre l'API compilée (Redis base 3, TRUST_PROXY pour varier les adresses IP) ;
//   3. mesure avec autocannon : suivi d'un numéro connu, suivi d'un numéro inconnu, calculateur ;
//   4. vérifie que la limite de débit tient quand UNE seule adresse insiste ;
//   5. écrit les résultats bruts dans loadtest-results.json (non versionné) et un résumé à l'écran.
// Le générateur de charge et le serveur tournent sur la MÊME machine : les chiffres sont une mesure locale, pas une garantie.
import { spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { generateTrackingNumber } = require('@b2c/shared');

const PORT = 3102;
const PACKAGES = Number(process.env.LOAD_PACKAGES ?? 20_000);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 50);
const DURATION = Number(process.env.LOAD_DURATION ?? 20);

for (const name of ['TEST_DATABASE_URL', 'TEST_DIRECT_URL', 'REDIS_URL', 'JWT_ACCESS_SECRET']) {
  if (!process.env[name]) throw new Error(`Variable ${name} absente : lancer « npm run setup:env » puis « npm run docker:up ».`);
}
const database = new URL(process.env.TEST_DIRECT_URL).pathname.replace(/^\//, '');
if (!database.endsWith('_test')) throw new Error(`Refus : la base « ${database} » n'est pas une base de test.`);

// 1. Données --------------------------------------------------------------------------------------------------------
const { prepare } = await import('../../apps/web/e2e/prepare.mjs');
const { companyId } = await prepare();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DIRECT_URL } } });
const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { companyId, reference: 'MIA1' } });
// Un client de charge (les colis avancés doivent avoir un client, des mesures : règles de la base)
let loadCustomer = await prisma.customer.findFirst({ where: { companyId, customerCode: 'EE-999999' } });
if (!loadCustomer) {
  const user = await prisma.user.create({ data: { companyId, kind: 'CUSTOMER', email: `charge-${Date.now()}@example.test`, firstName: 'Charge', lastName: 'Test', status: 'DISABLED' } });
  loadCustomer = await prisma.customer.create({ data: { companyId, userId: user.id, customerType: 'INDIVIDUAL', customerCode: 'EE-999999' } });
}
const existing = await prisma.package.count({ where: { companyId, supplierTracking: { startsWith: 'LOADTEST' } } });
const known = [];
if (existing < PACKAGES) {
  console.log(`Insertion de ${PACKAGES - existing} colis (historique de 3 étapes chacun)…`);
  const BATCH = 1000;
  for (let done = existing; done < PACKAGES; done += BATCH) {
    const size = Math.min(BATCH, PACKAGES - done);
    const rows = Array.from({ length: size }, (_, i) => ({ id: crypto.randomUUID(), trackingNumber: generateTrackingNumber('EE', (n) => randomInt(n)), index: done + i }));
    await prisma.$transaction(
      async (tx) => {
        await tx.package.createMany({
          data: rows.map((r) => ({
            id: r.id,
            companyId,
            trackingNumber: r.trackingNumber,
            originWarehouseId: warehouse.id,
            originCountry: 'US',
            originCity: 'Miami',
            destinationCountry: 'HT',
            transportMode: 'AIR',
            supplierTracking: `LOADTEST${r.index}`,
            customerId: loadCustomer.id,
            actualWeightKg: 2,
            lengthCm: 30,
            widthCm: 20,
            heightCm: 10,
            status: 'IN_TRANSIT',
          })),
        });
        const now = Date.now();
        const steps = ['RECEIVED_AT_WAREHOUSE', 'READY_TO_SHIP', 'IN_TRANSIT'];
        await tx.packageEvent.createMany({
          data: rows.flatMap((r) =>
            steps.map((status, k) => ({ companyId, packageId: r.id, toStatus: status, eventType: 'STATUS_CHANGE', visibility: 'PUBLIC', locationLabel: 'Miami', occurredAt: new Date(now - (3 - k) * 3_600_000) })),
          ),
        });
      },
      { timeout: 60_000 },
    );
  }
}
const sample = await prisma.package.findMany({ where: { companyId, supplierTracking: { startsWith: 'LOADTEST' } }, select: { trackingNumber: true }, take: 2000 });
for (const p of sample) known.push(p.trackingNumber);
const total = await prisma.package.count({ where: { companyId } });
const eventsTotal = await prisma.packageEvent.count({ where: { companyId } });
await prisma.$disconnect();
console.log(`Base de test : ${total} colis, ${eventsTotal} événements (entreprise « e2e »).`);

// 2. API ------------------------------------------------------------------------------------------------------------
const redisBase = process.env.REDIS_URL.replace(/\/\d+$/, '');
const api = spawn(process.execPath, [resolve(root, 'apps/api/dist/main.js')], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    REDIS_URL: `${redisBase}/3`,
    API_PORT: String(PORT),
    TRUST_PROXY: 'true',
    LOG_LEVEL: 'error',
    ENABLE_DOCS: 'false',
    COOKIE_SECURE: 'false',
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    ARGON2_MEMORY_KIB: '4096',
    NOTIFICATION_WORKER_INTERVAL_MS: '0',
  },
});
let apiLog = '';
api.stderr.on('data', (d) => (apiLog += d));
api.stdout.on('data', (d) => (apiLog += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(`${base}/health/live`)).ok) break;
  } catch {
    /* pas encore prêt */
  }
  await new Promise((r) => setTimeout(r, 500));
  if (i === 59) throw new Error(`L'API n'a pas démarré :\n${apiLog}`);
}

// Redis : repartir de compteurs vides
const { default: Redis } = await import('ioredis').catch(() => ({ default: null }));
if (Redis) {
  const redis = new Redis(`${redisBase}/3`);
  await redis.flushdb();
  redis.disconnect();
}

const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`;
const pick = () => known[randomInt(known.length)];
const unknownNumber = () => generateTrackingNumber('EE', (n) => randomInt(n));
const quoteBody = JSON.stringify({ transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 2.5, unit: 'KG' }, dimensions: { length: 40, width: 30, height: 20, unit: 'CM' }, declaredValue: 120, optionalSurcharges: ['INSURANCE'] });

async function scenario(title, requests, options = {}) {
  console.log(`\n▶ ${title}`);
  const result = await autocannon({ url: base, connections: CONNECTIONS, duration: DURATION, ...options, requests });
  const statuses = { '2xx': result['2xx'], '3xx': result['3xx'], '4xx': result['4xx'], '5xx': result['5xx'] };
  const row = {
    title,
    requestsPerSecond: Math.round(result.requests.average),
    total: result.requests.total,
    latencyMs: { mean: result.latency.average, p50: result.latency.p50, p90: result.latency.p90, p97_5: result.latency.p97_5, p99: result.latency.p99, max: result.latency.max },
    statuses,
    errors: result.errors,
    timeouts: result.timeouts,
  };
  console.log(`  ${row.requestsPerSecond} req/s · latence p50 ${row.latencyMs.p50} ms, p97,5 ${row.latencyMs.p97_5} ms, p99 ${row.latencyMs.p99} ms, max ${row.latencyMs.max} ms · ${JSON.stringify(statuses)} · erreurs ${row.errors}, délais dépassés ${row.timeouts}`);
  return row;
}

const results = [];
try {
  // Références pour situer le coût : le cadre seul (aucune base), puis le suivi sans concurrence
  results.push(await scenario('Référence : /health/live (aucune requête SQL)', [{ method: 'GET', path: '/health/live', setupRequest: (req) => ({ ...req, headers: { ...req.headers, 'x-forwarded-for': fakeIp() } }) }], { duration: 8 }));
  results.push(
    await scenario(
      "Référence : suivi d'un numéro connu, une seule connexion (latence sans file d'attente)",
      [{ method: 'GET', setupRequest: (req) => ({ ...req, path: `/v1/public/tracking/${pick()}`, headers: { ...req.headers, 'x-forwarded-for': fakeIp() } }) }],
      { connections: 1, duration: 8 },
    ),
  );
  results.push(
    await scenario('Suivi : numéro connu (adresses IP variées, sous la limite de débit)', [
      { method: 'GET', setupRequest: (req) => ({ ...req, path: `/v1/public/tracking/${pick()}`, headers: { ...req.headers, 'x-forwarded-for': fakeIp() } }) },
    ]),
  );
  results.push(
    await scenario('Suivi : numéro inconnu (même réponse 404, même coût)', [
      { method: 'GET', setupRequest: (req) => ({ ...req, path: `/v1/public/tracking/${unknownNumber()}`, headers: { ...req.headers, 'x-forwarded-for': fakeIp() } }) },
    ]),
  );
  results.push(
    await scenario('Calculateur : estimation avec assurance', [
      { method: 'POST', path: '/v1/public/companies/e2e/quote', body: quoteBody, setupRequest: (req) => ({ ...req, headers: { ...req.headers, 'content-type': 'application/json', 'x-forwarded-for': fakeIp() } }) },
    ]),
  );
  // Une seule adresse insiste : la limite (30/min pour le suivi) doit tenir, sans erreur serveur
  const single = await scenario(
    'Limite de débit : UNE adresse insiste sur le suivi (30 par minute attendus)',
    [{ method: 'GET', setupRequest: (req) => ({ ...req, path: `/v1/public/tracking/${pick()}`, headers: { ...req.headers, 'x-forwarded-for': '10.99.99.99' } }) }],
    { connections: 10, duration: 8 },
  );
  results.push(single);
} finally {
  api.kill();
}

const summary = {
  when: new Date().toISOString(),
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, node: process.version },
  conditions: { packages: total, events: eventsTotal, connections: CONNECTIONS, durationSeconds: DURATION, note: 'générateur de charge et serveur sur la même machine ; PostgreSQL et Redis dans Docker' },
  results,
};
writeFileSync(resolve(root, 'loadtest-results.json'), JSON.stringify(summary, null, 2));
console.log('\nRésultats bruts : loadtest-results.json');
const ratelimit = results.at(-1);
console.log(`Limite de débit : ${ratelimit.statuses['2xx']} réponses 2xx, ${ratelimit.statuses['4xx']} refus 4xx, ${ratelimit.statuses['5xx']} erreurs serveur (attendu : ~30 réponses 2xx, aucune 5xx)`);
// 30 autorisées par minute ; une fenêtre qui se renouvelle pendant les 8 s de mesure peut en laisser passer un peu plus
if (ratelimit.statuses['5xx'] > 0 || ratelimit.statuses['2xx'] > 40 || ratelimit.statuses['4xx'] === 0) process.exitCode = 1;
