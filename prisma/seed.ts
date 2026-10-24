/**
 * Amorçage minimal et idempotent (sans donnée de démonstration) :
 *  - synchronise permissions, rôles système et leurs permissions avec le code ;
 *  - crée le compte super administrateur si SEED_SUPERADMIN_EMAIL et SEED_SUPERADMIN_PASSWORD sont définis.
 * S'exécute avec le rôle de migration (DIRECT_URL). Usage : npm run db:seed
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PLATFORM_COMPANY_ID, emailSchema, passwordSchema } from '@b2c/shared';
import { syncAccessCatalog } from '../apps/api/src/iam/catalog-sync';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error('DIRECT_URL manquant (voir .env.example)');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const synced = await syncAccessCatalog(prisma);
    console.log(`Catalogue synchronisé : ${synced.permissions} permissions, ${synced.roles} rôles.`);

    const email = process.env.SEED_SUPERADMIN_EMAIL?.trim();
    const password = process.env.SEED_SUPERADMIN_PASSWORD;
    if (!email || !password) {
      console.log('Super administrateur non créé (SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD vides).');
      return;
    }
    const parsedEmail = emailSchema.parse(email);
    passwordSchema.parse(password);

    const existing = await prisma.user.findUnique({
      where: { companyId_email: { companyId: PLATFORM_COMPANY_ID, email: parsedEmail } },
    });
    if (existing) {
      console.log('Le super administrateur existe déjà : aucun changement (mot de passe non modifié).');
      return;
    }
    const role = await prisma.role.findUniqueOrThrow({
      where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: 'SUPER_ADMIN' } },
    });
    const memoryCost = Number(process.env.ARGON2_MEMORY_KIB ?? 65536);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost, timeCost: 3, parallelism: 1 });
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId: PLATFORM_COMPANY_ID,
          kind: 'PLATFORM',
          email: parsedEmail,
          firstName: 'Super',
          lastName: 'Administrateur',
          passwordHash,
          passwordChangedAt: new Date(),
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      await tx.userRole.create({
        data: { companyId: PLATFORM_COMPANY_ID, userId: user.id, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY' },
      });
      await tx.auditLog.create({
        data: {
          companyId: PLATFORM_COMPANY_ID,
          actorType: 'SYSTEM',
          action: 'seed.super_admin_created',
          entityType: 'user',
          entityId: user.id,
        },
      });
    });
    console.log('Super administrateur créé.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
