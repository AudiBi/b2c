import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient, type UserKind, type UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { PLATFORM_COMPANY_ID, type RoleCode } from '@b2c/shared';
import { createApp } from '../src/app.factory';
import { loadEnv, type Env } from '../src/config/env';
import { DbService } from '../src/database/db.service';
import { MailService, type MailMessage } from '../src/mail/mail.service';
import { RedisService } from '../src/redis/redis.service';

export interface TestApp {
  app: NestExpressApplication;
  env: Env;
  mail: MailService;
  db: DbService;
  redis: RedisService;
  /** Client Prisma du rôle de MIGRATION : contourne la RLS, réservé à la préparation et à la vérification des données. */
  admin: PrismaClient;
  close(): Promise<void>;
}

export async function buildTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const env = loadEnv({ ...process.env, ...overrides });
  const app = await createApp(env);
  await app.init();
  // supertest ouvre un écouteur par requête sur un serveur non démarré : on évite l'avertissement de fuite
  app.getHttpServer().setMaxListeners(0);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DIRECT_URL } } });
  return {
    app,
    env,
    mail: app.get(MailService),
    db: app.get(DbService),
    redis: app.get(RedisService),
    admin,
    close: async () => {
      await app.close();
      await admin.$disconnect();
    },
  };
}

export const uniq = (prefix = 'x') => `${prefix}${randomBytes(5).toString('hex')}`;

/** Adresse IP fictive distincte (nécessite TRUST_PROXY=true) pour que les limites par IP ne s'accumulent pas entre tests. */
export const freshIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`;

export const strongPassword = () => `Tr0ub4dor-${randomBytes(6).toString('hex')}`;

/**
 * Client HTTP de test. Chaque requête reçoit une adresse IP fictive distincte (X-Forwarded-For) pour que les
 * limites de débit par IP ne s'accumulent pas entre tests ; un test peut la fixer avec .set('X-Forwarded-For', …).
 */
export function api(t: TestApp) {
  const agent = request(t.app.getHttpServer());
  const withIp = <M extends 'get' | 'post' | 'put' | 'patch' | 'delete'>(method: M) =>
    (url: string) => agent[method](url).set('X-Forwarded-For', freshIp());
  return {
    get: withIp('get'),
    post: withIp('post'),
    put: withIp('put'),
    patch: withIp('patch'),
    delete: withIp('delete'),
  };
}

export async function makeCompany(t: TestApp, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const slug = uniq('t');
  const company = await t.admin.company.create({ data: { name: `Test ${slug}`, slug, status } });
  return { id: company.id, slug };
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  companyId: string;
  slug: string;
}

export interface MakeUserOptions {
  company: { id: string; slug: string };
  roleCode: RoleCode;
  kind?: UserKind;
  status?: UserStatus;
  verified?: boolean;
  email?: string;
  password?: string;
  scope?: { type: 'WAREHOUSE' | 'AGENCY' | 'ROUTE'; id: string };
}

/** Crée directement en base (hors API) un utilisateur actif avec un rôle système. */
export async function makeUser(t: TestApp, options: MakeUserOptions): Promise<TestUser> {
  const password = options.password ?? strongPassword();
  const email = options.email ?? `${uniq('u')}@test.example`;
  const role = await t.admin.role.findUniqueOrThrow({
    where: { companyId_code: { companyId: PLATFORM_COMPANY_ID, code: options.roleCode } },
  });
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_KIB),
    timeCost: 3,
    parallelism: 1,
  });
  const verified = options.verified ?? true;
  const user = await t.admin.user.create({
    data: {
      companyId: options.company.id,
      kind: options.kind ?? (options.roleCode.startsWith('CUSTOMER') ? 'CUSTOMER' : 'STAFF'),
      email,
      firstName: 'Test',
      lastName: options.roleCode,
      passwordHash,
      status: options.status ?? (verified ? 'ACTIVE' : 'PENDING'),
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
  await t.admin.userRole.create({
    data: {
      companyId: options.company.id,
      userId: user.id,
      roleId: role.id,
      scopeType: options.scope?.type ?? 'COMPANY',
      scopeId: options.scope?.id ?? null,
      scopeKey: options.scope ? `${options.scope.type}:${options.scope.id}` : 'COMPANY',
    },
  });
  return { id: user.id, email, password, companyId: options.company.id, slug: options.company.slug };
}

export interface LoginResult {
  accessToken: string;
  refreshCookie?: string;
  body: any;
  headers: Record<string, any>;
}

export async function login(t: TestApp, user: Pick<TestUser, 'slug' | 'email' | 'password'>, ip = freshIp()): Promise<LoginResult> {
  const res = await api(t)
    .post('/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ companySlug: user.slug, email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`Connexion refusée (${res.status}) : ${JSON.stringify(res.body)}`);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return {
    accessToken: res.body.accessToken,
    refreshCookie: setCookie.find((c) => c.startsWith('b2c_refresh=')),
    body: res.body,
    headers: res.headers,
  };
}

/** Valeur du cookie de renouvellement (sans attributs). */
export const cookieValue = (setCookie: string) => setCookie.split(';')[0].split('=').slice(1).join('=');

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function lastMailTo(t: TestApp, address: string): MailMessage {
  const messages = t.mail.sent.filter((m) => m.to === address);
  if (messages.length === 0) throw new Error(`Aucun e-mail envoyé à ${address}`);
  return messages[messages.length - 1];
}

export function mailsTo(t: TestApp, address: string): MailMessage[] {
  return t.mail.sent.filter((m) => m.to === address);
}

export function tokenFromMail(message: MailMessage): string {
  const match = /token=([^\s&]+)/.exec(message.text);
  if (!match) throw new Error(`Pas de jeton dans l'e-mail : ${message.subject}`);
  return decodeURIComponent(match[1]);
}

export async function platformAdmin(t: TestApp): Promise<TestUser> {
  return makeUser(t, {
    company: { id: PLATFORM_COMPANY_ID, slug: 'platform' },
    roleCode: 'SUPER_ADMIN',
    kind: 'PLATFORM',
  });
}

// ---------------------------------------------------------------------------------------------
// Aides pour les colis, tarifs et fichiers (phase 5)
// ---------------------------------------------------------------------------------------------

export interface Company {
  id: string;
  slug: string;
}

const PREFIX_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ';
/** Préfixe de suivi valide (alphabet sans I, L, O, U) et unique avec une probabilité écrasante : 4 lettres aléatoires. */
const randomTrackingPrefix = () => Array.from({ length: 4 }, () => PREFIX_LETTERS[randomBytes(1)[0] % PREFIX_LETTERS.length]).join('');

/** Entreprise de test (préfixe de suivi propre, code client « TT-… ») avec un administrateur connecté. */
export async function makeTenant(t: TestApp, trackingPrefix = randomTrackingPrefix()) {
  const slug = uniq('t');
  const created = await t.admin.company.create({ data: { name: `Tenant ${slug}`, slug, trackingPrefix, customerCodePrefix: 'TT' } });
  const company: Company = { id: created.id, slug };
  const admin = await makeUser(t, { company, roleCode: 'COMPANY_ADMIN' });
  const token = (await login(t, admin)).accessToken;
  return { company, admin, token };
}

export async function makeWarehouse(t: TestApp, token: string, overrides: Record<string, unknown> = {}) {
  const res = await api(t)
    .post('/v1/admin/warehouses')
    .set(bearer(token))
    .send({
      reference: `W${randomBytes(4).toString('hex').toUpperCase()}`,
      name: 'Entrepôt de test',
      country: 'us',
      city: 'Miami',
      addressLine: '1 Test Street',
      addressTemplate: ['{customerName}', '{customerCode} {mode}', '1 Test Street'],
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`Entrepôt refusé : ${JSON.stringify(res.body)}`);
  return res.body as { id: string; reference: string; city: string };
}

/** Grille de test : AIR US→HT en USD, kg/cm, diviseur 5000, arrondi au demi-kilo supérieur. */
export const cardBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Grille de test',
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
  validFrom: '2020-01-01',
  rules: [
    { weightFrom: 0, weightTo: 5, pricePerUnit: 4, flatFee: 0, minCharge: 3 },
    { weightFrom: 5, pricePerUnit: 3.5, flatFee: 0, minCharge: 0 },
  ],
  surcharges: [
    { code: 'HANDLING', name: { fr: 'Manutention', ht: 'Manitansyon', en: 'Handling' }, kind: 'SURCHARGE', method: 'FLAT', value: 1.5, optional: false },
    { code: 'INSURANCE', name: { fr: 'Assurance', ht: 'Asirans', en: 'Insurance' }, kind: 'INSURANCE', method: 'PERCENT_OF_DECLARED_VALUE', value: 2, optional: true },
  ],
  ...overrides,
});

export async function activateRateCard(t: TestApp, token: string, overrides: Record<string, unknown> = {}) {
  const created = await api(t).post('/v1/admin/rate-cards').set(bearer(token)).send(cardBody(overrides));
  if (created.status !== 201) throw new Error(`Grille refusée : ${JSON.stringify(created.body)}`);
  const activated = await api(t).post(`/v1/admin/rate-cards/${created.body.id}/activate`).set(bearer(token));
  if (activated.status !== 200) throw new Error(`Activation refusée : ${JSON.stringify(activated.body)}`);
  return activated.body as { id: string };
}

export interface CustomerSession {
  user: TestUser;
  token: string;
  customerCode: string;
}

/** Client prêt à l'emploi (compte actif, profil et code client créés). */
export async function makeCustomer(t: TestApp, company: Company): Promise<CustomerSession> {
  const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
  const { accessToken } = await login(t, user);
  const profile = await api(t).get('/v1/me/profile').set(bearer(accessToken));
  return { user, token: accessToken, customerCode: profile.body.customer.customerCode };
}

export const prealertBody = (warehouseId: string, overrides: Record<string, unknown> = {}) => ({
  storeName: 'Boutique Test',
  orderNumber: `ORD-${randomBytes(3).toString('hex')}`,
  supplierTracking: `1Z${randomBytes(6).toString('hex').toUpperCase()}`,
  warehouseId,
  transportMode: 'AIR',
  purchaseAmount: 59.9,
  purchaseCurrency: 'USD',
  description: 'Chaussures de sport',
  ...overrides,
});

export async function makePrealert(t: TestApp, customer: CustomerSession, warehouseId: string, overrides: Record<string, unknown> = {}) {
  const res = await api(t).post('/v1/me/prealerts').set(bearer(customer.token)).send(prealertBody(warehouseId, overrides));
  if (res.status !== 201) throw new Error(`Préalerte refusée : ${JSON.stringify(res.body)}`);
  return res.body as { id: string; supplierTracking: string; package: { id: string; trackingNumber: string; status: string } };
}

/** Octets minimaux reconnus comme JPEG, PNG, WebP et PDF (signature réelle suivie de remplissage). */
export const fixtures = {
  jpeg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(64, 7)]),
  png: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]),
  webp: () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 1)]),
  pdf: () => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  pdfWithScript: () => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n%%EOF\n'),
};
