import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Prépare l'environnement des tests : lit .env, puis bascule sur la base de TEST (jamais la base de développement),
 * la base Redis n° 1, l'envoi d'e-mails en mémoire et un coût argon2 réduit.
 */
export function loadTestEnv(): void {
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  for (const name of ['TEST_DATABASE_URL', 'TEST_DIRECT_URL', 'REDIS_URL', 'JWT_ACCESS_SECRET']) {
    if (!process.env[name]) {
      throw new Error(`Variable ${name} absente : lancer « npm run setup:env » puis « npm run docker:up » avant les tests.`);
    }
  }
  const redisBase = process.env.REDIS_URL!.replace(/\/\d+$/, '');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    DIRECT_URL: process.env.TEST_DIRECT_URL,
    REDIS_URL: `${redisBase}/1`,
    MAIL_TRANSPORT: 'memory',
    LOG_LEVEL: 'silent',
    ARGON2_MEMORY_KIB: '4096',
    ENABLE_DOCS: 'false',
    // Autorise les tests à simuler des adresses IP distinctes avec X-Forwarded-For
    TRUST_PROXY: 'true',
    COOKIE_SECURE: 'false',
  });
}
