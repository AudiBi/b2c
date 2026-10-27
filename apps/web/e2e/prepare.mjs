// Prépare la base de TEST pour la recette navigateur : entreprise « e2e », un entrepôt, un administrateur.
// Idempotent. N'agit que sur une base dont le nom finit par « _test ». Les identifiants de l'administrateur
// viennent de l'environnement (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD) ; rien n'est écrit en dur.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

export const E2E = { slug: 'e2e', platformCompanyId: '00000000-0000-7000-8000-000000000001' };

export async function prepare() {
  const directUrl = process.env.TEST_DIRECT_URL;
  if (!directUrl) throw new Error('TEST_DIRECT_URL absent : lancer npm run setup:env et npm run docker:up');
  const database = new URL(directUrl).pathname.replace(/^\//, '');
  if (!database.endsWith('_test')) throw new Error(`Refus : la base « ${database} » n'est pas une base de test.`);

  // Migrations à jour (commande non destructive)
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(root, 'prisma/schema.prisma')], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, DIRECT_URL: directUrl },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    // Catalogue des rôles (permissions et rôles système)
    const { PERMISSIONS, ROLE_DEFINITIONS } = require('@b2c/shared');
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
    }
    for (const def of ROLE_DEFINITIONS) {
      const role = await prisma.role.upsert({
        where: { companyId_code: { companyId: E2E.platformCompanyId, code: def.code } },
        update: { name: def.name, description: def.description, isSystem: true },
        create: { companyId: E2E.platformCompanyId, code: def.code, name: def.name, description: def.description, isSystem: true },
      });
      const have = new Set((await prisma.rolePermission.findMany({ where: { roleId: role.id } })).map((r) => r.permissionCode));
      const missing = def.permissions.filter((p) => !have.has(p));
      if (missing.length) {
        await prisma.rolePermission.createMany({ data: missing.map((permissionCode) => ({ roleId: role.id, permissionCode, companyId: E2E.platformCompanyId })) });
      }
    }

    const company = await prisma.company.upsert({
      where: { slug: E2E.slug },
      update: { status: 'ACTIVE' },
      create: { name: 'E2E : entreprise de recette', slug: E2E.slug, trackingPrefix: 'EE', customerCodePrefix: 'EE', defaultLocale: 'fr' },
    });

    const warehouse = await prisma.warehouse.findUnique({ where: { companyId_reference: { companyId: company.id, reference: 'MIA1' } } });
    if (!warehouse) {
      await prisma.warehouse.create({
        data: {
          companyId: company.id,
          reference: 'MIA1',
          name: 'Entrepôt de recette',
          country: 'US',
          city: 'Miami',
          addressLine: '100 Test Avenue, Miami, FL 33100',
          addressTemplate: ['{customerName}', '{customerCode} {mode}', '100 Test Avenue', 'Miami, FL 33100', 'USA'],
        },
      });
    }

    const email = process.env.E2E_ADMIN_EMAIL;
    const password = process.env.E2E_ADMIN_PASSWORD;
    if (email && password) {
      const exists = await prisma.user.findUnique({ where: { companyId_email: { companyId: company.id, email } } });
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 4096, timeCost: 3, parallelism: 1 });
      if (exists) {
        // Le mot de passe de recette change à chaque exécution
        await prisma.user.update({ where: { id: exists.id }, data: { passwordHash, status: 'ACTIVE' } });
      } else {
        const role = await prisma.role.findUniqueOrThrow({ where: { companyId_code: { companyId: E2E.platformCompanyId, code: 'COMPANY_ADMIN' } } });
        const user = await prisma.user.create({
          data: { companyId: company.id, kind: 'STAFF', email, firstName: 'Admin', lastName: 'Recette', passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
        });
        await prisma.userRole.create({ data: { companyId: company.id, userId: user.id, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY' } });
      }
    }
    return { companyId: company.id };
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepare().then(() => console.log('Base de recette prête (entreprise « e2e »).'), (error) => { console.error(error.message); process.exit(1); });
}
