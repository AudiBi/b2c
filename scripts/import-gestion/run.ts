/**
 * Import des données de l'outil de gestion (prototype HTML) dans la plateforme.
 *
 *   Simulation (par défaut, n'écrit rien) :
 *     npx tsx scripts/import-gestion/run.ts --file export.json
 *   Import réel dans une entreprise VIDE de colis :
 *     IMPORT_DATABASE_URL=postgresql://b2c_migrator:...@localhost:5442/b2c_dev \
 *     npx tsx scripts/import-gestion/run.ts --file export.json --company audi13 --warehouse MIA1 --apply
 *
 * L'export est le contenu JSON de la clé `b2c_db_v1` du navigateur (ou le fichier de sauvegarde de l'outil).
 * L'import réel écrit directement en base avec le rôle propriétaire (il contourne la RLS) : il vise une base de démarrage,
 * jamais une base en service. Utilisateurs et PIN ne sont JAMAIS importés ; les paiements et factures historiques non plus
 * (les factures sont immuables) : le rapport donne les soldes ouverts à réémettre.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { NO_ACCESS_EMAIL_DOMAIN, PLATFORM_COMPANY_ID, generateTrackingNumber } from '@b2c/shared';
import { buildPlan, renderReport, type RawDb } from './mapping';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const file = arg('file');
  if (!file) throw new Error('--file <export.json> est obligatoire');
  let raw = JSON.parse(readFileSync(file, 'utf8')) as RawDb | { db?: RawDb };
  if ('db' in raw && raw.db) raw = raw.db;
  const plan = buildPlan(raw as RawDb, new Date(), { estimateMissingMeasures: flag('estimer-mesures') });
  const report = renderReport(plan);
  console.log(report);
  const out = arg('report');
  if (out) writeFileSync(out, report, 'utf8');

  if (!flag('apply')) {
    console.log("\nSimulation terminée. Ajoutez --apply (avec --company et --warehouse) pour écrire.");
    return;
  }
  const slug = arg('company');
  const warehouseRef = arg('warehouse');
  const url = process.env.IMPORT_DATABASE_URL;
  if (!slug || !warehouseRef) throw new Error('--company et --warehouse sont obligatoires avec --apply');
  if (!url) throw new Error("IMPORT_DATABASE_URL (rôle propriétaire) est obligatoire avec --apply");

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const company = await prisma.company.findFirst({ where: { slug } });
    if (!company || company.id === PLATFORM_COMPANY_ID) throw new Error(`Entreprise « ${slug} » introuvable`);
    const warehouse = await prisma.warehouse.findFirst({ where: { companyId: company.id, reference: warehouseRef } });
    if (!warehouse) throw new Error(`Entrepôt « ${warehouseRef} » introuvable`);
    if ((await prisma.package.count({ where: { companyId: company.id } })) > 0 && !flag('force')) {
      throw new Error("L'entreprise contient déjà des colis : l'import vise une base de démarrage (--force pour l'imposer)");
    }
    const roles = await prisma.role.findMany({ where: { companyId: PLATFORM_COMPANY_ID, code: 'CUSTOMER_INDIVIDUAL' } });
    if (roles.length === 0) throw new Error('Rôles système absents : exécuter npm run db:seed');
    const role = roles[0];

    const result = await prisma.$transaction(
      async (tx) => {
        const customerByLegacy = new Map<number, { id: string; code: string }>();
        for (const c of plan.customers) {
          const counter = await tx.counter.upsert({
            where: { companyId_name_year: { companyId: company.id, name: 'customer-code', year: 0 } },
            create: { companyId: company.id, name: 'customer-code', year: 0, value: 1 },
            update: { value: { increment: 1 } },
          });
          const code = `${company.customerCodePrefix ?? 'CL'}-${String(counter.value).padStart(6, '0')}`;
          const user = await tx.user.create({
            data: {
              companyId: company.id,
              kind: 'CUSTOMER',
              email: c.email && !(await tx.user.findFirst({ where: { companyId: company.id, email: c.email } })) ? c.email : `${randomUUID()}@${NO_ACCESS_EMAIL_DOMAIN}`,
              phone: c.phone,
              firstName: c.firstName,
              lastName: c.lastName,
              status: 'PENDING',
              createdAt: c.createdAt,
            },
          });
          await tx.userRole.create({ data: { companyId: company.id, userId: user.id, roleId: role.id, scopeType: 'COMPANY', scopeKey: 'COMPANY' } });
          const customer = await tx.customer.create({
            data: { companyId: company.id, userId: user.id, customerType: 'INDIVIDUAL', customerCode: code, createdAt: c.createdAt },
          });
          customerByLegacy.set(c.legacyId, { id: customer.id, code });
        }

        let packages = 0;
        for (const p of plan.packages) {
          const customer = customerByLegacy.get(p.customerLegacyId);
          if (!customer) continue;
          let trackingNumber = '';
          for (let attempt = 0; attempt < 8 && !trackingNumber; attempt += 1) {
            const candidate = generateTrackingNumber(company.trackingPrefix ?? 'TK', randomInt);
            if (!(await tx.package.findUnique({ where: { trackingNumber: candidate }, select: { id: true } }))) trackingNumber = candidate;
          }
          if (!trackingNumber) throw new Error("Numéro de suivi unique introuvable");
          const created = await tx.package.create({
            data: {
              companyId: company.id,
              trackingNumber,
              legacyTrackingNumber: p.legacyCode,
              customerId: customer.id,
              recipientName: p.recipientName,
              recipientPhone: p.recipientPhone,
              recipientCity: p.recipientCity,
              originWarehouseId: warehouse.id,
              originCountry: warehouse.country,
              originCity: warehouse.city,
              destinationCountry: 'HT',
              destinationCity: p.recipientCity,
              transportMode: p.mode,
              supplierTracking: p.supplierTracking,
              contentDescription: p.description,
              status: p.status,
              actualWeightKg: p.weightKg,
              lengthCm: p.dimsCm?.length,
              widthCm: p.dimsCm?.width,
              heightCm: p.dimsCm?.height,
              receivedAt: p.createdAt,
              createdAtCounter: true,
              createdAt: p.createdAt,
            },
          });
          await tx.packageEvent.create({
            data: {
              companyId: company.id,
              packageId: created.id,
              fromStatus: null,
              toStatus: p.status,
              eventType: 'IMPORTED',
              visibility: 'PRIVATE',
              reason: `Import de l'outil de gestion (${p.legacyCode})`,
              data: { legacyCode: p.legacyCode, balanceDue: p.balanceDue, measuresEstimated: p.measuresEstimated },
              occurredAt: p.createdAt,
            },
          });
          packages += 1;
        }
        await tx.auditLog.create({
          data: {
            companyId: company.id,
            actorType: 'SYSTEM',
            action: 'import.gestion',
            entityType: 'company',
            entityId: company.id,
            after: { customers: customerByLegacy.size, packages, issues: plan.issues.length },
          },
        });
        return { customers: customerByLegacy.size, packages };
      },
      { timeout: 300_000 },
    );
    console.log(`\nImport terminé : ${result.customers} client(s), ${result.packages} colis.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\nÉCHEC : ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
