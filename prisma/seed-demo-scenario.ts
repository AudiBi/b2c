/**
 * SCÉNARIO DE DÉMONSTRATION (jamais en production) : charge dans l'entreprise « demo » une petite histoire complète, de la
 * préalerte d'un client à la remise du colis, pour comprendre le fonctionnement du projet en parcourant le panel et le site.
 *
 * Les données ne sont PAS insérées directement en base : le script joue le rôle de chaque personne et appelle l'API réelle, donc
 * toutes les règles s'appliquent (machine d'états des colis, numérotation, facturation, caisse, droits par rôle et par portée).
 * Chaque colis s'arrête à une ÉTAPE DIFFÉRENTE du parcours : on voit tous les écrans avec des données.
 *
 * Prérequis : migrations appliquées, `npm run db:seed:demo` (comptes), API démarrée (`npm start`), REQUIRE_STAFF_2FA=false.
 * Usage      : DEMO_PASSWORD=... npm run db:seed:demo-data        (API_URL, DEMO_COMPANY_SLUG facultatifs)
 * Idempotent : si l'entreprise contient déjà des colis, le script s'arrête sans rien modifier (SEED_FORCE=1 pour l'imposer).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API = (process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3100}`).replace(/\/$/, '');
const SLUG = process.env.DEMO_COMPANY_SLUG ?? 'demo';
const PASSWORD = process.env.DEMO_PASSWORD ?? '';

// ---------------------------------------------------------------------------------------------
// Client HTTP minimal : limite de débit respectée, erreurs lisibles
// ---------------------------------------------------------------------------------------------
let calls = 0;
let windowStart = Date.now();
async function throttle(): Promise<void> {
  calls += 1;
  if (Date.now() - windowStart > 60_000) {
    windowStart = Date.now();
    calls = 1;
  }
  if (calls > 230) {
    const wait = 61_000 - (Date.now() - windowStart);
    console.log(`  … pause de ${Math.ceil(wait / 1000)} s (limite de débit de l'API)`);
    await new Promise((done) => setTimeout(done, Math.max(wait, 1000)));
    windowStart = Date.now();
    calls = 1;
  }
}

type Json = Record<string, any>;
async function call<T = Json>(token: string | null, method: string, path: string, body?: unknown, expected: number[] = [200, 201, 202, 204]): Promise<T> {
  await throttle();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify((data as Json).error ?? data)}`);
  }
  return data;
}

const roleEmail = (role: string) => `${role}@demo.invalid`;
async function login(email: string): Promise<string> {
  const data = await call<{ accessToken: string }>(null, 'POST', '/v1/auth/login', { companySlug: SLUG, email, password: PASSWORD });
  return data.accessToken;
}

const step = (text: string) => console.log(`\n▶ ${text}`);
const note = (text: string) => console.log(`  ${text}`);
const today = () => new Date().toISOString().slice(0, 10);
const stamp = Date.now().toString(36).toUpperCase();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refus : le scénario de démonstration ne se charge pas en production.');
  if (!PASSWORD) throw new Error('DEMO_PASSWORD manquant : le mot de passe des comptes de démonstration (voir npm run db:seed:demo).');
  const health = await fetch(`${API}/health/live`).catch(() => null);
  if (!health?.ok) throw new Error(`API injoignable sur ${API} : la démarrer d'abord (npm start).`);

  // --- Qui sommes-nous ? Une connexion par rôle : chacun ne fait que ce que ses droits permettent -------------
  step('Connexion des comptes de démonstration');
  let admin: string;
  try {
    admin = await login(roleEmail('company-admin'));
  } catch (error) {
    throw new Error(`Connexion impossible avec company-admin@demo.invalid sur l'entreprise « ${SLUG} » : ${(error as Error).message}\n  → lancer d'abord « DEMO_PASSWORD=... npm run db:seed:demo » et utiliser le même mot de passe.`);
  }
  const me = await call(admin, 'GET', '/v1/auth/me');
  if (me.mfa?.required) throw new Error('La double authentification est obligatoire (REQUIRE_STAFF_2FA=true) : le script ne peut pas jouer les comptes du personnel. Mettre REQUIRE_STAFF_2FA=false en développement.');

  const existing = await call(admin, 'GET', '/v1/admin/packages?limit=1');
  if (existing.items?.length > 0 && !process.env.SEED_FORCE) {
    console.log(`\nL'entreprise « ${SLUG} » contient déjà des colis : rien n'est ajouté (SEED_FORCE=1 pour charger le scénario quand même).`);
    return;
  }

  const [reception, warehouseManager, billing, logistics, agencyManager, service, driver, individual, business] = await Promise.all(
    ['reception-agent', 'warehouse-manager', 'billing-agent', 'logistics-manager', 'agency-manager', 'customer-service', 'driver', 'customer-individual', 'customer-business'].map((role) => login(roleEmail(role))),
  );
  note('11 comptes connectés : administrateur, réception, responsable d’entrepôt, facturation, logistique, agence, service client, livreur, 2 clients.');

  // --- 1. Configuration de l'entreprise --------------------------------------------------------------------
  step('1. L’administrateur configure l’entreprise : entrepôts, agences, tarifs, consignes de paiement');
  const warehouses = await call(admin, 'GET', '/v1/admin/warehouses');
  const miami = warehouses.items.find((w: Json) => w.reference === 'DEMO-MIA');
  if (!miami) throw new Error('Entrepôt DEMO-MIA introuvable : lancer npm run db:seed:demo.');
  let newYork = warehouses.items.find((w: Json) => w.reference === 'DEMO-NYC');
  if (!newYork) {
    newYork = await call(admin, 'POST', '/v1/admin/warehouses', {
      reference: 'DEMO-NYC', name: 'DEMO : entrepôt de New York (fictif)', country: 'us', city: 'New York',
      addressLine: 'Adresse fictive : 2 rue de la Démonstration', addressTemplate: ['{customerName}', '{customerCode} {mode}', 'Adresse fictive : 2 rue de la Démonstration', 'New York (DEMO)'],
    });
    note('Entrepôt de New York créé : chaque client reçoit une adresse de réception par entrepôt et par mode.');
  }
  const agencies = await call(admin, 'GET', '/v1/admin/agencies');
  const portAuPrince = agencies.items.find((a: Json) => a.code === 'DEMO-PAP');
  if (!portAuPrince) throw new Error('Agence DEMO-PAP introuvable : lancer npm run db:seed:demo.');
  let capHaitien = agencies.items.find((a: Json) => a.code === 'DEMO-CAP');
  if (!capHaitien) {
    capHaitien = await call(admin, 'POST', '/v1/admin/agencies', {
      code: 'DEMO-CAP', name: 'DEMO : agence du Cap-Haïtien (fictive)', country: 'ht', city: 'Cap-Haïtien',
      addressLine: 'Adresse fictive : 3 rue de la Démonstration', phone: '+50937000000', hours: 'DEMO : lundi au vendredi, 8 h - 16 h',
    });
    note('Seconde agence créée : un lot peut être destiné à l’une ou l’autre.');
  }
  const cards = await call(admin, 'GET', '/v1/admin/rate-cards');
  if (!cards.items.some((c: Json) => c.transportMode === 'SEA' && c.status === 'ACTIVE')) {
    const card = await call(admin, 'POST', '/v1/admin/rate-cards', {
      name: 'DEMO : grille maritime fictive (ne reflète aucun tarif réel)', transportMode: 'SEA', originCountry: 'US', destinationCountry: 'HT', currency: 'USD',
      weightUnit: 'KG', dimensionUnit: 'CM', volumetricDivisor: 5000, minBillableWeight: 1, roundingMode: 'UP', roundingStep: 1, validFrom: '2020-01-01',
      rules: [{ weightFrom: 0, weightTo: 20, pricePerUnit: 1.8, flatFee: 0, minCharge: 6 }, { weightFrom: 20, pricePerUnit: 1.4, flatFee: 0, minCharge: 0 }],
      surcharges: [{ code: 'HANDLING', name: { fr: 'DEMO : manutention', ht: 'DEMO : manitansyon', en: 'DEMO: handling' }, kind: 'SURCHARGE', method: 'FLAT', value: 2, optional: false }],
    });
    await call(admin, 'POST', `/v1/admin/rate-cards/${card.id}/activate`);
    note('Grille maritime ajoutée à la grille aérienne : le calculateur du site propose désormais l’avion et le bateau.');
  }
  await call(admin, 'PUT', '/v1/admin/settings/finance', {
    maxDiscountPercent: 10,
    paymentInstructions: 'DEMO (fictif) : virement vers « DEMO Banque » compte 000-000-000, ou Zelle à paiements@demo.invalid. Indiquez votre numéro de facture en référence.',
  });
  await call(admin, 'PUT', '/v1/admin/settings/public-contact', { email: 'contact@demo.invalid', phones: ['+50937000000'], address: 'Adresse fictive (démonstration)', hours: 'DEMO : lundi au vendredi, 8 h - 17 h' }, [200, 204, 400]).catch(() => undefined);
  note('Consignes de paiement (virement, Zelle) et coordonnées publiques fictives enregistrées.');

  step('Le responsable d’entrepôt prépare les emplacements de rangement');
  const locations: Record<string, string> = {};
  const existingLocations = await call(warehouseManager, 'GET', `/v1/admin/warehouses/${miami.id}/locations`);
  for (const item of existingLocations.items ?? []) locations[item.code] = item.id;
  for (const code of ['A-01', 'A-02', 'B-01']) {
    if (!locations[code]) locations[code] = (await call(warehouseManager, 'POST', `/v1/admin/warehouses/${miami.id}/locations`, { code, kind: 'SHELF' })).id;
  }

  // --- 2. Les clients -------------------------------------------------------------------------------------
  step('2. Les clients : leur code client et leurs adresses de réception');
  const profile = async (token: string) => (await call(token, 'GET', '/v1/me/profile')).customer as Json;
  const marie = await profile(individual);
  const pierre = await profile(business);
  note(`Client individuel : code ${marie.customerCode} ; client professionnel : code ${pierre.customerCode}.`);
  const customerId = async (code: string) => (await call(admin, 'GET', `/v1/admin/customers?q=${encodeURIComponent(code)}`)).items[0].id as string;
  const marieId = await customerId(marie.customerCode);
  const pierreId = await customerId(pierre.customerCode);

  // Un troisième client s'inscrit lui-même (parcours public) ; l'e-mail de confirmation est remplacé ici par une validation directe
  let nadege: string | null = null;
  const prisma = process.env.DIRECT_URL ? new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } }) : null;
  if (prisma) {
    try {
      const email = roleEmail('nadege');
      await call(null, 'POST', '/v1/auth/register', { companySlug: SLUG, accountType: 'INDIVIDUAL', email, password: PASSWORD, firstName: 'DEMO', lastName: 'Nadège', acceptTerms: true });
      const company = await prisma.company.findUniqueOrThrow({ where: { slug: SLUG } });
      await prisma.user.updateMany({ where: { companyId: company.id, email }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } });
      nadege = await login(email);
      note('Une cliente s’est inscrite elle-même sur le site (nadege@demo.invalid) : compte confirmé, code client attribué.');
    } catch (error) {
      note(`Inscription publique non rejouée (${(error as Error).message.slice(0, 90)}).`);
    } finally {
      await prisma.$disconnect();
    }
  }
  const nadegeProfile = nadege ? await profile(nadege) : null;
  const nadegeId = nadegeProfile ? await customerId(nadegeProfile.customerCode) : null;
  await call(business, 'POST', '/v1/me/team', { email: roleEmail('equipe-lecteur'), firstName: 'DEMO', lastName: 'Équipe', role: 'READER' }, [201, 400, 409]).catch(() => undefined);
  note('Le client professionnel a invité un membre de son équipe (rôle « lecteur ») : il consulte sans payer ni modifier.');

  // --- Outils ---------------------------------------------------------------------------------------------
  const preAlert = async (token: string, mode: 'AIR' | 'SEA', store: string, amount: number, description: string, warehouseId = miami.id) =>
    (await call(token, 'POST', '/v1/me/prealerts', {
      storeName: store, orderNumber: `DEMO-${stamp}-${Math.floor(Math.random() * 9000 + 1000)}`, supplierTracking: `1ZDEMO${stamp}${Math.floor(Math.random() * 900000 + 100000)}`,
      warehouseId, transportMode: mode, purchaseAmount: amount, purchaseCurrency: 'USD', description,
    })) as { id: string; supplierTracking: string; package: { id: string; trackingNumber: string } };
  const receive = (p: { package: { id: string } }) => call(reception, 'POST', '/v1/admin/packages/receive', { warehouseId: miami.id, expectedPackageId: p.package.id });
  const weigh = (p: { package: { id: string } }, kg: number, dims: [number, number, number], declared?: number) =>
    call(reception, 'POST', `/v1/admin/packages/${p.package.id}/register`, { weight: { value: kg, unit: 'KG' }, dimensions: { length: dims[0], width: dims[1], height: dims[2], unit: 'CM' }, ...(declared ? { declaredValue: declared } : {}) });
  const invoice = async (customer: string, packages: { package: { id: string } }[]) => {
    const draft = await call(billing, 'POST', '/v1/admin/invoices', { customerId: customer, packageIds: packages.map((p) => p.package.id) });
    return (await call(billing, 'POST', `/v1/admin/invoices/${draft.id}/issue`)) as { id: string; number: string; total: string };
  };

  // --- 3. Le parcours des colis ---------------------------------------------------------------------------
  step('3. Des colis à chaque étape du parcours');

  const waiting = await preAlert(individual, 'AIR', 'DEMO Boutique Mode', 64.9, 'DEMO · étape 1 : préalerte, le colis est attendu à l’entrepôt');
  note(`Colis 1 — PRÉALERTE : ${waiting.package.trackingNumber} (attendu à l’entrepôt, rien n’est encore reçu).`);

  const received = await preAlert(business, 'AIR', 'DEMO Électro', 899, 'DEMO · étape 2 : reçu à l’entrepôt, pas encore pesé');
  await receive(received);
  note(`Colis 2 — REÇU : ${received.package.trackingNumber} (le réceptionnaire l’a rapproché grâce au numéro du marchand).`);

  const weighed = await preAlert(individual, 'AIR', 'DEMO Cosmétiques', 120, 'DEMO · étape 3 : pesé, frais calculés, pas encore facturé');
  await receive(weighed);
  await weigh(weighed, 2.3, [40, 30, 15], 120);
  note(`Colis 3 — PESÉ : ${weighed.package.trackingNumber} (poids facturable et frais calculés d’après la grille tarifaire).`);

  const unpaid = await preAlert(business, 'AIR', 'DEMO Fournitures', 340, 'DEMO · étape 4 : facture émise, en attente de paiement');
  await receive(unpaid);
  await weigh(unpaid, 6.8, [50, 40, 30], 340);
  const unpaidInvoice = await invoice(pierreId, [unpaid]);
  note(`Colis 4 — FACTURÉ : ${unpaid.package.trackingNumber}, facture ${unpaidInvoice.number} de ${unpaidInvoice.total} USD à payer.`);

  await call(billing, 'POST', '/v1/admin/cash-sessions', { openingAmount: 100 }, [201, 409]);
  note('La facturation a ouvert la caisse de l’entreprise (fond de 100 USD) : les espèces exigent une caisse ouverte.');

  const transfer = await preAlert(nadege ?? individual, 'SEA', 'DEMO Maison & Jardin', 210, 'DEMO · étape 5 : virement déclaré par la cliente, à valider');
  await receive(transfer);
  await weigh(transfer, 14, [60, 45, 40], 210);
  const transferInvoice = await invoice(nadegeId ?? marieId, [transfer]);
  await call(nadege ?? individual, 'POST', `/v1/me/invoices/${transferInvoice.id}/payments`, { method: 'ZELLE', amount: Number(transferInvoice.total), reference: `ZELLE-DEMO-${stamp}` });
  note(`Colis 5 — PAIEMENT À VALIDER : ${transfer.package.trackingNumber} (maritime). La cliente a déclaré un paiement Zelle de ${transferInvoice.total} USD ; un agent le validera dans « Paiements ».`);

  // Colis payés en espèces, rangés puis chargés dans les lots
  const readyList: { package: { id: string; trackingNumber: string }; supplierTracking: string }[] = [];
  const readyOne = async (token: string, customer: string, store: string, amount: number, description: string, kg: number, dims: [number, number, number], location?: string) => {
    const p = await preAlert(token, 'AIR', store, amount, description);
    await receive(p);
    await weigh(p, kg, dims, amount);
    const bill = await invoice(customer, [p]);
    await call(billing, 'POST', '/v1/admin/payments/cash', { invoiceId: bill.id, amount: Number(bill.total) });
    if (location) await call(warehouseManager, 'POST', `/v1/admin/packages/${p.package.id}/move`, { locationId: locations[location], note: 'Rangement DEMO' });
    const detail = await call(admin, 'GET', `/v1/admin/packages/${p.package.id}`);
    if (detail.status !== 'READY_TO_SHIP') await call(logistics, 'POST', `/v1/admin/packages/${p.package.id}/transitions`, { to: 'READY_TO_SHIP', reason: 'Facture payée : prêt à partir' });
    readyList.push(p);
    return p;
  };
  const stored = await readyOne(individual, marieId, 'DEMO Librairie', 45, 'DEMO · étape 6 : payé en espèces, rangé, prêt à partir', 1.1, [30, 22, 8], 'A-01');
  note(`Colis 6 — PRÊT À PARTIR : ${stored.package.trackingNumber} (payé en espèces, reçu RCT- délivré, rangé en A-01).`);

  const inTransit1 = await readyOne(business, pierreId, 'DEMO Outillage', 260, 'DEMO · étape 7 : dans un lot aérien parti', 5.2, [45, 35, 25], 'A-02');
  const inTransit2 = await readyOne(individual, marieId, 'DEMO Jouets', 75, 'DEMO · étape 7 : dans un lot aérien parti', 2.8, [35, 28, 20], 'B-01');
  const arrived = await readyOne(individual, marieId, 'DEMO Téléphonie', 310, 'DEMO · étape 8 : arrivé en agence, reçu', 0.9, [20, 12, 8]);
  const pickup = await readyOne(business, pierreId, 'DEMO Papeterie', 95, 'DEMO · étape 9 : prêt pour retrait en agence', 3.4, [40, 30, 20]);
  const counter = await readyOne(individual, marieId, 'DEMO Vêtements', 130, 'DEMO · étape 10 : remis au comptoir avec le code du client', 1.6, [35, 25, 12]);
  const delivered = await readyOne(business, pierreId, 'DEMO Cuisine', 180, 'DEMO · étape 11 : livré à domicile par un livreur', 4.1, [45, 30, 25]);

  step('4. Le transport : lots aériens, départ, arrivée, réception en agence');
  const lotAir = await call(logistics, 'POST', '/v1/admin/shipments', { transportMode: 'AIR', originWarehouseId: miami.id, destinationCountry: 'HT', destinationAgencyId: portAuPrince.id, carrierName: 'DEMO Cargo (fictif)', transportRef: `LTA-DEMO-${stamp}-1`, notes: 'DEMO : lot déjà parti, en transit' });
  for (const p of [inTransit1, inTransit2]) await call(logistics, 'POST', `/v1/admin/shipments/${lotAir.id}/packages`, { packageId: p.package.id });
  await call(logistics, 'POST', `/v1/admin/shipments/${lotAir.id}/dispatch`, {});
  note(`Lot ${lotAir.reference} PARTI avec 2 colis (7) : leurs statuts avancent avec le lot ; manifeste CSV/PDF disponible.`);

  const lotArrived = await call(logistics, 'POST', '/v1/admin/shipments', { transportMode: 'AIR', originWarehouseId: miami.id, destinationCountry: 'HT', destinationAgencyId: portAuPrince.id, carrierName: 'DEMO Cargo (fictif)', transportRef: `LTA-DEMO-${stamp}-2`, notes: 'DEMO : lot arrivé' });
  for (const p of [arrived, pickup, counter, delivered]) await call(logistics, 'POST', `/v1/admin/shipments/${lotArrived.id}/packages`, { packageId: p.package.id });
  await call(logistics, 'POST', `/v1/admin/shipments/${lotArrived.id}/dispatch`, {});
  await call(logistics, 'POST', `/v1/admin/shipments/${lotArrived.id}/arrive`, {});
  note(`Lot ${lotArrived.reference} ARRIVÉ à Port-au-Prince avec 4 colis.`);

  const lotSea = await call(logistics, 'POST', '/v1/admin/shipments', { transportMode: 'SEA', originWarehouseId: miami.id, destinationCountry: 'HT', destinationAgencyId: capHaitien.id, carrierName: 'DEMO Maritime (fictif)', transportRef: `BL-DEMO-${stamp}`, notes: 'DEMO : lot maritime encore OUVERT, des colis peuvent y être chargés' });
  note(`Lot maritime ${lotSea.reference} OUVERT (vide) : on y charge les colis maritimes prêts.`);

  step('5. L’agence reçoit, prépare le retrait ; le client retire ; le livreur livre');
  for (const p of [arrived, pickup, counter, delivered]) {
    await call(agencyManager, 'POST', `/v1/admin/agencies/${portAuPrince.id}/receive`, { code: p.package.trackingNumber });
  }
  for (const p of [pickup, counter, delivered]) {
    await call(agencyManager, 'POST', `/v1/admin/agencies/${portAuPrince.id}/packages/${p.package.id}/ready-for-pickup`, {});
  }
  note('4 colis REÇUS en agence ; 3 sont « prêts pour retrait » (les clients sont prévenus).');

  const code = (await call(individual, 'POST', `/v1/me/packages/${counter.package.id}/handover-code`)).code as string;
  await call(agencyManager, 'POST', `/v1/admin/packages/${counter.package.id}/handover`, { recipientKind: 'CUSTOMER', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', otp: code });
  note(`Colis 10 REMIS au comptoir : le client a donné son code de remise (${code.replace(/./g, '•')}) et sa pièce d’identité (4 derniers caractères enregistrés).`);

  // La livraison à domicile exige une adresse de livraison enregistrée par le client
  await call(business, 'POST', '/v1/me/addresses', { kind: 'DELIVERY', label: 'Bureau', recipientName: 'DEMO Ets Pierre et Fils', line1: 'Adresse fictive : 12 rue des Palmistes', city: 'Pétion-Ville', country: 'ht' });

  const driverId = (await call(driver, 'GET', '/v1/auth/me')).id as string;
  const route = await call(agencyManager, 'POST', '/v1/admin/routes', { agencyId: portAuPrince.id, driverUserId: driverId, plannedDate: today() });
  const stop = await call(agencyManager, 'POST', `/v1/admin/routes/${route.id}/stops`, { packageId: delivered.package.id, instructions: 'DEMO : portail bleu, sonner deux fois' });
  await call(agencyManager, 'POST', `/v1/admin/routes/${route.id}/start`);
  const deliveryCode = (await call(business, 'POST', `/v1/me/packages/${delivered.package.id}/handover-code`)).code as string;
  const stopId = stop.id ?? (await call(agencyManager, 'GET', `/v1/admin/routes/${route.id}`)).stops[0].id;
  await call(driver, 'POST', `/v1/admin/route-stops/${stopId}/deliver`, { recipientKind: 'CUSTOMER', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '7302', otp: deliveryCode });
  await call(agencyManager, 'POST', `/v1/admin/routes/${route.id}/complete`).catch(() => undefined);
  note(`Colis 11 LIVRÉ à domicile : tournée ${route.reference ?? ''} confiée au livreur, qui ne voit que ses propres tournées.`);

  step('6. Les incidents : retenue, colis sans client, réclamation, remboursement');
  const held = await preAlert(individual, 'AIR', 'DEMO Boutique Spéciale', 80, 'DEMO · colis retenu : contenu à vérifier');
  await receive(held);
  await call(reception, 'POST', `/v1/admin/packages/${held.package.id}/transitions`, { to: 'ON_HOLD', reason: 'DEMO : contenu à vérifier avant l’expédition', holdReasonCode: 'OTHER' });
  note(`Colis RETENU : ${held.package.trackingNumber} (apparaît dans les anomalies de l’entrepôt).`);

  await call(reception, 'POST', '/v1/admin/scan/receive', { warehouseId: miami.id, code: `INCONNU-DEMO-${stamp}` }, [200, 201]).catch((error) => note(`Colis sans client non rejoué (${(error as Error).message.slice(0, 80)}).`));
  note('Un colis arrivé SANS préalerte a été scanné : il est « non identifié » et attend qu’on le rattache à un client.');

  const claim = await call(individual, 'POST', '/v1/me/claims', { category: 'DAMAGED', subject: 'DEMO : boîte abîmée à la livraison', message: 'La boîte du colis « Vêtements » est écrasée sur un coin. Voici ce que j’ai constaté.', packageId: counter.package.id });
  await call(service, 'POST', `/v1/admin/claims/${claim.id}/messages`, { body: 'DEMO (note interne) : vérifier la photo à l’arrivée en entrepôt.', internal: true });
  await call(service, 'POST', `/v1/admin/claims/${claim.id}/messages`, { body: 'Bonjour, nous regardons cela et revenons vers vous rapidement.' });
  await call(service, 'POST', `/v1/admin/claims/${claim.id}/status`, { status: 'IN_PROGRESS' }, [200, 201, 409]); // déjà « en cours » dès la première réponse du service client
  note(`Réclamation ${claim.number} OUVERTE par la cliente, prise en charge par le service client (une note interne reste invisible pour elle).`);

  const refundPayments = await call(billing, 'GET', '/v1/admin/payments?limit=5');
  const cashPayment = (refundPayments.items ?? []).find((payment: Json) => payment.method === 'CASH' && payment.status === 'CONFIRMED');
  if (cashPayment) {
    await call(billing, 'POST', `/v1/admin/payments/${cashPayment.id}/refunds`, { amount: 1.5, reason: 'DEMO : geste commercial après réclamation' });
    note('Un remboursement partiel de 1,50 USD a été enregistré (le paiement passe « remboursé en partie »).');
  }

  step('7. Les notifications partent');
  await call(admin, 'POST', '/v1/admin/notifications/process', {}, [200, 201, 202, 204]).catch(() => note('Traitement des notifications non lancé.'));
  note('Messages de suivi envoyés (e-mails de développement dans Mailpit, boîte de réception du portail du client).');

  console.log(`
════════════════════════════════════════════════════════════════════════════
Scénario chargé dans l'entreprise « ${SLUG} ».
Comptes (mot de passe : celui de DEMO_PASSWORD) — adresses en @demo.invalid :
  Panel (http://localhost:5174) : company-admin, logistics-manager, billing-agent, customer-service,
    reception-agent (entrepôt DEMO-MIA), warehouse-manager, agency-manager (agence DEMO-PAP), driver, auditor
  Site  (http://localhost:5173) : customer-individual, customer-business${nadege ? ', nadege' : ''}
Pistes de découverte : docs/DEMO.md
════════════════════════════════════════════════════════════════════════════`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
