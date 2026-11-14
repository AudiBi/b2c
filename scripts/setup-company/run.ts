/**
 * Mise en place des données réelles d'une entreprise (voir setup.ts).
 *
 *   SETUP_ADMIN_EMAIL=... SETUP_ADMIN_PASSWORD=... npx tsx scripts/setup-company/run.ts --company audi13
 *
 * Variables : API_URL (défaut http://localhost:3100), SETUP_ADMIN_EMAIL et SETUP_ADMIN_PASSWORD (administrateur de l'entreprise,
 * double authentification non exigée pour cette opération ou REQUIRE_STAFF_2FA=false en local).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSetup, type Call } from '@b2c/shared';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const api = (process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3100}`).replace(/\/$/, '');
  const slug = arg('company');
  const email = process.env.SETUP_ADMIN_EMAIL;
  const password = process.env.SETUP_ADMIN_PASSWORD;
  if (!slug || !email || !password) throw new Error('--company, SETUP_ADMIN_EMAIL et SETUP_ADMIN_PASSWORD sont obligatoires');

  const raw = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  };
  const login = await raw('POST', '/v1/auth/login', { companySlug: slug, email, password });
  if (login.status !== 200 || !login.body.accessToken) throw new Error(`Connexion refusée (${login.status}) : ${JSON.stringify(login.body.error ?? login.body)}`);
  const token = login.body.accessToken as string;
  const call: Call = (method, path, body) => raw(method, path, body, token);

  console.log(`Mise en place de « ${slug} » sur ${api}`);
  const result = await runSetup(call, { validFrom: new Date().toISOString().slice(0, 10), log: (line) => console.log(line) });
  console.log(`\nTerminé : ${result.created.length} élément(s) créé(s), ${result.kept.length} déjà présent(s).`);
}

main().catch((e) => {
  console.error(`\nÉCHEC : ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
