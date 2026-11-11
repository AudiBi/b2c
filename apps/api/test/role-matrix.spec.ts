import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { ROLE_DEFINITIONS, type RoleCode } from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import { ANY_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../src/security/decorators';
import { api, bearer, buildTestApp, login, makeCompany, makeUser, platformAdmin, type TestApp } from './helpers';

/**
 * Matrice rôles × routes. Pour CHAQUE route protégée par permission et CHAQUE rôle système :
 *  - le rôle n'a pas toutes les permissions requises → la réponse DOIT être 403 FORBIDDEN ;
 *  - le rôle les a toutes → la garde de permissions laisse passer (ni 401, ni 403 FORBIDDEN) et aucune erreur serveur (5xx).
 * Les requêtes autorisées sont envoyées avec des identifiants inexistants et un corps vide : elles échouent en 400/404, sans effet.
 * Pour écrire le tableau lisible dans docs/ROLE_MATRIX.md : ROLE_MATRIX_OUT=1 npm -w @b2c/api test -- role-matrix
 */

interface RouteInfo {
  label: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  permissions: string[];
}

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
          const path = joinPath('v1', Reflect.getMetadata(PATH_METADATA, controller.metatype!), Reflect.getMetadata(PATH_METADATA, handler)).replace(
            /:[A-Za-z0-9_]+/g,
            () => uuidv7(),
          );
          const label = `${method.toUpperCase()} ${joinPath('v1', Reflect.getMetadata(PATH_METADATA, controller.metatype!), Reflect.getMetadata(PATH_METADATA, handler))}`;
          const info: RouteInfo = { label, method, path, permissions: [] };
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

  it("chaque rôle : refusé (403) là où il lui manque une permission, jamais bloqué par la garde là où il les a toutes", async () => {
    const failures: string[] = [];
    const serverErrors: string[] = [];
    const matrix = new Map<string, Map<RoleCode, '✔' | '·' | '◐'>>();

    for (const role of ROLE_DEFINITIONS) {
      const granted = new Set<string>(role.permissions);
      // Rôle limité à un entrepôt / une agence : la garde l'admet, puis le service refuse (403) tout ce qui sort de sa portée
      // (ici, un identifiant tiré au hasard). C'est un second niveau de contrôle voulu, signalé « ◐ » dans le tableau.
      const scoped = role.allowedScopes[0] !== 'COMPANY';
      const token = tokens.get(role.code)!;
      for (const route of routes) {
        const allowed = route.permissions.every((permission) => granted.has(permission));
        const res = await api(t)[route.method](route.path).set(bearer(token)).send({});
        const code = res.body?.error?.code as string | undefined;
        if (!matrix.has(route.label)) matrix.set(route.label, new Map());
        const scopeLimited = allowed && scoped && res.status === 403 && code === 'FORBIDDEN';
        matrix.get(route.label)!.set(role.code, !allowed ? '·' : scopeLimited ? '◐' : '✔');

        if (!allowed) {
          if (res.status !== 403 || code !== 'FORBIDDEN') failures.push(`${role.code} ne devrait PAS accéder à ${route.label} [${route.permissions}] → ${res.status} ${code ?? ''}`);
        } else {
          if (res.status === 401 || (!scopeLimited && res.status === 403 && ['FORBIDDEN', 'ROUTE_NOT_CONFIGURED', 'TOTP_ENROLLMENT_REQUIRED'].includes(code ?? ''))) {
            failures.push(`${role.code} devrait accéder à ${route.label} [${route.permissions}] → ${res.status} ${code ?? ''}`);
          }
          if (res.status >= 500) serverErrors.push(`${role.code} ${route.label} → ${res.status}`);
        }
      }
    }

    if (process.env.ROLE_MATRIX_OUT) {
      const roles = ROLE_DEFINITIONS.map((r) => r.code);
      const lines = [
        '# Matrice rôles × routes',
        '',
        'Générée par `apps/api/test/role-matrix.spec.ts` (`ROLE_MATRIX_OUT=1`). ✔ = autorisé, · = refusé (403), ◐ = autorisé par le rôle mais limité à son entrepôt / son agence / sa caisse (la garde l’admet, le service refuse hors portée). Chaque case a été **vérifiée** contre l’API en marche, pas seulement déduite du catalogue.',
        'Les routes ouvertes à tout utilisateur connecté (profil, déconnexion…) et les routes publiques n’y figurent pas.',
        '',
        `| Route | Permissions | ${roles.join(' | ')} |`,
        `|---|---|${roles.map(() => ':-:').join('|')}|`,
        ...routes.map((route) => `| \`${route.label}\` | ${route.permissions.join(', ')} | ${roles.map((r) => matrix.get(route.label)!.get(r)).join(' | ')} |`),
        '',
      ];
      const dir = join(__dirname, '../../../docs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'ROLE_MATRIX.md'), lines.join('\n'));
    }

    expect(failures).toEqual([]);
    expect(serverErrors).toEqual([]);
  }, 600_000);
});
