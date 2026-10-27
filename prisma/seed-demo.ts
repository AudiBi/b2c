/**
 * Données de DÉMONSTRATION (jamais en production) : une entreprise « demo » avec un compte par rôle.
 * Tout est étiqueté DEMO (nom de l'entreprise, prénoms) et utilise des adresses en @demo.invalid.
 * Le mot de passe commun vient de DEMO_PASSWORD : aucun mot de passe n'est écrit dans le dépôt.
 * Un entrepôt, une catégorie et une grille tarifaire FICTIFS sont ajoutés pour que le calculateur et les préalertes fonctionnent en démonstration.
 * Les rôles liés à un entrepôt ou une agence restent ignorés (portée par entrepôt : création par l'administrateur).
 * Usage : DEMO_PASSWORD=... npm run db:seed:demo
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PLATFORM_COMPANY_ID, ROLE_DEFINITIONS, passwordSchema } from '@b2c/shared';
import { syncAccessCatalog } from '../apps/api/src/iam/catalog-sync';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refus : les données DEMO ne se chargent pas en production.');
  const url = process.env.DIRECT_URL;
  const password = process.env.DEMO_PASSWORD;
  if (!url) throw new Error('DIRECT_URL manquant (voir .env.example)');
  if (!password) throw new Error('DEMO_PASSWORD manquant : définir un mot de passe pour les comptes de démonstration.');
  passwordSchema.parse(password);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await syncAccessCatalog(prisma);
    const memoryCost = Number(process.env.ARGON2_MEMORY_KIB ?? 65536);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost, timeCost: 3, parallelism: 1 });

    const company = await prisma.company.upsert({
      where: { slug: 'demo' },
      update: {},
      create: {
        name: 'DEMO : entreprise de démonstration',
        slug: 'demo',
        trackingPrefix: 'DM',
        customerCodePrefix: 'DM',
        defaultCurrency: 'USD',
        defaultLocale: 'fr',
      },
    });

    let created = 0;
    const skipped: string[] = [];
    for (const definition of ROLE_DEFINITIONS) {
      if (definition.audience === 'PLATFORM') continue;
      if (!definition.allowedScopes.includes('COMPANY')) {
        skipped.push(definition.code);
        continue;
      }
      const email = `${definition.code.toLowerCase().replace(/_/g, '-')}@demo.invalid`;
      const exists = await prisma.user.findUnique({ where: { companyId_email: { companyId: company.id, email } } });
      if (exists) continue;
      const role = await prisma.role.findUniqueOrThrow({
        where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: definition.code } },
      });
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            companyId: company.id,
            kind: definition.audience === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
            email,
            firstName: 'DEMO',
            lastName: definition.name,
            passwordHash,
            passwordChangedAt: new Date(),
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          },
        });
        await tx.userRole.create({
          data: { companyId: company.id, userId: user.id, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY' },
        });
      });
      created += 1;
    }
    // Entrepôt, catégorie et grille de DÉMONSTRATION. Toutes les valeurs sont fictives (étiquetées DEMO) :
    // l'entreprise réelle publie ses propres tarifs, jamais ceux-ci.
    await prisma.warehouse.upsert({
      where: { companyId_reference: { companyId: company.id, reference: 'DEMO-MIA' } },
      update: {},
      create: {
        companyId: company.id,
        reference: 'DEMO-MIA',
        name: 'DEMO : entrepôt fictif',
        country: 'US',
        city: 'Miami',
        addressLine: 'Adresse fictive : 1 rue de la Démonstration',
        addressTemplate: ['{customerName}', '{customerCode} {mode}', 'Adresse fictive : 1 rue de la Démonstration', 'Miami (DEMO)'],
      },
    });
    await prisma.packageCategory.upsert({
      where: { companyId_code: { companyId: company.id, code: 'DEMO_GENERAL' } },
      update: {},
      create: { companyId: company.id, code: 'DEMO_GENERAL', name: { fr: 'DEMO : marchandise générale', ht: 'DEMO : machandiz jeneral', en: 'DEMO: general goods' } },
    });
    const activeCard = await prisma.rateCard.findFirst({
      where: { companyId: company.id, status: 'ACTIVE', transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT' },
    });
    if (!activeCard) {
      const card = await prisma.rateCard.create({
        data: {
          companyId: company.id,
          name: 'DEMO : grille fictive (ne reflète aucun tarif réel)',
          transportMode: 'AIR',
          originCountry: 'US',
          destinationCountry: 'HT',
          currency: 'USD',
          weightUnit: 'KG',
          dimensionUnit: 'CM',
          volumetricDivisor: 5000,
          minBillableWeight: 0.5,
          roundingMode: 'UP',
          roundingStep: 0.5,
          validFrom: new Date('2020-01-01'),
        },
      });
      await prisma.rateRule.createMany({
        data: [
          { companyId: company.id, rateCardId: card.id, weightFrom: 0, weightTo: 5, pricePerUnit: 4, minCharge: 3 },
          { companyId: company.id, rateCardId: card.id, weightFrom: 5, pricePerUnit: 3.5 },
        ],
      });
      await prisma.rateSurcharge.createMany({
        data: [
          { companyId: company.id, rateCardId: card.id, code: 'HANDLING', name: { fr: 'DEMO : manutention', ht: 'DEMO : manitansyon', en: 'DEMO: handling' }, kind: 'SURCHARGE', method: 'FLAT', value: 1.5 },
          { companyId: company.id, rateCardId: card.id, code: 'INSURANCE', name: { fr: 'DEMO : assurance', ht: 'DEMO : asirans', en: 'DEMO: insurance' }, kind: 'INSURANCE', method: 'PERCENT_OF_DECLARED_VALUE', value: 2, optional: true },
        ],
      });
      await prisma.rateCard.update({ where: { id: card.id }, data: { status: 'ACTIVE' } });
    }

    console.log(`Entreprise « demo » prête ; ${created} compte(s) de démonstration créé(s).`);
    if (skipped.length > 0) console.log(`Rôles ignorés (portée entrepôt/agence, phase 6) : ${skipped.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
