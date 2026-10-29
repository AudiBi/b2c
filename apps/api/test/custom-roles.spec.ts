import { api, bearer, buildTestApp, login, makeTenant, makeUser, makeWarehouse, uniq, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Rôles personnalisés', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const create = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/roles').set(bearer(token)).send(body);
  const patch = (token: string, code: string, body: Record<string, unknown>) => api(t).patch(`/v1/admin/roles/${code}`).set(bearer(token)).send(body);
  const remove = (token: string, code: string) => api(t).delete(`/v1/admin/roles/${code}`).set(bearer(token));
  const list = (token: string) => api(t).get('/v1/admin/roles').set(bearer(token));
  const assign = (token: string, userId: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/users/${userId}/roles`).set(bearer(token)).send(body);
  const roleName = () => `Rôle ${uniq('r')}`;

  /** Une entreprise, son administrateur, et un membre du personnel sans rôle utile. */
  async function setup() {
    const tenant = await makeTenant(t);
    const staff = await makeUser(t, { company: tenant.company, roleCode: 'AUDITOR' });
    // l'auditeur est retiré : on veut un compte sans aucun droit
    const detail = await api(t).get(`/v1/admin/users/${staff.id}`).set(bearer(tenant.token));
    for (const r of detail.body.roles) await api(t).delete(`/v1/admin/users/${staff.id}/roles/${r.userRoleId}`).set(bearer(tenant.token));
    return { ...tenant, staff };
  }

  describe('création et liste', () => {
    it('un administrateur crée un rôle : code généré, portée, droits triés, 0 titulaire ; la liste distingue système et personnalisé ; l’audit le dit', async () => {
      const w = await setup();
      const name = roleName();
      const res = await create(w.token, { name, description: 'Contrôle des colis', scopeType: 'COMPANY', permissions: ['package:read', 'invoice:read'] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name, description: 'Contrôle des colis', isSystem: false, custom: true, allowedScopes: ['COMPANY'], permissions: ['invoice:read', 'package:read'], holders: 0 });
      expect(res.body.code).toMatch(/^custom-[a-z0-9-]+$/);

      const roles = (await list(w.token)).body as { code: string; custom: boolean; isSystem: boolean }[];
      expect(roles.find((r) => r.code === res.body.code)).toMatchObject({ custom: true, isSystem: false });
      expect(roles.filter((r) => r.isSystem).length).toBeGreaterThanOrEqual(9);

      const audit = await t.admin.auditLog.findMany({ where: { companyId: w.company.id, action: 'role.created' } });
      expect(audit).toHaveLength(1);
      expect((audit[0].after as any).permissions).toEqual(['invoice:read', 'package:read']);
    });

    it('le code ne dépend pas des accents ni des caractères spéciaux du nom', async () => {
      const w = await setup();
      const res = await create(w.token, { name: `  Équipe « Été » & Co ${uniq('')}  `, permissions: ['package:read'] });
      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^custom-equipe-ete-co-[a-z0-9-]+$/);
    });

    it('validation : droit inconnu, droit de plateforme, droit de client, liste vide ou doublon, portée interdite, nom trop court, champ inconnu', async () => {
      const w = await setup();
      const bad = [
        { name: roleName(), permissions: ['inconnu:lire'] },
        { name: roleName(), permissions: ['company:manage'] },
        { name: roleName(), permissions: ['profile:read_own'] },
        { name: roleName(), permissions: [] },
        { name: roleName(), permissions: ['package:read', 'package:read'] },
        { name: roleName(), scopeType: 'ROUTE', permissions: ['package:read'] },
        { name: 'x', permissions: ['package:read'] },
        { name: roleName(), permissions: ['package:read'], isSystem: true },
      ];
      for (const body of bad) {
        const res = await create(w.token, body);
        expect(res.status).toBe(400);
        expect(errorCode(res)).toBe('VALIDATION_ERROR');
      }
    });

    it('le nom est unique dans l’entreprise (sans tenir compte de la casse) et ne peut pas reprendre celui d’un rôle système', async () => {
      const w = await setup();
      const name = roleName();
      expect((await create(w.token, { name, permissions: ['package:read'] })).status).toBe(201);
      const dup = await create(w.token, { name: name.toUpperCase(), permissions: ['package:read'] });
      expect(dup.status).toBe(409);
      expect(errorCode(dup)).toBe('ROLE_NAME_TAKEN');
      const system = await create(w.token, { name: 'Livreur', permissions: ['package:read'] });
      expect(errorCode(system)).toBe('ROLE_NAME_TAKEN');
      // une autre entreprise peut reprendre le même nom
      const other = await makeTenant(t);
      expect((await create(other.token, { name, permissions: ['package:read'] })).status).toBe(201);
    });

    it('droit « role:manage » exigé : un auditeur (lecture seule), un agent de réception et un client sont refusés ; sans session : 401', async () => {
      const w = await setup();
      for (const roleCode of ['AUDITOR', 'RECEPTION_AGENT', 'CUSTOMER_INDIVIDUAL'] as const) {
        const user = await makeUser(t, { company: w.company, roleCode });
        const token = (await login(t, user)).accessToken;
        expect((await create(token, { name: roleName(), permissions: ['package:read'] })).status).toBe(403);
      }
      expect((await api(t).post('/v1/admin/roles').send({})).status).toBe(401);
    });

    it('l’équipe plateforme ne crée pas de rôle personnalisé', async () => {
      const { platformAdmin } = await import('./helpers');
      const admin = await platformAdmin(t);
      const token = (await login(t, admin)).accessToken;
      const res = await create(token, { name: roleName(), permissions: ['package:read'] });
      expect([400, 403]).toContain(res.status);
    });
  });

  describe('anti-escalade', () => {
    it('on ne donne que des droits qu’on détient : un gestionnaire de rôles sans droit sur les factures ne peut pas créer un rôle qui les donne', async () => {
      const w = await setup();
      const manager = await create(w.token, { name: roleName(), permissions: ['role:read', 'role:manage', 'role:assign', 'user:read', 'package:read'] });
      expect((await assign(w.token, w.staff.id, { roleCode: manager.body.code, scopeType: 'COMPANY' })).status).toBe(201);
      const token = (await login(t, w.staff)).accessToken;

      const escalate = await create(token, { name: roleName(), permissions: ['package:read', 'invoice:read'] });
      expect(escalate.status).toBe(403);
      expect(errorCode(escalate)).toBe('PRIVILEGE_ESCALATION');
      const ok = await create(token, { name: roleName(), permissions: ['package:read'] });
      expect(ok.status).toBe(201);

      // il ne peut pas non plus ajouter un droit qu'il n'a pas à un rôle existant, ni modifier un rôle plus puissant que lui
      expect(errorCode(await patch(token, ok.body.code, { permissions: ['package:read', 'payment:read'] }))).toBe('PRIVILEGE_ESCALATION');
      const strong = await create(w.token, { name: roleName(), permissions: ['invoice:read', 'package:read'] });
      expect(errorCode(await patch(token, strong.body.code, { name: roleName() }))).toBe('PRIVILEGE_ESCALATION');
      expect(errorCode(await remove(token, strong.body.code))).toBe('PRIVILEGE_ESCALATION');
      // ni attribuer le rôle plus puissant
      expect(errorCode(await assign(token, w.staff.id, { roleCode: strong.body.code, scopeType: 'COMPANY' }))).toBe('PRIVILEGE_ESCALATION');
    });
  });

  describe('attribution et effet immédiat', () => {
    it('un rôle personnalisé donne exactement ses droits ; les modifier ou le retirer agit à la requête suivante', async () => {
      const w = await setup();
      const role = await create(w.token, { name: roleName(), permissions: ['warehouse:read'] });
      const token = (await login(t, w.staff)).accessToken;
      const warehouses = () => api(t).get('/v1/admin/warehouses').set(bearer(token));
      expect((await warehouses()).status).toBe(403); // aucun droit au départ

      const given = await assign(w.token, w.staff.id, { roleCode: role.body.code, scopeType: 'COMPANY' });
      expect(given.status).toBe(201);
      expect(given.body.roles).toHaveLength(1);
      expect((await warehouses()).status).toBe(200);
      expect((await list(w.token)).body.find((r: any) => r.code === role.body.code).holders).toBe(1);

      // retrait d'un droit : effet immédiat, même jeton d'accès
      expect((await patch(w.token, role.body.code, { permissions: ['package:read'] })).status).toBe(200);
      expect((await warehouses()).status).toBe(403);
      expect((await api(t).get('/v1/admin/packages').set(bearer(token))).status).toBe(200);
      // ajout d'un droit
      await patch(w.token, role.body.code, { permissions: ['package:read', 'warehouse:read'] });
      expect((await warehouses()).status).toBe(200);
      // retrait du rôle
      await api(t).delete(`/v1/admin/users/${w.staff.id}/roles/${given.body.roles[0].userRoleId}`).set(bearer(w.token));
      expect((await warehouses()).status).toBe(403);
    });

    it('modification : nom, description (effaçable) ; la portée ne change pas ; au moins un champ ; la modification est auditée', async () => {
      const w = await setup();
      const role = await create(w.token, { name: roleName(), description: 'Avant', scopeType: 'WAREHOUSE', permissions: ['package:read'] });
      const newName = roleName();
      const res = await patch(w.token, role.body.code, { name: newName, description: null });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: newName, description: null, allowedScopes: ['WAREHOUSE'], code: role.body.code });
      expect((await patch(w.token, role.body.code, {})).status).toBe(400);
      expect((await patch(w.token, role.body.code, { scopeType: 'COMPANY' })).status).toBe(400);
      const all = await t.admin.auditLog.findMany({ where: { companyId: w.company.id, action: 'role.updated' } });
      expect(all).toHaveLength(1);
      expect((all[0].before as any).name).toBe(role.body.name);
    });

    it('portée unique : un rôle « entrepôt » ne s’attribue que pour un entrepôt existant de l’entreprise, et ne donne des droits que sur lui', async () => {
      const w = await setup();
      const role = await create(w.token, { name: roleName(), scopeType: 'WAREHOUSE', permissions: ['package:read', 'package:receive', 'warehouse:read'] });
      const mine = await makeWarehouse(t, w.token);
      const theirs = await makeWarehouse(t, (await makeTenant(t)).token);

      const wrongScope = await assign(w.token, w.staff.id, { roleCode: role.body.code, scopeType: 'COMPANY' });
      expect(errorCode(wrongScope)).toBe('INVALID_SCOPE');
      const foreign = await assign(w.token, w.staff.id, { roleCode: role.body.code, scopeType: 'WAREHOUSE', scopeId: theirs.id });
      expect(errorCode(foreign)).toBe('SCOPE_NOT_FOUND');
      const missing = await assign(w.token, w.staff.id, { roleCode: role.body.code, scopeType: 'WAREHOUSE' });
      expect(missing.status).toBe(400);
      expect((await assign(w.token, w.staff.id, { roleCode: role.body.code, scopeType: 'WAREHOUSE', scopeId: mine.id })).status).toBe(201);
      expect(errorCode(await assign(w.token, w.staff.id, { roleCode: role.body.code, scopeType: 'WAREHOUSE', scopeId: mine.id }))).toBe('ROLE_ALREADY_ASSIGNED');

      // un second entrepôt de la même entreprise : aucun droit dessus
      const second = await makeWarehouse(t, w.token);
      const token = (await login(t, w.staff)).accessToken;
      const warehouses = (await api(t).get('/v1/admin/warehouses').set(bearer(token))).body.items.map((x: { id: string }) => x.id);
      expect(warehouses).toContain(mine.id);
      expect(warehouses).not.toContain(second.id);
    });

    it('invitation avec un rôle personnalisé', async () => {
      const w = await setup();
      const role = await create(w.token, { name: roleName(), permissions: ['package:read'] });
      const email = `${uniq('i')}@test.example`;
      const res = await api(t).post('/v1/admin/users').set(bearer(w.token)).send({ email, firstName: 'Paul', lastName: 'Pierre', locale: 'fr', roles: [{ roleCode: role.body.code, scopeType: 'COMPANY' }] });
      expect(res.status).toBe(201);
      expect(res.body.roles[0].roleCode).toBe(role.body.code);
      // un code personnalisé inconnu est refusé, sans créer de compte
      const unknown = await api(t).post('/v1/admin/users').set(bearer(w.token)).send({ email: `${uniq('j')}@test.example`, firstName: 'Paul', lastName: 'Pierre', locale: 'fr', roles: [{ roleCode: 'custom-inexistant-abc123', scopeType: 'COMPANY' }] });
      expect(unknown.status).toBe(400);
      expect(errorCode(unknown)).toBe('UNKNOWN_ROLE');
      expect(await t.admin.user.count({ where: { companyId: w.company.id, email: { startsWith: 'j' } } })).toBe(0);
    });
  });

  describe('suppression', () => {
    it('refusée tant que le rôle est attribué (ROLE_IN_USE), puis acceptée ; le rôle disparaît de la liste', async () => {
      const w = await setup();
      const role = await create(w.token, { name: roleName(), permissions: ['package:read'] });
      const given = await assign(w.token, w.staff.id, { roleCode: role.body.code, scopeType: 'COMPANY' });
      const refused = await remove(w.token, role.body.code);
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('ROLE_IN_USE');
      await api(t).delete(`/v1/admin/users/${w.staff.id}/roles/${given.body.roles[0].userRoleId}`).set(bearer(w.token));
      expect((await remove(w.token, role.body.code)).status).toBe(204);
      expect((await list(w.token)).body.find((r: any) => r.code === role.body.code)).toBeUndefined();
      expect(errorCode(await remove(w.token, role.body.code))).toBe('ROLE_NOT_FOUND');
      expect(await t.admin.rolePermission.count({ where: { role: { code: role.body.code } } })).toBe(0);
      expect((await t.admin.auditLog.findMany({ where: { companyId: w.company.id, action: 'role.deleted' } }))).toHaveLength(1);
    });
  });

  describe('isolation entre entreprises et rôles système', () => {
    it('un rôle personnalisé n’existe que dans son entreprise : invisible, introuvable et inattribuable ailleurs', async () => {
      const a = await setup();
      const b = await setup();
      const role = await create(a.token, { name: roleName(), permissions: ['package:read'] });
      expect((await list(b.token)).body.find((r: any) => r.code === role.body.code)).toBeUndefined();
      expect(errorCode(await patch(b.token, role.body.code, { name: roleName() }))).toBe('ROLE_NOT_FOUND');
      expect(errorCode(await remove(b.token, role.body.code))).toBe('ROLE_NOT_FOUND');
      expect(errorCode(await assign(b.token, b.staff.id, { roleCode: role.body.code, scopeType: 'COMPANY' }))).toBe('UNKNOWN_ROLE');
    });

    it('les rôles système ne se modifient ni ne se suppriment par l’API (code refusé) ni par la base (déclencheurs)', async () => {
      const w = await setup();
      expect((await patch(w.token, 'COMPANY_ADMIN', { name: 'Pirate' })).status).toBe(400);
      expect((await remove(w.token, 'DRIVER')).status).toBe(400);
      const system = await t.admin.role.findFirstOrThrow({ where: { code: 'DRIVER', isSystem: true } });
      await expect(t.admin.role.delete({ where: { id: system.id } })).rejects.toThrow(/système/);
      await expect(t.admin.role.update({ where: { id: system.id }, data: { code: 'AUTRE' } })).rejects.toThrow();
    });

    it('la base refuse un rôle personnalisé sans code « custom- », un code « custom- » système, et un changement de portée', async () => {
      const w = await setup();
      const base = { companyId: w.company.id, name: roleName() };
      await expect(t.admin.role.create({ data: { ...base, code: 'MON_ROLE', isSystem: false } })).rejects.toThrow();
      await expect(t.admin.role.create({ data: { ...base, code: 'custom-x-abc123', isSystem: true } })).rejects.toThrow();
      await expect(t.admin.role.create({ data: { ...base, code: 'custom-y-abc123', isSystem: false, scopeType: 'ROUTE' } })).rejects.toThrow();
      const ok = await t.admin.role.create({ data: { ...base, code: 'custom-z-abc123', isSystem: false } });
      await expect(t.admin.role.update({ where: { id: ok.id }, data: { scopeType: 'AGENCY' } })).rejects.toThrow(/portée/);
      await expect(t.admin.role.update({ where: { id: ok.id }, data: { code: 'custom-w-abc123' } })).rejects.toThrow(/identité/);
    });
  });
});
