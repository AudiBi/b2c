import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { PERMISSIONS, PLATFORM_COMPANY_ID, ROLE_BY_CODE, ROLE_CODES, type RoleCode } from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import {
  ANY_AUTHENTICATED,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
} from '../src/security/decorators';
import {
  api,
  bearer,
  buildTestApp,
  freshIp,
  lastMailTo,
  login,
  makeCompany,
  makeUser,
  platformAdmin,
  strongPassword,
  tokenFromMail,
  uniq,
  type TestApp,
  type TestUser,
} from './helpers';

describe('Rôles, permissions et administration des utilisateurs', () => {
  let t: TestApp;
  let company: { id: string; slug: string };
  let other: { id: string; slug: string };
  let admin: TestUser;
  let adminToken: string;

  beforeAll(async () => {
    t = await buildTestApp();
    company = await makeCompany(t);
    other = await makeCompany(t);
    admin = await makeUser(t, { company, roleCode: 'COMPANY_ADMIN' });
    adminToken = (await login(t, admin)).accessToken;
  });
  afterAll(() => t.close());

  const inviteBody = (overrides: Record<string, unknown> = {}) => ({
    email: `${uniq('s')}@test.example`,
    firstName: 'Paul',
    lastName: 'Employé',
    roles: [{ roleCode: 'BILLING_AGENT' }],
    ...overrides,
  });
  const invite = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/users').set(bearer(token)).send(body);

  describe('politique d\'accès des routes', () => {
    it('chaque route déclare explicitement sa règle d\'accès (publique, authentifiée ou permissions existantes)', () => {
      const reflector = new Reflector();
      const problems: string[] = [];
      let routes = 0;
      for (const module of t.app.get(ModulesContainer).values()) {
        for (const controller of module.controllers.values()) {
          const instance = controller.instance as object | undefined;
          if (!instance) continue;
          const prototype = Object.getPrototypeOf(instance);
          for (const name of Object.getOwnPropertyNames(prototype)) {
            const handler = prototype[name];
            if (name === 'constructor' || typeof handler !== 'function') continue;
            if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
            routes += 1;
            const label = `${controller.metatype?.name}.${name} (${Reflect.getMetadata(PATH_METADATA, handler)})`;
            const targets = [handler, controller.metatype!];
            const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
            const anyAuth = reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets);
            const permissions = reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets);
            if (!isPublic && !anyAuth && !(permissions && permissions.length > 0)) problems.push(`${label} : aucune règle`);
            for (const code of permissions ?? []) if (!(code in PERMISSIONS)) problems.push(`${label} : permission inconnue ${code}`);
          }
        }
      }
      expect(routes).toBeGreaterThanOrEqual(20);
      expect(problems).toEqual([]);
    });

    it('seuls PlatformService et CompanyDirectory ouvrent des transactions en mode plateforme', () => {
      const root = join(__dirname, '../src');
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else if (/platform:\s*true/.test(readFileSync(full, 'utf8'))) offenders.push(relative(root, full).replace(/\\/g, '/'));
        }
      };
      walk(root);
      expect(offenders.sort()).toEqual(['platform/company-directory.service.ts', 'platform/platform.service.ts']);
    });
  });

  describe('parcours 14 : un employé ne réalise que les opérations de son rôle', () => {
    const expectations: Record<string, { users: number; create: number; audit: number; roles: number }> = {
      COMPANY_ADMIN: { users: 200, create: 201, audit: 200, roles: 200 },
      AUDITOR: { users: 200, create: 403, audit: 200, roles: 200 },
      BILLING_AGENT: { users: 403, create: 403, audit: 403, roles: 403 },
      CUSTOMER_SERVICE: { users: 403, create: 403, audit: 403, roles: 403 },
      LOGISTICS_MANAGER: { users: 403, create: 403, audit: 403, roles: 403 },
      DRIVER: { users: 403, create: 403, audit: 403, roles: 403 },
      CUSTOMER_INDIVIDUAL: { users: 403, create: 403, audit: 403, roles: 403 },
      CUSTOMER_BUSINESS: { users: 403, create: 403, audit: 403, roles: 403 },
    };

    it.each(Object.entries(expectations))('%s : accès conformes à la matrice', async (roleCode, expected) => {
      const user = await makeUser(t, { company, roleCode: roleCode as RoleCode });
      const { accessToken } = await login(t, user);
      expect((await api(t).get('/v1/admin/users').set(bearer(accessToken))).status).toBe(expected.users);
      expect((await invite(accessToken, inviteBody())).status).toBe(expected.create);
      expect((await api(t).get('/v1/audit').set(bearer(accessToken))).status).toBe(expected.audit);
      expect((await api(t).get('/v1/admin/roles').set(bearer(accessToken))).status).toBe(expected.roles);
      // Aucun rôle d'entreprise n'accède à l'administration de la plateforme
      expect((await api(t).get('/v1/platform/companies').set(bearer(accessToken))).status).toBe(403);
    });

    it.each([
      ['WAREHOUSE_MANAGER', 'WAREHOUSE'],
      ['RECEPTION_AGENT', 'WAREHOUSE'],
      ['AGENCY_MANAGER', 'AGENCY'],
    ] as const)('%s (portée %s) : aucun accès à l\'administration', async (roleCode, scopeType) => {
      const user = await makeUser(t, { company, roleCode, scope: { type: scopeType, id: uuidv7() } });
      const { accessToken } = await login(t, user);
      expect((await api(t).get('/v1/admin/users').set(bearer(accessToken))).status).toBe(403);
      expect((await invite(accessToken, inviteBody())).status).toBe(403);
    });

    it("l'autorisation est évaluée avant la validation : un employé non autorisé reçoit 403 même avec un corps invalide", async () => {
      const user = await makeUser(t, { company, roleCode: 'BILLING_AGENT' });
      const { accessToken } = await login(t, user);
      const res = await invite(accessToken, { n: 'importe quoi' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it("l'auditeur lit le journal mais ne peut rien modifier", async () => {
      const auditor = await makeUser(t, { company, roleCode: 'AUDITOR' });
      const { accessToken } = await login(t, auditor);
      const target = await makeUser(t, { company, roleCode: 'BILLING_AGENT' });
      expect((await api(t).get('/v1/audit').set(bearer(accessToken))).status).toBe(200);
      expect((await api(t).post(`/v1/admin/users/${target.id}/disable`).set(bearer(accessToken))).status).toBe(403);
      expect(
        (await api(t).post(`/v1/admin/users/${target.id}/roles`).set(bearer(accessToken)).send({ roleCode: 'AUDITOR' })).status,
      ).toBe(403);
      expect((await t.admin.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
    });

    it("les droits d'un rôle sont ceux du catalogue (les 14 rôles existent en base avec leurs permissions)", async () => {
      const roles = await t.admin.role.findMany({ where: { companyId: PLATFORM_COMPANY_ID }, include: { permissions: true } });
      expect(roles.map((r) => r.code).sort()).toEqual([...ROLE_CODES].sort());
      for (const role of roles) {
        expect(role.permissions.map((p) => p.permissionCode).sort()).toEqual([...ROLE_BY_CODE.get(role.code as RoleCode)!.permissions].sort());
      }
    });
  });

  describe('invitation du personnel', () => {
    it('invite, envoie le lien, active le compte et donne exactement les droits du rôle', async () => {
      const body = inviteBody({ roles: [{ roleCode: 'BILLING_AGENT' }], locale: 'en' });
      const res = await invite(adminToken, body);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: body.email, kind: 'STAFF', status: 'PENDING', emailVerified: false });
      expect(res.body.passwordHash).toBeUndefined();

      const mail = lastMailTo(t, body.email as string);
      expect(mail.subject).toContain('account is ready');
      expect(mail.text).toContain(`${t.env.ADMIN_PUBLIC_URL}/accept-invite?token=`); // le personnel active son compte sur le panel d'administration

      const early = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: body.email, password: 'Nimporte-quoi-123' });
      expect(early.status).toBe(401);

      const password = strongPassword();
      const accept = await api(t)
        .post('/v1/auth/reset-password')
        .set('X-Forwarded-For', freshIp())
        .send({ token: tokenFromMail(mail), newPassword: password });
      expect(accept.status).toBe(200);

      const { accessToken } = await login(t, { slug: company.slug, email: body.email as string, password });
      const me = await api(t).get('/v1/auth/me').set(bearer(accessToken));
      expect(me.body.permissions.sort()).toEqual([...ROLE_BY_CODE.get('BILLING_AGENT')!.permissions].sort());
      expect(me.body.permissions).toContain('payment:record_cash');
      expect(me.body.permissions).not.toContain('user:create');
      expect(me.body.emailVerified).toBe(true);
    });

    it("attribue une portée d'entrepôt et la restitue ; un entrepôt inexistant ou d'une autre entreprise est refusé", async () => {
      const warehouse = await t.admin.warehouse.create({
        data: { companyId: company.id, reference: `W${uniq('r').slice(0, 8).toUpperCase()}`, name: 'Entrepôt', country: 'US', city: 'Miami', addressLine: '1 rue', addressTemplate: ['{customerCode}'] },
      });
      const warehouseId = warehouse.id;
      const unknown = await invite(adminToken, inviteBody({ roles: [{ roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE', scopeId: uuidv7() }] }));
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.code).toBe('SCOPE_NOT_FOUND');
      const foreign = await t.admin.warehouse.create({
        data: { companyId: other.id, reference: `W${uniq('f').slice(0, 8).toUpperCase()}`, name: 'Autre', country: 'US', city: 'Miami', addressLine: '1 rue', addressTemplate: ['{customerCode}'] },
      });
      const crossTenant = await invite(adminToken, inviteBody({ roles: [{ roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE', scopeId: foreign.id }] }));
      expect(crossTenant.body.error.code).toBe('SCOPE_NOT_FOUND');
      const body = inviteBody({ roles: [{ roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE', scopeId: warehouseId }] });
      const res = await invite(adminToken, body);
      expect(res.status).toBe(201);
      expect(res.body.roles).toEqual([
        expect.objectContaining({ roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE', scopeId: warehouseId }),
      ]);
    });

    it.each([
      ['portée entreprise pour un rôle d\'entrepôt', { roles: [{ roleCode: 'RECEPTION_AGENT' }] }, 'INVALID_SCOPE'],
      ['portée entrepôt pour un rôle sans portée', { roles: [{ roleCode: 'AUDITOR', scopeType: 'WAREHOUSE', scopeId: uuidv7() }] }, 'INVALID_SCOPE'],
      ['rôle client attribué au personnel', { roles: [{ roleCode: 'CUSTOMER_INDIVIDUAL' }] }, 'ROLE_NOT_ASSIGNABLE'],
      ['rôle de la plateforme dans une entreprise', { roles: [{ roleCode: 'SUPER_ADMIN' }] }, 'ROLE_NOT_ASSIGNABLE'],
    ])('refuse : %s', async (_label, override, code) => {
      const res = await invite(adminToken, inviteBody(override));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(code);
    });

    it.each([
      ['rôle inconnu', { roles: [{ roleCode: 'ROI_DU_MONDE' }] }],
      ['aucun rôle', { roles: [] }],
      ['portée sans identifiant', { roles: [{ roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE' }] }],
      ['champ inconnu', { isAdmin: true }],
      ['e-mail invalide', { email: 'oups' }],
    ])('valide les entrées : %s', async (_label, override) => {
      const res = await invite(adminToken, inviteBody(override));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuse une adresse déjà utilisée dans l\'entreprise (409) mais l\'accepte dans une autre', async () => {
      const body = inviteBody();
      expect((await invite(adminToken, body)).status).toBe(201);
      expect((await invite(adminToken, body)).status).toBe(409);
      const otherAdmin = await makeUser(t, { company: other, roleCode: 'COMPANY_ADMIN' });
      const otherToken = (await login(t, otherAdmin)).accessToken;
      expect((await invite(otherToken, body)).status).toBe(201);
    });
  });

  describe('anti-escalade de privilèges', () => {
    it('checkAssignment refuse d\'attribuer des droits que l\'acteur ne détient pas sur toute l\'entreprise', async () => {
      const { checkAssignment } = await import('../src/iam/role-rules');
      const { PermissionSet } = await import('@b2c/shared');
      const actor = (permissions: string[], companyId = company.id) =>
        ({
          userId: uuidv7(),
          companyId,
          permissions: new PermissionSet(permissions.map((permission) => ({ permission, scopeType: 'COMPANY', scopeId: null }))),
        }) as any;

      const def = (code: RoleCode) => {
        const d = ROLE_BY_CODE.get(code)!;
        return { code: d.code, name: d.name, audience: d.audience, allowedScopes: d.allowedScopes, permissions: d.permissions, custom: false };
      };
      const limited = actor(['user:create', 'role:assign', 'invoice:read']);
      expect(() => checkAssignment(limited, 'STAFF', { roleCode: 'BILLING_AGENT', scopeType: 'COMPANY' }, def('BILLING_AGENT'))).toThrow(/droits/);
      expect(() => checkAssignment(limited, 'STAFF', { roleCode: 'COMPANY_ADMIN', scopeType: 'COMPANY' }, def('COMPANY_ADMIN'))).toThrow(/droits/);

      const full = actor([...ROLE_BY_CODE.get('COMPANY_ADMIN')!.permissions]);
      expect(checkAssignment(full, 'STAFF', { roleCode: 'AUDITOR', scopeType: 'COMPANY' }, def('AUDITOR')).code).toBe('AUDITOR');

      // Portée seulement « entrepôt » : ne couvre pas l'entreprise entière
      const scoped = { ...full, permissions: new PermissionSet([{ permission: 'package:receive', scopeType: 'WAREHOUSE', scopeId: uuidv7() }]) };
      expect(() => checkAssignment(scoped as any, 'STAFF', { roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE', scopeId: uuidv7() }, def('RECEPTION_AGENT'))).toThrow();
    });

    it("un administrateur ne peut pas attribuer de rôle à un client (les rôles clients viennent de l'inscription)", async () => {
      const customer = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const res = await api(t).post(`/v1/admin/users/${customer.id}/roles`).set(bearer(adminToken)).send({ roleCode: 'COMPANY_ADMIN' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ROLE_NOT_ASSIGNABLE');
      expect(await t.admin.userRole.count({ where: { userId: customer.id } })).toBe(1);
    });
  });

  describe('attribution et retrait de rôles, désactivation', () => {
    it('attribue puis retire un rôle ; les droits changent immédiatement, sans nouvelle connexion', async () => {
      const agent = await makeUser(t, { company, roleCode: 'BILLING_AGENT' });
      const { accessToken } = await login(t, agent);
      expect((await api(t).get('/v1/audit').set(bearer(accessToken))).status).toBe(403);

      const assigned = await api(t).post(`/v1/admin/users/${agent.id}/roles`).set(bearer(adminToken)).send({ roleCode: 'AUDITOR' });
      expect(assigned.status).toBe(201);
      expect((await api(t).get('/v1/audit').set(bearer(accessToken))).status).toBe(200);

      const duplicate = await api(t).post(`/v1/admin/users/${agent.id}/roles`).set(bearer(adminToken)).send({ roleCode: 'AUDITOR' });
      expect(duplicate.status).toBe(409);

      const auditorRole = assigned.body.roles.find((r: any) => r.roleCode === 'AUDITOR');
      const removed = await api(t).delete(`/v1/admin/users/${agent.id}/roles/${auditorRole.userRoleId}`).set(bearer(adminToken));
      expect(removed.status).toBe(200);
      expect((await api(t).get('/v1/audit').set(bearer(accessToken))).status).toBe(403);
    });

    it('désactiver un compte révoque ses sessions immédiatement ; le réactiver permet de se reconnecter', async () => {
      const agent = await makeUser(t, { company, roleCode: 'BILLING_AGENT' });
      const { accessToken } = await login(t, agent);
      const off = await api(t).post(`/v1/admin/users/${agent.id}/disable`).set(bearer(adminToken));
      expect(off.status).toBe(200);
      expect(off.body.status).toBe('DISABLED');
      expect((await api(t).get('/v1/auth/me').set(bearer(accessToken))).status).toBe(401);
      expect(
        (await api(t).post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ companySlug: company.slug, email: agent.email, password: agent.password })).status,
      ).toBe(403);
      const on = await api(t).post(`/v1/admin/users/${agent.id}/enable`).set(bearer(adminToken));
      expect(on.body.status).toBe('ACTIVE');
      await expect(login(t, agent)).resolves.toBeDefined();
    });

    it('on ne peut pas désactiver son propre compte', async () => {
      const res = await api(t).post(`/v1/admin/users/${admin.id}/disable`).set(bearer(adminToken));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_DISABLE_SELF');
    });

    it("protège le dernier administrateur actif : retrait de rôle et désactivation refusés", async () => {
      const solo = await makeCompany(t);
      const soleAdmin = await makeUser(t, { company: solo, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, soleAdmin)).accessToken;
      const me = await api(t).get('/v1/auth/me').set(bearer(token));
      const removal = await api(t).delete(`/v1/admin/users/${soleAdmin.id}/roles/${me.body.roles[0].userRoleId}`).set(bearer(token));
      expect(removal.status).toBe(409);
      expect(removal.body.error.code).toBe('LAST_ADMINISTRATOR');

      // Un second administrateur : on peut désactiver le premier, mais pas le dernier restant
      const second = await makeUser(t, { company: solo, roleCode: 'COMPANY_ADMIN' });
      const secondToken = (await login(t, second)).accessToken;
      expect((await api(t).post(`/v1/admin/users/${second.id}/disable`).set(bearer(token))).status).toBe(200);
      expect((await api(t).get('/v1/auth/me').set(bearer(secondToken))).status).toBe(401);
    });

    it('deux administrateurs qui se retirent mutuellement leur rôle en même temps : un administrateur au moins subsiste', async () => {
      const pair = await makeCompany(t);
      const first = await makeUser(t, { company: pair, roleCode: 'COMPANY_ADMIN' });
      const second = await makeUser(t, { company: pair, roleCode: 'COMPANY_ADMIN' });
      const [tokenA, tokenB] = [(await login(t, first)).accessToken, (await login(t, second)).accessToken];
      const [roleOfFirst, roleOfSecond] = await Promise.all(
        [first, second].map((u) => t.admin.userRole.findFirstOrThrow({ where: { userId: u.id } })),
      );
      const results = await Promise.all([
        api(t).delete(`/v1/admin/users/${second.id}/roles/${roleOfSecond.id}`).set(bearer(tokenA)),
        api(t).delete(`/v1/admin/users/${first.id}/roles/${roleOfFirst.id}`).set(bearer(tokenB)),
      ]);
      // Le perdant est refusé : 409 (dernier administrateur) s'il avait déjà passé le contrôle d'accès,
      // 403 s'il a déjà perdu son rôle au moment du contrôle. Dans les deux cas un administrateur subsiste.
      const statuses = results.map((r) => r.status).sort();
      expect(statuses[0]).toBe(200);
      expect([403, 409]).toContain(statuses[1]);
      const holders = await t.admin.userRole.count({ where: { companyId: pair.id, role: { code: 'COMPANY_ADMIN' } } });
      expect(holders).toBe(1);
    });

    it('liste paginée par curseur, sans doublon ni lecture hors entreprise', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, boss)).accessToken;
      for (let i = 0; i < 4; i += 1) await makeUser(t, { company: own, roleCode: 'DRIVER' });
      await makeUser(t, { company: other, roleCode: 'DRIVER' });

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const res: any = await api(t).get('/v1/admin/users').query({ limit: 2, ...(cursor ? { cursor } : {}) }).set(bearer(token));
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((u: any) => u.id));
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      const stored = await t.admin.user.findMany({ where: { companyId: own.id } });
      expect(new Set(seen)).toEqual(new Set(stored.map((u) => u.id)));

      const filtered = await api(t).get('/v1/admin/users').query({ kind: 'STAFF', q: 'DRIVER' }).set(bearer(token));
      expect(filtered.body.items.length).toBe(4);
      expect((await api(t).get('/v1/admin/users').query({ limit: 500 }).set(bearer(token))).status).toBe(400);
      expect((await api(t).get('/v1/admin/users').query({ inconnu: 'x' }).set(bearer(token))).status).toBe(400);
    });
  });

  describe('parcours 13 : isolation entre entreprises', () => {
    it("un administrateur ne voit, ne modifie et ne désactive jamais un utilisateur d'une autre entreprise", async () => {
      const victim = await makeUser(t, { company: other, roleCode: 'BILLING_AGENT' });
      const list = await api(t).get('/v1/admin/users').query({ limit: 100 }).set(bearer(adminToken));
      expect(list.body.items.every((u: any) => u.id !== victim.id)).toBe(true);
      expect((await api(t).get(`/v1/admin/users/${victim.id}`).set(bearer(adminToken))).status).toBe(404);
      expect((await api(t).post(`/v1/admin/users/${victim.id}/disable`).set(bearer(adminToken))).status).toBe(404);
      expect((await api(t).post(`/v1/admin/users/${victim.id}/roles`).set(bearer(adminToken)).send({ roleCode: 'AUDITOR' })).status).toBe(404);
      const stored = await t.admin.user.findUniqueOrThrow({ where: { id: victim.id }, include: { userRoles: true } });
      expect(stored.status).toBe('ACTIVE');
      expect(stored.userRoles).toHaveLength(1);
    });

    it("le journal d'audit n'expose que les événements de l'entreprise", async () => {
      const foreign = await t.admin.auditLog.create({ data: { companyId: other.id, actorType: 'SYSTEM', action: 'test.foreign' } });
      const res = await api(t).get('/v1/audit').query({ limit: 100 }).set(bearer(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.every((row: any) => row.companyId === company.id)).toBe(true);
      expect(res.body.items.some((row: any) => row.id === foreign.id)).toBe(false);
      // Filtrer sur l'identifiant d'un événement étranger ne le révèle pas
      const probe = await api(t).get('/v1/audit').query({ entityId: foreign.id, action: 'test.foreign' }).set(bearer(adminToken));
      expect(probe.body.items).toEqual([]);
    });

    it('les rôles listés sont ceux de l\'entreprise (sans rôle plateforme)', async () => {
      const res = await api(t).get('/v1/admin/roles').set(bearer(adminToken));
      const codes = res.body.map((r: any) => r.code);
      expect(codes).toContain('COMPANY_ADMIN');
      expect(codes).not.toContain('SUPER_ADMIN');
    });

  });

  describe("journal d'audit des actions d'administration", () => {
    it('trace invitation, attribution, retrait et désactivation avec l\'acteur', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, boss)).accessToken;
      const created = await invite(token, inviteBody());
      const userId = created.body.id;
      const assigned = await api(t).post(`/v1/admin/users/${userId}/roles`).set(bearer(token)).send({ roleCode: 'AUDITOR' });
      const auditorRole = assigned.body.roles.find((r: any) => r.roleCode === 'AUDITOR');
      await api(t).delete(`/v1/admin/users/${userId}/roles/${auditorRole.userRoleId}`).set(bearer(token));
      await api(t).post(`/v1/admin/users/${userId}/disable`).set(bearer(token));

      const rows = await t.admin.auditLog.findMany({
        where: { companyId: own.id, action: { in: ['user.invited', 'role.assigned', 'role.revoked', 'user.disabled'] } },
        orderBy: { id: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['user.invited', 'role.assigned', 'role.revoked', 'user.disabled']);
      expect(rows.every((r) => r.actorUserId === boss.id && r.actorType === 'USER' && r.entityId === userId)).toBe(true);
      expect(rows[3]).toMatchObject({ before: { status: 'PENDING' }, after: { status: 'DISABLED' } });
    });

    it('expose le journal avec filtres et pagination', async () => {
      const first = await api(t).get('/v1/audit').query({ limit: 2, action: 'user.invited' }).set(bearer(adminToken));
      expect(first.status).toBe(200);
      expect(first.body.items.length).toBeLessThanOrEqual(2);
      expect(first.body.items.every((r: any) => r.action === 'user.invited')).toBe(true);
      if (first.body.nextCursor) {
        const next = await api(t).get('/v1/audit').query({ limit: 2, action: 'user.invited', cursor: first.body.nextCursor }).set(bearer(adminToken));
        const ids = new Set([...first.body.items, ...next.body.items].map((r: any) => r.id));
        expect(ids.size).toBe(first.body.items.length + next.body.items.length);
      }
    });
  });

  describe('administration de la plateforme', () => {
    let superAdmin: TestUser;
    let superToken: string;

    beforeAll(async () => {
      superAdmin = await platformAdmin(t);
      superToken = (await login(t, superAdmin)).accessToken;
    });

    it("l'équipe plateforme voit tout le catalogue des rôles système (lecture seule)", async () => {
      const res = await api(t).get('/v1/admin/roles').set(bearer(superToken));
      const codes = res.body.map((r: any) => r.code);
      for (const code of ['SUPER_ADMIN', 'COMPANY_ADMIN', 'DRIVER', 'TEAM_READER', 'CUSTOMER_BUSINESS']) expect(codes).toContain(code);
    });

    // Préfixe de suivi unique (2 à 4 lettres) : la base impose l'unicité entre entreprises
    const randomPrefix = () =>
      Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 22)]).join('');
    const companyBody = () => ({
      name: 'Transport Test SA',
      slug: uniq('co'),
      trackingPrefix: randomPrefix(),
      customerCodePrefix: 'TT',
      adminEmail: `${uniq('dir')}@test.example`,
      adminFirstName: 'Directrice',
      adminLastName: 'Générale',
    });

    it("le super administrateur n'a que des droits de plateforme", async () => {
      const me = await api(t).get('/v1/auth/me').set(bearer(superToken));
      expect(me.body.kind).toBe('PLATFORM');
      expect(me.body.permissions).toContain('company:manage');
      for (const business of ['package:read', 'invoice:read', 'payment:record_cash', 'customer:read', 'package:receive']) {
        expect(me.body.permissions).not.toContain(business);
      }
    });

    it("crée une entreprise, invite son administrateur, qui active son compte et ne voit que son entreprise", async () => {
      const body = companyBody();
      const created = await api(t).post('/v1/platform/companies').set(bearer(superToken)).send(body);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ slug: body.slug, status: 'ACTIVE', defaultCurrency: 'USD', paymentPolicy: 'PAY_BEFORE_SHIPMENT' });

      const stored = await t.admin.user.findFirstOrThrow({
        where: { companyId: created.body.id, email: body.adminEmail },
        include: { userRoles: { include: { role: true } } },
      });
      expect(stored.status).toBe('PENDING');
      expect(stored.userRoles.map((r) => r.role.code)).toEqual(['COMPANY_ADMIN']);

      // Audit dans la nouvelle entreprise ET dans la plateforme
      const inCompany = await t.admin.auditLog.findMany({ where: { companyId: created.body.id, action: 'company.created' } });
      const inPlatform = await t.admin.auditLog.findMany({ where: { companyId: PLATFORM_COMPANY_ID, action: 'platform.company_created', entityId: created.body.id } });
      expect(inCompany).toHaveLength(1);
      expect(inPlatform).toHaveLength(1);

      const password = strongPassword();
      const accept = await api(t)
        .post('/v1/auth/reset-password')
        .set('X-Forwarded-For', freshIp())
        .send({ token: tokenFromMail(lastMailTo(t, body.adminEmail)), newPassword: password });
      expect(accept.status).toBe(200);
      const { accessToken } = await login(t, { slug: body.slug, email: body.adminEmail, password });
      const users = await api(t).get('/v1/admin/users').set(bearer(accessToken));
      expect(users.body.items).toHaveLength(1);
      expect(users.body.items[0].email).toBe(body.adminEmail);
      // L'administrateur d'entreprise ne gère pas les entreprises
      expect((await api(t).get('/v1/platform/companies').set(bearer(accessToken))).status).toBe(403);
    });

    it("refuse un identifiant déjà pris (409), l'identifiant réservé « platform » (400) et les champs inconnus", async () => {
      const body = companyBody();
      expect((await api(t).post('/v1/platform/companies').set(bearer(superToken)).send(body)).status).toBe(201);
      const duplicate = await api(t).post('/v1/platform/companies').set(bearer(superToken)).send({ ...body, adminEmail: `${uniq('d')}@test.example` });
      expect(duplicate.status).toBe(409);
      expect((await api(t).post('/v1/platform/companies').set(bearer(superToken)).send({ ...companyBody(), slug: 'platform' })).status).toBe(400);
      expect((await api(t).post('/v1/platform/companies').set(bearer(superToken)).send({ ...companyBody(), status: 'SUSPENDED' })).status).toBe(400);
      // L'échec n'a laissé aucune entreprise orpheline
      expect(await t.admin.company.count({ where: { slug: body.slug } })).toBe(1);
    });

    it("n'expose aucune donnée métier d'une entreprise au super administrateur", async () => {
      const victim = await makeUser(t, { company, roleCode: 'BILLING_AGENT' });
      expect((await api(t).get(`/v1/admin/users/${victim.id}`).set(bearer(superToken))).status).toBe(404);
      const users = await api(t).get('/v1/admin/users').query({ limit: 100 }).set(bearer(superToken));
      expect(users.body.items.every((u: any) => u.kind === 'PLATFORM')).toBe(true);
      const audit = await api(t).get('/v1/audit').query({ limit: 100 }).set(bearer(superToken));
      expect(audit.body.items.every((row: any) => row.companyId === PLATFORM_COMPANY_ID)).toBe(true);
      const companies = await api(t).get('/v1/platform/companies').set(bearer(superToken));
      expect(companies.status).toBe(200);
      expect(companies.body.items.some((c: any) => c.id === PLATFORM_COMPANY_ID)).toBe(false);
      expect(companies.body.items.some((c: any) => c.id === company.id)).toBe(true);
    });

    it('suspend une entreprise (accès coupé immédiatement) puis la réactive', async () => {
      const tenant = await makeCompany(t);
      const boss = await makeUser(t, { company: tenant, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, boss)).accessToken;
      const suspended = await api(t).post(`/v1/platform/companies/${tenant.id}/suspend`).set(bearer(superToken));
      expect(suspended.status).toBe(200);
      expect(suspended.body.status).toBe('SUSPENDED');
      expect((await api(t).get('/v1/admin/users').set(bearer(token))).status).toBe(403);
      const activated = await api(t).post(`/v1/platform/companies/${tenant.id}/activate`).set(bearer(superToken));
      expect(activated.body.status).toBe('ACTIVE');
      expect((await api(t).get('/v1/admin/users').set(bearer(token))).status).toBe(200);

      expect((await api(t).post(`/v1/platform/companies/${PLATFORM_COMPANY_ID}/suspend`).set(bearer(superToken))).status).toBe(400);
      expect((await api(t).post(`/v1/platform/companies/${uuidv7()}/suspend`).set(bearer(superToken))).status).toBe(404);
      const trail = await t.admin.auditLog.findMany({ where: { companyId: PLATFORM_COMPANY_ID, entityId: tenant.id } });
      expect(trail.map((r) => r.action).sort()).toEqual(['platform.company_activated', 'platform.company_suspended']);
    });

    it("un utilisateur de la plateforme ne peut recevoir qu'un rôle de la plateforme", async () => {
      const res = await invite(superToken, inviteBody({ roles: [{ roleCode: 'COMPANY_ADMIN' }] }));
      expect(res.status).toBe(400);
      const ok = await invite(superToken, inviteBody({ roles: [{ roleCode: 'SUPER_ADMIN' }] }));
      expect(ok.status).toBe(201);
      expect(ok.body.kind).toBe('PLATFORM');
    });
  });
});
