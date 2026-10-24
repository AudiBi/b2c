import { PrismaClient } from '@prisma/client';
import { PLATFORM_COMPANY_ID } from '@b2c/shared';
import { buildTestApp, makeCompany, makeUser, type TestApp } from './helpers';

/**
 * Isolation des entreprises AU NIVEAU DE LA BASE (Row-Level Security), indépendamment du code applicatif.
 * `t.db` utilise le rôle applicatif ; `t.admin` le rôle de migration (pour préparer et vérifier).
 */
describe('Row-Level Security', () => {
  let t: TestApp;
  let companyA: { id: string; slug: string };
  let companyB: { id: string; slug: string };
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let rawApp: PrismaClient;

  beforeAll(async () => {
    t = await buildTestApp();
    companyA = await makeCompany(t);
    companyB = await makeCompany(t);
    userA = await makeUser(t, { company: companyA, roleCode: 'COMPANY_ADMIN' });
    userB = await makeUser(t, { company: companyB, roleCode: 'COMPANY_ADMIN' });
    // Client « brut » du rôle applicatif, sans passer par DbService (donc sans contexte d'entreprise)
    rawApp = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  });

  afterAll(async () => {
    await rawApp.$disconnect();
    await t.close();
  });

  it("le rôle applicatif n'est ni superutilisateur ni BYPASSRLS, et ne possède aucune table", async () => {
    const [role] = await rawApp.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }[]>`
      SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user`;
    expect(role.current_user).toBe('b2c_app');
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    const owned = await rawApp.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(Number(owned[0].n)).toBe(0);
  });

  it('RLS est activée et forcée sur toutes les tables portant company_id', async () => {
    const rows = await t.admin.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' AND c.relname <> 'permissions'`;
    expect(rows.length).toBeGreaterThanOrEqual(11);
    for (const row of rows) {
      expect({ table: row.relname, rls: row.relrowsecurity, forced: row.relforcerowsecurity }).toEqual({
        table: row.relname,
        rls: true,
        forced: true,
      });
    }
  });

  it('sans contexte d\'entreprise, aucune ligne n\'est visible (échec « fermé »)', async () => {
    expect(await rawApp.user.count()).toBe(0);
    expect(await rawApp.company.count()).toBe(0);
    expect(await rawApp.auditLog.count()).toBe(0);
    expect(await rawApp.session.count()).toBe(0);
    // Seuls les rôles système (référentiel non sensible, entreprise plateforme) restent lisibles
    const visibleRoles = await rawApp.role.findMany();
    expect(visibleRoles).toHaveLength(12);
    expect(visibleRoles.every((role) => role.companyId === PLATFORM_COMPANY_ID && role.isSystem)).toBe(true);
  });

  it("chaque entreprise ne voit que ses propres utilisateurs", async () => {
    const seenByA = await t.db.run({ companyId: companyA.id }, (tx) => tx.user.findMany());
    const seenByB = await t.db.run({ companyId: companyB.id }, (tx) => tx.user.findMany());
    expect(seenByA.map((u) => u.id)).toEqual([userA.id]);
    expect(seenByB.map((u) => u.id)).toEqual([userB.id]);
  });

  it("une entreprise ne peut pas lire une ligne d'une autre, même en connaissant son identifiant", async () => {
    const stolen = await t.db.run({ companyId: companyA.id }, (tx) => tx.user.findUnique({ where: { id: userB.id } }));
    expect(stolen).toBeNull();
  });

  it("une entreprise ne peut ni modifier ni supprimer les lignes d'une autre", async () => {
    const updated = await t.db.run({ companyId: companyA.id }, (tx) =>
      tx.user.updateMany({ where: { id: userB.id }, data: { firstName: 'Piraté' } }),
    );
    expect(updated.count).toBe(0);
    const stillThere = await t.admin.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect(stillThere.firstName).toBe('Test');
  });

  it("une entreprise ne peut pas insérer une ligne au nom d'une autre", async () => {
    await expect(
      t.db.run({ companyId: companyA.id }, (tx) =>
        tx.user.create({
          data: { companyId: companyB.id, kind: 'STAFF', email: 'intrus@test.example', firstName: 'X', lastName: 'Y' },
        }),
      ),
    ).rejects.toThrow();
    expect(await t.admin.user.count({ where: { email: 'intrus@test.example' } })).toBe(0);
  });

  it("la table des entreprises n'expose que la sienne, sauf en mode plateforme", async () => {
    const own = await t.db.run({ companyId: companyA.id }, (tx) => tx.company.findMany());
    expect(own.map((c) => c.id)).toEqual([companyA.id]);

    const all = await t.db.run({ companyId: PLATFORM_COMPANY_ID, platform: true }, (tx) => tx.company.findMany());
    expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([companyA.id, companyB.id, PLATFORM_COMPANY_ID]));
  });

  it("le mode plateforme ne donne AUCUN accès aux données métier des autres entreprises", async () => {
    const users = await t.db.run({ companyId: PLATFORM_COMPANY_ID, platform: true }, (tx) => tx.user.findMany());
    expect(users.some((u) => u.id === userA.id || u.id === userB.id)).toBe(false);
    const audit = await t.db.run({ companyId: PLATFORM_COMPANY_ID, platform: true }, (tx) => tx.auditLog.findMany());
    expect(audit.every((row) => row.companyId === PLATFORM_COMPANY_ID)).toBe(true);
  });

  it('une entreprise cliente ne peut pas créer ni modifier une entreprise', async () => {
    await expect(
      t.db.run({ companyId: companyA.id }, (tx) => tx.company.create({ data: { name: 'Pirate', slug: 'pirate' } })),
    ).rejects.toThrow();
    const changed = await t.db.run({ companyId: companyA.id }, (tx) =>
      tx.company.updateMany({ where: { id: companyB.id }, data: { status: 'SUSPENDED' } }),
    );
    expect(changed.count).toBe(0);
  });

  it('les rôles système sont lisibles par toutes les entreprises mais pas modifiables', async () => {
    const roles = await t.db.run({ companyId: companyA.id }, (tx) => tx.role.findMany());
    expect(roles.filter((r) => r.companyId === PLATFORM_COMPANY_ID)).toHaveLength(12);
    await expect(
      t.db.run({ companyId: companyA.id }, (tx) =>
        tx.role.create({ data: { companyId: PLATFORM_COMPANY_ID, code: 'FAUX_ROLE', name: 'Faux' } }),
      ),
    ).rejects.toThrow();
    const modified = await t.db.run({ companyId: companyA.id }, (tx) =>
      tx.role.updateMany({ where: { companyId: PLATFORM_COMPANY_ID }, data: { name: 'Piraté' } }),
    );
    expect(modified.count).toBe(0);
  });

  it("le contexte ne fuit pas d'une requête à l'autre sur le pool de connexions", async () => {
    const jobs = Array.from({ length: 60 }, (_, i) => {
      const [company, expected] = i % 2 === 0 ? [companyA, userA] : [companyB, userB];
      return t.db
        .run({ companyId: company.id }, (tx) => tx.user.findMany())
        .then((users) => expect(users.map((u) => u.id)).toEqual([expected.id]));
    });
    await Promise.all(jobs);
    // Après toutes ces transactions, une requête sans contexte ne voit toujours rien.
    expect(await rawApp.user.count()).toBe(0);
  });

  describe("journal d'audit", () => {
    it('accepte l\'ajout et la lecture dans son entreprise seulement', async () => {
      const row = await t.db.run({ companyId: companyA.id }, (tx) =>
        tx.auditLog.create({ data: { companyId: companyA.id, actorType: 'SYSTEM', action: 'test.event' } }),
      );
      const readByA = await t.db.run({ companyId: companyA.id }, (tx) => tx.auditLog.findMany({ where: { action: 'test.event' } }));
      const readByB = await t.db.run({ companyId: companyB.id }, (tx) => tx.auditLog.findMany({ where: { action: 'test.event' } }));
      expect(readByA.map((r) => r.id)).toEqual([row.id]);
      expect(readByB).toHaveLength(0);
      await expect(
        t.db.run({ companyId: companyB.id }, (tx) =>
          tx.auditLog.create({ data: { companyId: companyA.id, actorType: 'SYSTEM', action: 'test.forged' } }),
        ),
      ).rejects.toThrow();
    });

    it('refuse toute modification et toute suppression, même pour le propriétaire des tables', async () => {
      const row = await t.admin.auditLog.create({
        data: { companyId: companyA.id, actorType: 'SYSTEM', action: 'test.immutable' },
      });
      await expect(
        t.db.run({ companyId: companyA.id }, (tx) => tx.auditLog.update({ where: { id: row.id }, data: { action: 'falsifié' } })),
      ).rejects.toThrow();
      await expect(
        t.db.run({ companyId: companyA.id }, (tx) => tx.auditLog.delete({ where: { id: row.id } })),
      ).rejects.toThrow();
      // Le rôle de migration (propriétaire, superutilisateur) est lui aussi bloqué par le déclencheur
      await expect(t.admin.auditLog.update({ where: { id: row.id }, data: { action: 'falsifié' } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/ajout seul/);
      const intact = await t.admin.auditLog.findUniqueOrThrow({ where: { id: row.id } });
      expect(intact.action).toBe('test.immutable');
    });
  });

  describe("contraintes d'intégrité", () => {
    it('refuse une session dont l\'entreprise diffère de celle de son utilisateur (clé étrangère composite)', async () => {
      await expect(
        t.admin.session.create({
          data: {
            companyId: companyB.id,
            userId: userA.id,
            familyId: userA.id,
            refreshHash: 'x',
            expiresAt: new Date(Date.now() + 1000),
          },
        }),
      ).rejects.toThrow();
    });

    it("refuse un e-mail en majuscules et un compte PLATFORM hors de l'entreprise plateforme", async () => {
      await expect(
        t.admin.user.create({
          data: { companyId: companyA.id, kind: 'STAFF', email: 'Majuscule@Test.Example', firstName: 'A', lastName: 'B' },
        }),
      ).rejects.toThrow(/users_email_lowercase/);
      await expect(
        t.admin.user.create({
          data: { companyId: companyA.id, kind: 'PLATFORM', email: 'plat@test.example', firstName: 'A', lastName: 'B' },
        }),
      ).rejects.toThrow(/users_platform_kind/);
    });

    it("refuse deux utilisateurs de même e-mail dans une entreprise, mais l'accepte dans deux entreprises", async () => {
      const email = 'partage@test.example';
      await t.admin.user.create({ data: { companyId: companyA.id, kind: 'STAFF', email, firstName: 'A', lastName: 'B' } });
      await expect(
        t.admin.user.create({ data: { companyId: companyA.id, kind: 'STAFF', email, firstName: 'A', lastName: 'B' } }),
      ).rejects.toThrow();
      await expect(
        t.admin.user.create({ data: { companyId: companyB.id, kind: 'STAFF', email, firstName: 'A', lastName: 'B' } }),
      ).resolves.toBeDefined();
    });

    it("refuse une attribution de rôle incohérente (portée entrepôt sans identifiant)", async () => {
      const role = await t.admin.role.findFirstOrThrow({ where: { code: 'RECEPTION_AGENT' } });
      await expect(
        t.admin.userRole.create({
          data: { companyId: companyA.id, userId: userA.id, roleId: role.id, scopeType: 'WAREHOUSE', scopeKey: 'WAREHOUSE:null' },
        }),
      ).rejects.toThrow(/user_roles_scope_consistency/);
    });
  });
});
