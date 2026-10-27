import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, defineConfig, devices } from '@playwright/test';

// Recette navigateur : API compilée + site pré-rendu, sur la base de TEST (jamais celle de développement).
const envFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
for (const name of ['TEST_DATABASE_URL', 'TEST_DIRECT_URL', 'REDIS_URL', 'JWT_ACCESS_SECRET']) {
  if (!process.env[name]) throw new Error(`Variable ${name} absente : lancer « npm run setup:env » puis « npm run docker:up ».`);
}
// Administrateur de recette : mot de passe généré à chaque exécution (hérité par les processus de test)
process.env.E2E_ADMIN_EMAIL ??= 'admin@e2e.example';
process.env.E2E_ADMIN_PASSWORD ??= `E2e-${randomBytes(12).toString('hex')}`;

// Navigateur : Chromium de Playwright s'il est installé, sinon Microsoft Edge (E2E_CHANNEL=chrome|msedge pour forcer)
const bundledChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
const channel = process.env.E2E_CHANNEL ?? (bundledChromium ? undefined : 'msedge');

export const API_PORT = 3101;
export const WEB_PORT = 4173;
export const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? 8035}`;

const redisBase = process.env.REDIS_URL!.replace(/\/\d+$/, '');
const apiEnv = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: process.env.TEST_DATABASE_URL!,
  REDIS_URL: `${redisBase}/2`,
  API_PORT: String(API_PORT),
  WEB_PUBLIC_URL: `http://localhost:${WEB_PORT}`,
  CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: '127.0.0.1',
  TRUST_PROXY: 'true', // le test fixe X-Forwarded-For pour que les limites par IP ne s'accumulent pas
  ARGON2_MEMORY_KIB: '4096',
  LOG_LEVEL: 'warn',
  ENABLE_DOCS: 'false',
  COOKIE_SECURE: 'false',
  FILES_DIR: join(tmpdir(), 'b2c-e2e-files'), // jamais le dossier de développement
};

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: channel ?? 'chromium', use: { ...devices['Desktop Chrome'], channel } }],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      cwd: import.meta.dirname,
      url: `http://localhost:${API_PORT}/health/live`,
      env: apiEnv as Record<string, string>,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node scripts/serve-dist.mjs',
      cwd: import.meta.dirname,
      url: `http://localhost:${WEB_PORT}/fr/`,
      env: { ...process.env, PORT: String(WEB_PORT), API_URL: `http://localhost:${API_PORT}` } as Record<string, string>,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
