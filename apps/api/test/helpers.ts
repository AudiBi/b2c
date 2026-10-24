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

export function api(t: TestApp) {
  return request(t.app.getHttpServer());
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
