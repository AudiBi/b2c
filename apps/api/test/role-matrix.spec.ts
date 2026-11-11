import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { ROLE_DEFINITIONS, type RoleCode } from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import { ALLOW_WITHOUT_MFA, ANY_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../src/security/decorators';
import { api, bearer, buildTestApp, login, makeAgency, makeCompany, makeTenant, makeUser, makeWarehouse, platformAdmin, type TestApp } from './helpers';

/**
 * Matrice rôles × routes. Pour CHAQUE route protégée et CHAQUE rôle :
 *  - rôle système : refus 403 FORBIDDEN s'il manque une permission, jamais bloqué par la garde sinon, jamais d'erreur serveur ;
 *  - rôle PERSONNALISÉ : même règle, d'après les permissions choisies par l'administrateur ;
 *  - routes ouvertes à tout utilisateur connecté : passent pour tous les rôles ;
 *  - double authentification obligatoire (REQUIRE_STAFF_2FA) : le personnel sans second facteur est bloqué partout sauf sur les routes d'activation ;
 *  - portée réelle : un rôle limité à un entrepôt / une agence accède au SIEN (200) et pas à un autre (403).
 * Les requêtes autorisées sont envoyées avec des identifiants inexistants et un corps vide : elles échouent en 400/404, sans effet.
 * Pour écrire le tableau lisible dans docs/ROLE_MATRIX.md : ROLE_MATRIX_OUT=1 npm -w @b2c/api test -- role-matrix
 */

interface RouteInfo {
  label: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  permissions: string[];
  /** Reste accessible au personnel sans double authentification activée (activation, profil, déconnexion). */
  withoutMfa: boolean;
}

type Cell = '✔' | '·' | '◐';

const METHODS: Partial<Record<number, RouteInfo['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

const joinPath = (...parts: unknown[]): string =>
  '/' +
  parts
    .map((part) => (Array.isArray(part) ? part[0] : part))
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

const GUARD_CODES = ['FORBIDDEN', 'ROUTE_NOT_CONFIGURED', 'TOTP_ENROLLMENT_REQUIRED'];
// Ne pas fermer la session de test pendant la vérification des routes ouvertes à tout utilisateur connecté
const DESTRUCTIVE_FOR_SESSION = /logout/;

describe('Matrice rôles × routes', () => {
  let t: TestApp;
  const routes: RouteInfo[] = [];
  const anyAuthRoutes: RouteInfo[] = [];
  const tokens = new Map<RoleCode, string>();

  beforeAll(async () => {
    t = await buildTestApp();
    const reflector = new Reflector();
    for (const module of t.app.get(ModulesContainer).values()) {
      for (const controller of module.controllers.values()) {
        const instance = controller.instance as object | undefined;
        if (!instance) continue;
        const prototype = Object.getPrototypeOf(instance);
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const methodId = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
          const method = methodId === undefined ? undefined : METHODS[methodId];
          if (!method) continue;
          const targets = [handler, controller.metatype!];
          if (reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) continue;
          const template = joinPath('v1', Reflect.getMetadata(PATH_METADATA, controller.metatype!), Reflect.getMetadata(PATH_METADATA, handler));
          const info: RouteInfo = {
            label: `${method.toUpperCase()} ${template}`,
            method,
            path: template.replace(/:[A-Za-z0-9_]+/g, () => uuidv7()),
            permissions: [],
            withoutMfa: reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets) === true,
          };
          if (reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets)) {
            anyAuthRoutes.push(info);
            continue;
          }
          info.permissions = reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
          routes.push(info);
        }
      }
    }

    // Un compte par rôle : les rôles du personnel et des clients dans une entreprise, le super administrateur sur la plateforme
    const company = await makeCompany(t);
    for (const role of ROLE_DEFINITIONS) {
      if (role.code === 'SUPER_ADMIN') {
        tokens.set(role.code, (await login(t, await platformAdmin(t))).accessToken);
        continue;
      }
      const scope = role.allowedScopes[0] === 'COMPANY' ? undefined : ({ type: role.allowedScopes[0], id: uuidv7() } as never);
      const user = await makeUser(t, { company, roleCode: role.code, scope, kind: role.audience === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF' });
      tokens.set(role.code, (await login(t, user)).accessToken);
    }
  });
  afterAll(() => t.close());

  /**
   * Envoie chaque route protégée avec le jeton donné et compare au droit attendu.
   * `scoped` : rôle limité à un entrepôt/une agence — un refus de portée par le service (403) est alors normal (« ◐ »).
   */
  async function checkRole(label: string, granted: ReadonlySet<string>, token: string, scoped: boolean) {
    const failures: string[] = [];
    const serverErrors: string[] = [];
    const cells = new Map<string, Cell>();
    for (const route of routes) {
      const allowed = route.permissions.every((permission) => granted.has(permission));
      const res = await api(t)[route.method](route.path).set(bearer(token)).send({});
      const code = res.body?.error?.code as string | undefined;
      const scopeLimited = allowed && scoped && res.status === 403 && code === 'FORBIDDEN';
      cells.set(route.label, !allowed ? '·' : scopeLimited ? '◐' : '✔');
      if (!allowed) {
        if (res.status !== 403 || code !== 'FORBIDDEN') failures.push(`${label} ne devrait PAS accéder à ${route.label} [${route.permissions}] → ${res.status} ${code ?? ''}`);
      } else {
        if (res.status === 401 || (!scopeLimited && res.status === 403 && GUARD_CODES.includes(code ?? ''))) {
          failures.push(`${label} devrait accéder à ${route.label} [${route.permissions}] → ${res.status} ${code ?? ''}`);
        }
        if (res.status >= 500) serverErrors.push(`${label} ${route.label} → ${res.status}`);
      }
    }
    return { failures, serverErrors, cells };
  }

  it('trouve un nombre crédible de routes protégées', () => {
    expect(routes.length).toBeGreaterThanOrEqual(100);
    expect(tokens.size).toBe(ROLE_DEFINITIONS.length);
  });

  it('sans jeton, toute route non publique répond 401', async () => {
    const failures: string[] = [];
    for (const route of [...routes, ...anyAuthRoutes]) {
      const res = await api(t)[route.method](route.path);
      if (res.status !== 401) failures.push(`${route.label} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('chaque rôle système : refusé (403) là où il lui manque une permission, jamais bloqué par la garde là où il les a toutes', async () => {
    const failures: string[] = [];
    const serverErrors: string[] = [];
    const matrix = new Map<RoleCode, Map<string, Cell>>();
    for (const role of ROLE_DEFINITIONS) {
      // Rôle limité à un entrepôt / une agence : la garde l'admet, puis le service refuse tout ce qui sort de sa portée
      // (ici, un identifiant tiré au hasard). C'est un second niveau de contrôle voulu, signalé « ◐ » ; sa justesse est vérifiée plus bas.
      const result = await checkRole(role.code, new Set<string>(role.permissions), tokens.get(role.code)!, role.allowedScopes[0] !== 'COMPANY');
      failures.push(...result.failures);
      serverErrors.push(...result.serverErrors);
      matrix.set(role.code, result.cells);
    }

    if (process.env.ROLE_MATRIX_OUT) {
      const roles = ROLE_DEFINITIONS.map((r) => r.code);
      const lines = [
        '# Matrice rôles × routes',
        '',
        'Générée par `apps/api/test/role-matrix.spec.ts` (`ROLE_MATRIX_OUT=1`). ✔ = autorisé, · = refusé (403), ◐ = autorisé par le rôle mais limité à son entrepôt / son agence / sa caisse (la garde l’admet, le service refuse hors portée). Chaque case a été **vérifiée** contre l’API en marche, pas seulement déduite du catalogue.',
        `Les ${anyAuthRoutes.length} routes ouvertes à tout utilisateur connecté (profil, session, double authentification…) sont vérifiées à part (accessibles à tous les rôles) et les routes publiques n’y figurent pas.`,
        '',
        `| Route | Permissions | ${roles.join(' | ')} |`,
        `|---|---|${roles.map(() => ':-:').join('|')}|`,
        ...routes.map((route) => `| \`${route.label}\` | ${route.permissions.join(', ')} | ${roles.map((r) => matrix.get(r)!.get(route.label)).join(' | ')} |`),
        '',
      ];
      const dir = join(__dirname, '../../../docs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'ROLE_MATRIX.md'), lines.join('\n'));
    }

    expect(failures).toEqual([]);
    expect(serverErrors).toEqual([]);
  }, 600_000);

  it('rôle PERSONNALISÉ : seules les permissions choisies ouvrent des routes', async () => {
    const tenant = await makeTenant(t);
    const permissions = ['package:read', 'warehouse:read', 'invoice:read'];
    const created = await api(t).post('/v1/admin/roles').set(bearer(tenant.token)).send({ name: `Matrice ${tenant.company.slug}`, scopeType: 'COMPANY', permissions });
    expect(created.status).toBe(201);

    // Un compte du personnel sans aucun rôle, auquel on donne uniquement le rôle personnalisé
    const staff = await makeUser(t, { company: tenant.company, roleCode: 'AUDITOR' });
    const detail = await api(t).get(`/v1/admin/users/${staff.id}`).set(bearer(tenant.token));
    for (const r of detail.body.roles) await api(t).delete(`/v1/admin/users/${staff.id}/roles/${r.userRoleId}`).set(bearer(tenant.token));
    expect((await api(t).post(`/v1/admin/users/${staff.id}/roles`).set(bearer(tenant.token)).send({ roleCode: created.body.code })).status).toBe(201);
    const token = (await login(t, staff)).accessToken;

    const { failures, serverErrors, cells } = await checkRole('rôle personnalisé', new Set(permissions), token, false);
    expect(failures).toEqual([]);
    expect(serverErrors).toEqual([]);
    expect([...cells.values()].filter((c) => c === '✔').length).toBeGreaterThan(0);
    expect([...cells.values()].filter((c) => c === '·').length).toBeGreaterThan(routes.length / 2);
  }, 300_000);

  it('routes ouvertes à tout utilisateur connecté : aucun rôle n’y est bloqué par la garde', async () => {
    const failures: string[] = [];
    const serverErrors: string[] = [];
    // Jetons dédiés : certaines de ces routes (mot de passe, double authentification) touchent la session
    const company = await makeCompany(t);
    for (const role of ROLE_DEFINITIONS) {
      let token: string;
      if (role.code === 'SUPER_ADMIN') token = (await login(t, await platformAdmin(t))).accessToken;
      else {
        const scope = role.allowedScopes[0] === 'COMPANY' ? undefined : ({ type: role.allowedScopes[0], id: uuidv7() } as never);
        token = (await login(t, await makeUser(t, { company, roleCode: role.code, scope, kind: role.audience === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF' }))).accessToken;
      }
      for (const route of anyAuthRoutes) {
        if (DESTRUCTIVE_FOR_SESSION.test(route.path)) continue;
        const res = await api(t)[route.method](route.path).set(bearer(token)).send({});
        const code = res.body?.error?.code as string | undefined;
        if (res.status === 401 || (res.status === 403 && GUARD_CODES.includes(code ?? ''))) failures.push(`${role.code} bloqué sur ${route.label} → ${res.status} ${code ?? ''}`);
        if (res.status >= 500) serverErrors.push(`${role.code} ${route.label} → ${res.status}`);
      }
    }
    expect(anyAuthRoutes.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    expect(serverErrors).toEqual([]);
  }, 300_000);

  it('double authentification obligatoire : le personnel sans second facteur est bloqué partout sauf sur les routes d’activation ; les clients ne sont pas concernés', async () => {
    const strict = await buildTestApp({ REQUIRE_STAFF_2FA: 'true' });
    try {
      const company = await makeCompany(strict);
      const failures: string[] = [];
      for (const role of ROLE_DEFINITIONS) {
        const isCustomer = role.audience === 'CUSTOMER';
        let token: string;
        if (role.code === 'SUPER_ADMIN') token = (await login(strict, await platformAdmin(strict))).accessToken;
        else {
          const scope = role.allowedScopes[0] === 'COMPANY' ? undefined : ({ type: role.allowedScopes[0], id: uuidv7() } as never);
          token = (await login(strict, await makeUser(strict, { company, roleCode: role.code, scope, kind: isCustomer ? 'CUSTOMER' : 'STAFF' }))).accessToken;
        }
        for (const route of [...routes, ...anyAuthRoutes]) {
          if (DESTRUCTIVE_FOR_SESSION.test(route.path)) continue;
          const res = await api(strict)[route.method](route.path).set(bearer(token)).send({});
          const blocked = res.status === 403 && res.body?.error?.code === 'TOTP_ENROLLMENT_REQUIRED';
          const shouldBlock = !isCustomer && !route.withoutMfa;
          if (blocked !== shouldBlock) failures.push(`${role.code} ${route.label} → ${res.status} ${res.body?.error?.code ?? ''} (blocage attendu : ${shouldBlock})`);
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await strict.close();
    }
  }, 600_000);

  it('portée réelle : un rôle limité à un entrepôt ou une agence accède au SIEN, pas à un autre', async () => {
    const tenant = await makeTenant(t);
    const [wA, wB] = [await makeWarehouse(t, tenant.token), await makeWarehouse(t, tenant.token)];
    const [aX, aY] = [await makeAgency(t, tenant.token), await makeAgency(t, tenant.token)];
    const get = (token: string, path: string) => api(t).get(path).set(bearer(token));
    const tokenFor = async (roleCode: RoleCode, type: 'WAREHOUSE' | 'AGENCY', id: string) =>
      (await login(t, await makeUser(t, { company: tenant.company, roleCode, scope: { type, id } }))).accessToken;

    for (const roleCode of ['WAREHOUSE_MANAGER', 'RECEPTION_AGENT'] as const) {
      const token = await tokenFor(roleCode, 'WAREHOUSE', wA.id);
      for (const suffix of ['locations', 'inventory']) {
        expect((await get(token, `/v1/admin/warehouses/${wA.id}/${suffix}`)).status).toBe(200);
        const other = await get(token, `/v1/admin/warehouses/${wB.id}/${suffix}`);
        expect([other.status, other.body?.error?.code]).toEqual([403, 'FORBIDDEN']);
      }
    }

    const agent = await tokenFor('AGENCY_MANAGER', 'AGENCY', aX.id);
    expect((await get(agent, `/v1/admin/agencies/${aX.id}/packages`)).status).toBe(200);
    const other = await get(agent, `/v1/admin/agencies/${aY.id}/packages`);
    expect([other.status, other.body?.error?.code]).toEqual([403, 'FORBIDDEN']);

    // L'administrateur de l'entreprise (portée entreprise) accède aux deux
    for (const id of [wA.id, wB.id]) expect((await get(tenant.token, `/v1/admin/warehouses/${id}/locations`)).status).toBe(200);
    for (const id of [aX.id, aY.id]) expect((await get(tenant.token, `/v1/admin/agencies/${id}/packages`)).status).toBe(200);
  }, 120_000);

  it('caisse : un responsable d’agence ne voit, n’ouvre et ne clôture que la caisse de SON agence ; la facturation (entreprise) les gère toutes', async () => {
    const tenant = await makeTenant(t);
    const [aX, aY] = [await makeAgency(t, tenant.token), await makeAgency(t, tenant.token)];
    const as = async (roleCode: RoleCode, scope?: { type: 'AGENCY'; id: string }) => (await login(t, await makeUser(t, { company: tenant.company, roleCode, scope }))).accessToken;
    const manager = await as('AGENCY_MANAGER', { type: 'AGENCY', id: aX.id });
    const billing = await as('BILLING_AGENT');
    const open = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/cash-sessions').set(bearer(token)).send(body);
    const close = (token: string, id: string) => api(t).post(`/v1/admin/cash-sessions/${id}/close`).set(bearer(token)).send({ countedAmount: 0 });
    const list = async (token: string) => ((await api(t).get('/v1/admin/cash-sessions').set(bearer(token))).body.items as { id: string }[]).map((x) => x.id);

    // La facturation (portée entreprise) ouvre la caisse de l'entreprise et celles des deux agences
    const company = (await open(billing, {})).body;
    const sessionX = (await open(billing, { agencyId: aX.id })).body;
    const sessionY = (await open(billing, { agencyId: aY.id })).body;
    for (const s of [company, sessionX, sessionY]) expect(s.id).toBeDefined();

    // Le responsable de l'agence X ne voit que la caisse X
    expect(await list(manager)).toEqual([sessionX.id]);
    expect((await list(billing)).sort()).toEqual([company.id, sessionX.id, sessionY.id].sort());

    // Il ne clôture ni la caisse d'une autre agence, ni celle de l'entreprise
    for (const other of [sessionY, company]) {
      const res = await close(manager, other.id);
      expect([res.status, res.body?.error?.code]).toEqual([403, 'FORBIDDEN']);
    }
    for (const id of [sessionY.id, company.id]) expect((await t.admin.cashSession.findUniqueOrThrow({ where: { id } })).closedAt).toBeNull();

    // Il clôture la sienne ; la facturation clôture les autres
    expect((await close(manager, sessionX.id)).status).toBe(200);
    expect((await close(billing, sessionY.id)).status).toBe(200);
    expect((await close(billing, company.id)).status).toBe(200);

    // Un responsable d'agence d'une AUTRE agence n'a aucun accès à la caisse de X (ouverture refusée)
    const managerY = await as('AGENCY_MANAGER', { type: 'AGENCY', id: aY.id });
    expect((await open(managerY, { agencyId: aX.id })).status).toBe(403);
    expect((await open(managerY, { agencyId: aY.id })).status).toBe(201);
  }, 120_000);
});
