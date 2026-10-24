import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { PLATFORM_COMPANY_ID } from '@b2c/shared';
import { syncAccessCatalog } from '../src/iam/catalog-sync';
import { loadTestEnv } from './load-test-env';

/**
 * Avant chaque exécution : migrations appliquées à la base de TEST (prisma migrate deploy), données des
 * tests précédents effacées, catalogue des rôles synchronisé, Redis (base 1) vidé.
 *
 * Le nettoyage ne touche que des bases dont le nom se termine par « _test ». Il ne passe pas par
 * `prisma migrate reset` (commande destructive que Prisma refuse de lancer sans accord humain explicite).
 */
export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  const directUrl = process.env.TEST_DIRECT_URL!;
  const databaseName = new URL(directUrl).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refus de nettoyer la base « ${databaseName} » : seules les bases *_test sont autorisées.`);
  }

  const root = resolve(__dirname, '../../..');
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', resolve(root, 'prisma/schema.prisma')], {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    // TRUNCATE ne déclenche pas le verrou d'immutabilité du journal d'audit (réservé au propriétaire).
    await prisma.$executeRawUnsafe(
      `TRUNCATE sessions, verification_tokens, user_roles, users, audit_log, idempotency_keys, counters, company_settings`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM role_permissions WHERE company_id <> '${PLATFORM_COMPANY_ID}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM roles WHERE company_id <> '${PLATFORM_COMPANY_ID}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM companies WHERE id <> '${PLATFORM_COMPANY_ID}'`);
    await syncAccessCatalog(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const redis = new Redis(process.env.REDIS_URL!);
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
