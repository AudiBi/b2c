import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import {
  api,
  bearer,
  buildTestApp,
  freshIp,
  lastMailTo,
  login,
  makeCompany,
  makeUser,
  strongPassword,
  tokenFromMail,
  uniq,
  type TestApp,
  type TestUser,
} from './helpers';

describe('Espace client, entrepôts et adresses de réception', () => {
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

  /** Parcours complet par l'API : inscription, confirmation, connexion. */
  async function signup(target = company, overrides: Record<string, unknown> = {}) {
    const email = `${uniq('c')}@test.example`;
    const password = strongPassword();
    const body = {
      companySlug: target.slug,
      accountType: 'INDIVIDUAL',
      email,
      password,
      firstName: 'Marie',
      lastName: 'Jean',
      acceptTerms: true,
      ...overrides,
    };
    const res = await api(t).post('/v1/auth/register').set('X-Forwarded-For', freshIp()).send(body);
    expect(res.status).toBe(202);
    await api(t).post('/v1/auth/verify-email').set('X-Forwarded-For', freshIp()).send({ token: tokenFromMail(lastMailTo(t, email)) });
    const session = await login(t, { slug: target.slug, email, password });
    return { email, password, token: session.accessToken };
  }

  const randomRef = () => `W${randomBytes(4).toString('hex').toUpperCase()}`;
  const warehouseBody = (overrides: Record<string, unknown> = {}) => ({
    reference: randomRef(),
    name: 'Entrepôt de test',
    country: 'us',
    city: 'Miami',
    addressLine: '1 Test Street, Medley, FL 33166',
    addressTemplate: ['{customerName}', '{customerCode} {mode}', '1 Test Street', 'Miami, FL 33100', 'USA'],
    ...overrides,
  });
  const createWarehouse = async (token = adminToken, overrides: Record<string, unknown> = {}) => {
    const res = await api(t).post('/v1/admin/warehouses').set(bearer(token)).send(warehouseBody(overrides));
    expect(res.status).toBe(201);
    return res.body;
  };

  const addressBody = (overrides: Record<string, unknown> = {}) => ({
    kind: 'DELIVERY',
    label: 'Maison',
    recipientName: 'Marie Jean',
    line1: '12 rue des Palmistes',
    city: 'Pétion-Ville',
    country: 'ht',
    ...overrides,
  });

  describe('code client', () => {
    it("l'inscription crée un profil client avec un code unique au format du préfixe de l'entreprise", async () => {
      const prefixed = await t.admin.company.create({
        data: { name: 'Préfixée', slug: uniq('p'), customerCodePrefix: 'KP' },
      });
      const first = await signup({ id: prefixed.id, slug: prefixed.slug });
      const second = await signup({ id: prefixed.id, slug: prefixed.slug });
      const codes = async (token: string) => (await api(t).get('/v1/me/profile').set(bearer(token))).body.customer.customerCode;
      expect(await codes(first.token)).toBe('KP-000001');
      expect(await codes(second.token)).toBe('KP-000002');
    });

    it('sans préfixe configuré, le code commence par CL ; les séquences sont propres à chaque entreprise', async () => {
      const a = await t.admin.company.create({ data: { name: 'Sans préfixe A', slug: uniq('a') } });
      const b = await t.admin.company.create({ data: { name: 'Sans préfixe B', slug: uniq('b') } });
      const inA = await signup({ id: a.id, slug: a.slug });
      const inB = await signup({ id: b.id, slug: b.slug });
      const profile = async (token: string) => (await api(t).get('/v1/me/profile').set(bearer(token))).body;
      expect((await profile(inA.token)).customer.customerCode).toBe('CL-000001');
      expect((await profile(inB.token)).customer.customerCode).toBe('CL-000001');
    });

    it('12 inscriptions simultanées reçoivent 12 codes distincts, sans trou', async () => {
      const own = await t.admin.company.create({ data: { name: 'Concurrence', slug: uniq('k'), customerCodePrefix: 'CC' } });
      await Promise.all(
        Array.from({ length: 12 }, async () => {
          const email = `${uniq('p')}@test.example`;
          const res = await api(t)
            .post('/v1/auth/register')
            .set('X-Forwarded-For', freshIp())
            .send({ companySlug: own.slug, accountType: 'INDIVIDUAL', email, password: strongPassword(), firstName: 'A', lastName: 'B', acceptTerms: true });
          expect(res.status).toBe(202);
        }),
      );
      const codes = (await t.admin.customer.findMany({ where: { companyId: own.id } })).map((c) => c.customerCode).sort();
      expect(codes).toEqual(Array.from({ length: 12 }, (_, i) => `CC-${String(i + 1).padStart(6, '0')}`));
    });

    it('un client créé hors inscription (import, seed) reçoit son code à la première consultation', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      expect(await t.admin.customer.count({ where: { userId: user.id } })).toBe(0);
      const { accessToken } = await login(t, user);
      const res = await api(t).get('/v1/me/profile').set(bearer(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.customer.customerCode).toMatch(/^[A-Z]{2,4}-\d{6}$/);
      const again = await api(t).get('/v1/me/profile').set(bearer(accessToken));
      expect(again.body.customer.customerCode).toBe(res.body.customer.customerCode);
    });

    it("un compte professionnel est typé BUSINESS", async () => {
      const business = await signup(company, { accountType: 'BUSINESS', businessName: 'Ets Jean & Fils' });
      const profile = await api(t).get('/v1/me/profile').set(bearer(business.token));
      expect(profile.body.customer.customerType).toBe('BUSINESS');
      expect(profile.body.businessName).toBe('Ets Jean & Fils');
    });
  });

  describe('profil et préférences', () => {
    it('lit et modifie son profil ; un nouveau téléphone doit être revérifié', async () => {
      const me = await signup();
      const before = await api(t).get('/v1/me/profile').set(bearer(me.token));
      expect(before.body).toMatchObject({ firstName: 'Marie', kind: 'CUSTOMER', emailVerified: true, phone: null });
      expect(before.body.customer.notificationPrefs).toEqual({ email: true, whatsapp: false, inApp: true });
      expect(JSON.stringify(before.body)).not.toMatch(/password|hash/i);

      const updated = await api(t)
        .patch('/v1/me/profile')
        .set(bearer(me.token))
        .send({ firstName: 'Marie-Claire', phone: '+50937000000', locale: 'ht', notificationPrefs: { email: true, whatsapp: true, inApp: true } });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ firstName: 'Marie-Claire', phone: '+50937000000', phoneVerified: false, locale: 'ht' });
      expect(updated.body.customer.notificationPrefs.whatsapp).toBe(true);
    });

    it('refuse les modifications invalides ou interdites', async () => {
      const me = await signup();
      const patch = (body: unknown) => api(t).patch('/v1/me/profile').set(bearer(me.token)).send(body as object);
      expect((await patch({})).status).toBe(400);
      expect((await patch({ email: 'nouveau@test.example' })).status).toBe(400); // l'e-mail ne se change pas ici
      expect((await patch({ kind: 'STAFF' })).status).toBe(400);
      expect((await patch({ phone: '12345' })).status).toBe(400);
      expect((await patch({ locale: 'es' })).status).toBe(400);
      expect((await patch({ notificationPrefs: { email: true } })).status).toBe(400);
      const individual = await patch({ businessName: 'Société fantôme' });
      expect(individual.status).toBe(400);
      expect(individual.body.error.code).toBe('NOT_A_BUSINESS_ACCOUNT');
    });

    it("le personnel n'accède pas à l'espace client", async () => {
      const staff = await makeUser(t, { company, roleCode: 'BILLING_AGENT' });
      const { accessToken } = await login(t, staff);
      for (const path of ['/v1/me/profile', '/v1/me/addresses', '/v1/me/beneficiaries', '/v1/me/receiving-addresses']) {
        expect((await api(t).get(path).set(bearer(accessToken))).status).toBe(403);
      }
    });

    it('exige une authentification', async () => {
      expect((await api(t).get('/v1/me/profile')).status).toBe(401);
      expect((await api(t).patch('/v1/me/profile').send({ firstName: 'X' })).status).toBe(401);
    });
  });

  describe('adresses', () => {
    it('crée, liste, modifie et supprime ; la première adresse de chaque type devient celle par défaut', async () => {
      const me = await signup();
      const first = await api(t).post('/v1/me/addresses').set(bearer(me.token)).send(addressBody());
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ kind: 'DELIVERY', country: 'HT', isDefault: true });

      const second = await api(t).post('/v1/me/addresses').set(bearer(me.token)).send(addressBody({ label: 'Bureau' }));
      expect(second.body.isDefault).toBe(false);
      const personal = await api(t).post('/v1/me/addresses').set(bearer(me.token)).send(addressBody({ kind: 'PERSONAL', label: 'Domicile' }));
      expect(personal.body.isDefault).toBe(true); // défaut par type

      const promoted = await api(t).patch(`/v1/me/addresses/${second.body.id}`).set(bearer(me.token)).send({ isDefault: true, instructions: 'Portail bleu' });
      expect(promoted.body).toMatchObject({ isDefault: true, instructions: 'Portail bleu' });

      const list = await api(t).get('/v1/me/addresses').set(bearer(me.token));
      expect(list.body.items).toHaveLength(3);
      const defaults = list.body.items.filter((a: any) => a.isDefault);
      expect(defaults.map((a: any) => a.kind).sort()).toEqual(['DELIVERY', 'PERSONAL']);
      expect(list.body.items.find((a: any) => a.id === first.body.id).isDefault).toBe(false);

      // Supprimer l'adresse par défaut : une autre du même type est promue
      expect((await api(t).delete(`/v1/me/addresses/${second.body.id}`).set(bearer(me.token))).status).toBe(204);
      const after = await api(t).get('/v1/me/addresses').set(bearer(me.token));
      expect(after.body.items).toHaveLength(2);
      expect(after.body.items.filter((a: any) => a.kind === 'DELIVERY')[0].isDefault).toBe(true);
    });

    it.each([
      ['pays à 3 lettres', { country: 'HTI' }],
      ['pays inconnu en chiffres', { country: '12' }],
      ['ville manquante', { city: '' }],
      ['type inconnu', { kind: 'OFFICE' }],
      ['champ inconnu', { customerId: uuidv7() }],
      ['téléphone invalide', { phone: '509 37' }],
      ['instructions trop longues', { instructions: 'x'.repeat(501) }],
    ])('refuse : %s', async (_label, override) => {
      const me = await signup();
      const res = await api(t).post('/v1/me/addresses').set(bearer(me.token)).send(addressBody(override));
      expect(res.status).toBe(400);
    });

    it('limite à 20 adresses', async () => {
      const me = await signup();
      for (let i = 0; i < 20; i += 1) {
        expect((await api(t).post('/v1/me/addresses').set(bearer(me.token)).send(addressBody({ label: `A${i}` }))).status).toBe(201);
      }
      const over = await api(t).post('/v1/me/addresses').set(bearer(me.token)).send(addressBody());
      expect(over.status).toBe(422);
      expect(over.body.error.code).toBe('ADDRESS_LIMIT');
    });

    it("parcours 13 : un client ne voit, ne modifie ni ne supprime les adresses d'un autre client", async () => {
      const alice = await signup();
      const bob = await signup();
      const secret = await api(t).post('/v1/me/addresses').set(bearer(alice.token)).send(addressBody({ label: 'Secrète' }));

      const bobList = await api(t).get('/v1/me/addresses').set(bearer(bob.token));
      expect(bobList.body.items).toEqual([]);
      expect((await api(t).patch(`/v1/me/addresses/${secret.body.id}`).set(bearer(bob.token)).send({ label: 'Piratée' })).status).toBe(404);
      expect((await api(t).delete(`/v1/me/addresses/${secret.body.id}`).set(bearer(bob.token))).status).toBe(404);
      const intact = await t.admin.customerAddress.findUniqueOrThrow({ where: { id: secret.body.id } });
      expect(intact.label).toBe('Secrète');
    });

    it("un client d'une autre entreprise est également isolé (même identifiant d'adresse inconnu)", async () => {
      const mine = await signup(company);
      const theirs = await signup(other);
      const created = await api(t).post('/v1/me/addresses').set(bearer(theirs.token)).send(addressBody());
      expect((await api(t).delete(`/v1/me/addresses/${created.body.id}`).set(bearer(mine.token))).status).toBe(404);
    });
  });

  describe('bénéficiaires', () => {
    const beneficiary = (overrides: Record<string, unknown> = {}) => ({
      fullName: 'Jean Baptiste',
      idDocumentType: 'NATIONAL_ID',
      idDocumentLast4: '4821',
      phone: '+50937111111',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      ...overrides,
    });

    it('ajoute, modifie, révoque ; ne conserve que les 4 derniers caractères de la pièce', async () => {
      const me = await signup();
      const created = await api(t).post('/v1/me/beneficiaries').set(bearer(me.token)).send(beneficiary());
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ fullName: 'Jean Baptiste', idDocumentLast4: '4821', validFrom: '2026-01-01', validTo: '2026-12-31', status: 'ACTIVE' });

      const stored = await t.admin.beneficiary.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stored.idDocumentLast4).toBe('4821');

      const edited = await api(t).patch(`/v1/me/beneficiaries/${created.body.id}`).set(bearer(me.token)).send({ phone: '+50937222222' });
      expect(edited.body.phone).toBe('+50937222222');

      expect((await api(t).delete(`/v1/me/beneficiaries/${created.body.id}`).set(bearer(me.token))).status).toBe(204);
      expect((await api(t).get('/v1/me/beneficiaries').set(bearer(me.token))).body.items).toEqual([]);
      // Révoqué mais conservé en base (historique)
      expect((await t.admin.beneficiary.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('REVOKED');
      expect((await api(t).delete(`/v1/me/beneficiaries/${created.body.id}`).set(bearer(me.token))).status).toBe(404);
    });

    it.each([
      ['numéro de pièce complet', { idDocumentLast4: '123456789' }],
      ['fin avant le début', { validFrom: '2026-06-01', validTo: '2026-01-01' }],
      ['date mal formée', { validFrom: '01/01/2026' }],
      ['nom manquant', { fullName: '' }],
      ['type de pièce inconnu', { idDocumentType: 'CARTE_FIDELITE' }],
    ])('refuse : %s', async (_label, override) => {
      const me = await signup();
      expect((await api(t).post('/v1/me/beneficiaries').set(bearer(me.token)).send(beneficiary(override))).status).toBe(400);
    });

    it('limite à 10 bénéficiaires actifs ; en révoquer un libère une place', async () => {
      const me = await signup();
      const ids: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const res = await api(t).post('/v1/me/beneficiaries').set(bearer(me.token)).send(beneficiary({ fullName: `Personne ${i}` }));
        expect(res.status).toBe(201);
        ids.push(res.body.id);
      }
      expect((await api(t).post('/v1/me/beneficiaries').set(bearer(me.token)).send(beneficiary())).status).toBe(422);
      await api(t).delete(`/v1/me/beneficiaries/${ids[0]}`).set(bearer(me.token));
      expect((await api(t).post('/v1/me/beneficiaries').set(bearer(me.token)).send(beneficiary())).status).toBe(201);
    });

    it("un client ne peut ni modifier ni révoquer le bénéficiaire d'un autre", async () => {
      const alice = await signup();
      const bob = await signup();
      const created = await api(t).post('/v1/me/beneficiaries').set(bearer(alice.token)).send(beneficiary());
      expect((await api(t).patch(`/v1/me/beneficiaries/${created.body.id}`).set(bearer(bob.token)).send({ fullName: 'Pirate' })).status).toBe(404);
      expect((await api(t).delete(`/v1/me/beneficiaries/${created.body.id}`).set(bearer(bob.token))).status).toBe(404);
      expect((await t.admin.beneficiary.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('ACTIVE');
    });
  });

  describe('entrepôts (administration)', () => {
    it('crée, liste, modifie ; refuse les doublons de référence et les modèles invalides', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, boss)).accessToken;

      const body = warehouseBody({ publicVisible: false });
      const created = await api(t).post('/v1/admin/warehouses').set(bearer(token)).send(body);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ reference: body.reference, country: 'US', version: 1, status: 'ACTIVE', publicVisible: false });

      expect((await api(t).post('/v1/admin/warehouses').set(bearer(token)).send(body)).status).toBe(409);
      for (const addressTemplate of [
        ['Sans code client', 'Miami'],
        ['{customerCode}', '{inconnu}'],
        ['{customerCode} {', 'x'],
        [],
        Array(11).fill('{customerCode}'),
      ]) {
        const res = await api(t).post('/v1/admin/warehouses').set(bearer(token)).send(warehouseBody({ addressTemplate }));
        expect({ addressTemplate, status: res.status }).toEqual({ addressTemplate, status: 400 });
      }
      expect((await api(t).post('/v1/admin/warehouses').set(bearer(token)).send(warehouseBody({ reference: 'a b' }))).status).toBe(400);
      expect((await api(t).post('/v1/admin/warehouses').set(bearer(token)).send(warehouseBody({ country: 'USA' }))).status).toBe(400);

      const renamed = await api(t).patch(`/v1/admin/warehouses/${created.body.id}`).set(bearer(token)).send({ name: 'Nouveau nom' });
      expect(renamed.body).toMatchObject({ name: 'Nouveau nom', version: 1 }); // le modèle n'a pas changé
      const retemplated = await api(t)
        .patch(`/v1/admin/warehouses/${created.body.id}`)
        .set(bearer(token))
        .send({ addressTemplate: ['{customerName}', 'Suite {customerCode}', 'Doral, FL'] });
      expect(retemplated.body.version).toBe(2);
      expect((await api(t).patch(`/v1/admin/warehouses/${uuidv7()}`).set(bearer(token)).send({ name: 'x' })).status).toBe(404);
      expect((await api(t).get('/v1/admin/warehouses').set(bearer(token))).body.items).toHaveLength(1);
    });

    it("la création est réservée aux droits sur toute l'entreprise ; un responsable d'entrepôt n'agit que sur son entrepôt", async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const bossToken = (await login(t, boss)).accessToken;
      const miami = await createWarehouse(bossToken);
      const orlando = await createWarehouse(bossToken);

      const manager = await makeUser(t, { company: own, roleCode: 'WAREHOUSE_MANAGER', scope: { type: 'WAREHOUSE', id: miami.id } });
      const managerToken = (await login(t, manager)).accessToken;

      // Liste restreinte à son entrepôt
      const visible = await api(t).get('/v1/admin/warehouses').set(bearer(managerToken));
      expect(visible.body.items.map((w: any) => w.id)).toEqual([miami.id]);
      // Modification : le sien oui, l'autre non (comme s'il n'existait pas)
      expect((await api(t).patch(`/v1/admin/warehouses/${miami.id}`).set(bearer(managerToken)).send({ name: 'Miami 2' })).status).toBe(200);
      expect((await api(t).patch(`/v1/admin/warehouses/${orlando.id}`).set(bearer(managerToken)).send({ name: 'Piraté' })).status).toBe(404);
      expect((await t.admin.warehouse.findUniqueOrThrow({ where: { id: orlando.id } })).name).not.toBe('Piraté');
      // Création : refusée
      const create = await api(t).post('/v1/admin/warehouses').set(bearer(managerToken)).send(warehouseBody());
      expect(create.status).toBe(403);

      // Agent de réception : lecture de son entrepôt seulement, aucune modification
      const agent = await makeUser(t, { company: own, roleCode: 'RECEPTION_AGENT', scope: { type: 'WAREHOUSE', id: orlando.id } });
      const agentToken = (await login(t, agent)).accessToken;
      expect((await api(t).get('/v1/admin/warehouses').set(bearer(agentToken))).body.items.map((w: any) => w.id)).toEqual([orlando.id]);
      expect((await api(t).patch(`/v1/admin/warehouses/${orlando.id}`).set(bearer(agentToken)).send({ name: 'x' })).status).toBe(403);
    });

    it('les entrepôts sont propres à chaque entreprise', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const bossToken = (await login(t, boss)).accessToken;
      const mine = await createWarehouse(bossToken);
      const theirs = await createWarehouse(adminToken);
      const list = await api(t).get('/v1/admin/warehouses').set(bearer(bossToken));
      expect(list.body.items.map((w: any) => w.id)).toEqual([mine.id]);
      expect((await api(t).patch(`/v1/admin/warehouses/${theirs.id}`).set(bearer(bossToken)).send({ name: 'x' })).status).toBe(404);
      // Même référence autorisée dans deux entreprises
      const sameRef = await api(t).post('/v1/admin/warehouses').set(bearer(bossToken)).send(warehouseBody({ reference: theirs.reference }));
      expect(sameRef.status).toBe(201);
    });

    it('les rôles sans droit sur les entrepôts sont refusés', async () => {
      const driver = await makeUser(t, { company, roleCode: 'DRIVER' });
      const { accessToken } = await login(t, driver);
      expect((await api(t).get('/v1/admin/warehouses').set(bearer(accessToken))).status).toBe(403);
      expect((await api(t).post('/v1/admin/warehouses').set(bearer(accessToken)).send(warehouseBody())).status).toBe(403);
    });
  });

  describe('adresses de réception personnalisées', () => {
    it("sont générées à partir du code client pour chaque entrepôt actif et chaque mode, et restent stables", async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const bossToken = (await login(t, boss)).accessToken;
      const me = await signup(own, { firstName: 'Marie', lastName: 'Jean' });

      const empty = await api(t).get('/v1/me/receiving-addresses').set(bearer(me.token));
      expect(empty.status).toBe(200);
      expect(empty.body.warehouses).toEqual([]);

      const miami = await createWarehouse(bossToken);
      const res = await api(t).get('/v1/me/receiving-addresses').set(bearer(me.token));
      const code = res.body.customerCode;
      expect(res.body.warehouses).toHaveLength(1);
      const [warehouse] = res.body.warehouses;
      expect(warehouse).toMatchObject({ id: miami.id, reference: miami.reference, country: 'US', city: 'Miami' });
      expect(warehouse.addresses.map((a: any) => a.mode)).toEqual(['AIR', 'SEA']);
      expect(warehouse.addresses[0].lines).toEqual(['Marie Jean', `${code} AIR`, '1 Test Street', 'Miami, FL 33100', 'USA']);
      expect(warehouse.addresses[1].lines[1]).toBe(`${code} SEA`);

      const again = await api(t).get('/v1/me/receiving-addresses').set(bearer(me.token));
      expect(again.body).toEqual(res.body);
      expect(await t.admin.receivingAddress.count({ where: { customer: { userId: (await t.admin.user.findFirstOrThrow({ where: { email: me.email } })).id } } })).toBe(2);
    });

    it('chaque client reçoit des adresses distinctes (le code client les rend uniques)', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      await createWarehouse((await login(t, boss)).accessToken);
      const [alice, bob] = [await signup(own), await signup(own)];
      const [a, b] = await Promise.all(
        [alice, bob].map(async (c) => (await api(t).get('/v1/me/receiving-addresses').set(bearer(c.token))).body),
      );
      expect(a.customerCode).not.toBe(b.customerCode);
      const lines = (x: any) => x.warehouses.flatMap((w: any) => w.addresses.map((ad: any) => ad.lines.join('|')));
      expect(new Set([...lines(a), ...lines(b)]).size).toBe(4);
    });

    it('sont régénérées quand le modèle de l’entrepôt ou le nom du client change, et masquent les entrepôts inactifs', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const bossToken = (await login(t, boss)).accessToken;
      const me = await signup(own);
      const warehouse = await createWarehouse(bossToken);
      const first = (await api(t).get('/v1/me/receiving-addresses').set(bearer(me.token))).body;

      await api(t).patch(`/v1/admin/warehouses/${warehouse.id}`).set(bearer(bossToken)).send({ addressTemplate: ['{customerName}', 'Entrepôt 2 / {customerCode} / {mode}'] });
      const second = (await api(t).get('/v1/me/receiving-addresses').set(bearer(me.token))).body;
      expect(second.warehouses[0].addresses[0].lines).toEqual(['Marie Jean', `Entrepôt 2 / ${first.customerCode} / AIR`]);

      await api(t).patch('/v1/me/profile').set(bearer(me.token)).send({ firstName: 'Marie-Claire' });
      const third = (await api(t).get('/v1/me/receiving-addresses').set(bearer(me.token))).body;
      expect(third.warehouses[0].addresses[0].lines[0]).toBe('Marie-Claire Jean');

      await api(t).patch(`/v1/admin/warehouses/${warehouse.id}`).set(bearer(bossToken)).send({ status: 'INACTIVE' });
      expect((await api(t).get('/v1/me/receiving-addresses').set(bearer(me.token))).body.warehouses).toEqual([]);
    });

    it('un compte professionnel utilise sa raison sociale ; le nom est normalisé sur une seule ligne', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      await createWarehouse((await login(t, boss)).accessToken);
      const business = await signup(own, { accountType: 'BUSINESS', businessName: 'Ets   Jean\n& Fils' });
      const res = await api(t).get('/v1/me/receiving-addresses').set(bearer(business.token));
      expect(res.body.warehouses[0].addresses[0].lines[0]).toBe('Ets Jean & Fils');
    });

    it('10 consultations simultanées ne créent aucun doublon', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const bossToken = (await login(t, boss)).accessToken;
      await createWarehouse(bossToken);
      await createWarehouse(bossToken);
      const me = await signup(own);
      const results = await Promise.all(Array.from({ length: 10 }, () => api(t).get('/v1/me/receiving-addresses').set(bearer(me.token))));
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(await t.admin.receivingAddress.count({ where: { companyId: own.id } })).toBe(4);
    });

    it("un client ne voit que les entrepôts de son entreprise", async () => {
      const mine = await signup(company);
      const theirs = await signup(other);
      const w = await createWarehouse(adminToken);
      const mineRes = await api(t).get('/v1/me/receiving-addresses').set(bearer(mine.token));
      expect(mineRes.body.warehouses.some((x: any) => x.id === w.id)).toBe(true);
      const theirRes = await api(t).get('/v1/me/receiving-addresses').set(bearer(theirs.token));
      expect(theirRes.body.warehouses.some((x: any) => x.id === w.id)).toBe(false);
    });
  });

  describe('consultation des clients par le personnel', () => {
    it('recherche par code, nom, e-mail ; pagination ; isolation par entreprise', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, boss)).accessToken;
      const outsider = await signup(other);
      const first = await signup(own, { firstName: 'Zoé', lastName: 'Unique' });
      await signup(own);
      await signup(own);

      const all = await api(t).get('/v1/admin/customers').query({ limit: 2 }).set(bearer(token));
      expect(all.body.items).toHaveLength(2);
      expect(all.body.nextCursor).toBeTruthy();
      const rest = await api(t).get('/v1/admin/customers').query({ limit: 2, cursor: all.body.nextCursor }).set(bearer(token));
      expect(rest.body.items).toHaveLength(1);

      const byName = await api(t).get('/v1/admin/customers').query({ q: 'unique' }).set(bearer(token));
      expect(byName.body.items).toHaveLength(1);
      expect(byName.body.items[0]).toMatchObject({ firstName: 'Zoé', email: first.email });
      const code = byName.body.items[0].customerCode;
      expect((await api(t).get('/v1/admin/customers').query({ q: code.toLowerCase() }).set(bearer(token))).body.items).toHaveLength(1);

      const detail = await api(t).get(`/v1/admin/customers/${byName.body.items[0].id}`).set(bearer(token));
      expect(detail.status).toBe(200);
      // Client d'une autre entreprise : introuvable
      const foreign = await t.admin.customer.findFirstOrThrow({ where: { user: { email: outsider.email } } });
      expect((await api(t).get(`/v1/admin/customers/${foreign.id}`).set(bearer(token))).status).toBe(404);
      expect(JSON.stringify(detail.body)).not.toMatch(/password|hash/i);
    });

    it('réservée aux rôles qui ont la permission customer:read', async () => {
      const allowed = ['CUSTOMER_SERVICE', 'BILLING_AGENT', 'LOGISTICS_MANAGER'] as const;
      for (const roleCode of allowed) {
        const user = await makeUser(t, { company, roleCode });
        const { accessToken } = await login(t, user);
        expect((await api(t).get('/v1/admin/customers').set(bearer(accessToken))).status).toBe(200);
      }
      const driver = await makeUser(t, { company, roleCode: 'DRIVER' });
      const driverSession = await login(t, driver);
      expect((await api(t).get('/v1/admin/customers').set(bearer(driverSession.accessToken))).status).toBe(403);
      const customer = await signup();
      expect((await api(t).get('/v1/admin/customers').set(bearer(customer.token))).status).toBe(403);
    });
  });

  describe('informations publiques', () => {
    it('expose le nom, la langue, la devise et les coordonnées configurées, sans donnée interne', async () => {
      const own = await t.admin.company.create({ data: { name: 'Transport Public SA', slug: uniq('pub'), defaultLocale: 'ht', defaultCurrency: 'HTG' } });
      const boss = await makeUser(t, { company: { id: own.id, slug: own.slug }, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, boss)).accessToken;

      const bare = await api(t).get(`/v1/public/companies/${own.slug}`);
      expect(bare.status).toBe(200);
      expect(bare.body).toEqual({ name: 'Transport Public SA', slug: own.slug, defaultLocale: 'ht', defaultCurrency: 'HTG', contact: { phones: [] } });
      expect(bare.headers['cache-control']).toContain('public');

      const contact = { email: 'contact@exemple.test', phones: ['+50937000000', '+50938000000'], hours: 'Lun-Ven 8h-17h', facebook: 'https://facebook.com/exemple' };
      const saved = await api(t).put('/v1/admin/settings/public-contact').set(bearer(token)).send(contact);
      expect(saved.status).toBe(200);
      const info = await api(t).get(`/v1/public/companies/${own.slug}`);
      expect(info.body.contact).toMatchObject(contact);
      expect(Object.keys(info.body).sort()).toEqual(['contact', 'defaultCurrency', 'defaultLocale', 'name', 'slug']);
    });

    it('refuse les coordonnées invalides et réserve la modification aux détenteurs de settings:update', async () => {
      const put = (token: string, body: unknown) => api(t).put('/v1/admin/settings/public-contact').set(bearer(token)).send(body as object);
      expect((await put(adminToken, { email: 'pas-un-email', phones: [] })).status).toBe(400);
      expect((await put(adminToken, { phones: ['12345'] })).status).toBe(400);
      expect((await put(adminToken, { phones: [], facebook: 'http://pas-https.test' })).status).toBe(400);
      expect((await put(adminToken, { phones: [], facebook: 'javascript:alert(1)' })).status).toBe(400);
      expect((await put(adminToken, { phones: [], inconnu: 'x' })).status).toBe(400);

      const auditor = await makeUser(t, { company, roleCode: 'AUDITOR' });
      const auditorToken = (await login(t, auditor)).accessToken;
      expect((await put(auditorToken, { phones: [] })).status).toBe(403);
      expect((await api(t).get('/v1/admin/settings/public-contact').set(bearer(auditorToken))).status).toBe(200);
    });

    it('ne liste que les entrepôts actifs et visibles, sans le modèle d’adresse des clients', async () => {
      const own = await makeCompany(t);
      const boss = await makeUser(t, { company: own, roleCode: 'COMPANY_ADMIN' });
      const token = (await login(t, boss)).accessToken;
      const visible = await createWarehouse(token, { name: 'Visible' });
      await createWarehouse(token, { name: 'Masqué', publicVisible: false });
      const inactive = await createWarehouse(token, { name: 'Inactif' });
      await api(t).patch(`/v1/admin/warehouses/${inactive.id}`).set(bearer(token)).send({ status: 'INACTIVE' });

      const res = await api(t).get(`/v1/public/companies/${own.slug}/warehouses`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        { reference: visible.reference, name: 'Visible', country: 'US', city: 'Miami', addressLine: '1 Test Street, Medley, FL 33166' },
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/customerCode|addressTemplate|version/);
    });

    it("répond 404 pour une entreprise inconnue, suspendue, ou pour l'entreprise plateforme", async () => {
      const suspended = await makeCompany(t, 'SUSPENDED');
      for (const slug of ['nexiste-pas', 'platform', suspended.slug]) {
        expect((await api(t).get(`/v1/public/companies/${slug}`)).status).toBe(404);
        expect((await api(t).get(`/v1/public/companies/${slug}/warehouses`)).status).toBe(404);
      }
      expect((await api(t).get('/v1/public/companies/Slug%20Invalide!')).status).toBe(400);
    });
  });

  describe('changement de mot de passe', () => {
    it('exige le mot de passe actuel, ferme les autres appareils et garde la session courante', async () => {
      const me = await signup();
      const phone = await login(t, { slug: company.slug, email: me.email, password: me.password });
      const change = (body: unknown) => api(t).post('/v1/auth/change-password').set(bearer(me.token)).send(body as object);

      expect((await change({ currentPassword: 'mauvais-mot-de-passe', newPassword: strongPassword() })).status).toBe(400);
      expect((await change({ currentPassword: me.password, newPassword: 'password123' })).status).toBe(400);
      expect((await change({ currentPassword: me.password, newPassword: me.password })).status).toBe(400);

      const newPassword = strongPassword();
      expect((await change({ currentPassword: me.password, newPassword })).status).toBe(204);
      expect((await api(t).get('/v1/auth/me').set(bearer(me.token))).status).toBe(200); // session courante conservée
      expect((await api(t).get('/v1/auth/me').set(bearer(phone.accessToken))).status).toBe(401); // autre appareil fermé
      await expect(login(t, { slug: company.slug, email: me.email, password: newPassword })).resolves.toBeDefined();
      expect(
        (await api(t).post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ companySlug: company.slug, email: me.email, password: me.password })).status,
      ).toBe(401);
    });

    it('limite les tentatives avec un mauvais mot de passe actuel', async () => {
      const me = await signup();
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        const res = await api(t).post('/v1/auth/change-password').set(bearer(me.token)).send({ currentPassword: 'mauvais-mot-de-passe', newPassword: strongPassword() });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 5)).toEqual(Array(5).fill(400));
      expect(statuses.slice(5)).toEqual([429, 429]);
    });

    it('exige une authentification', async () => {
      expect((await api(t).post('/v1/auth/change-password').send({ currentPassword: 'x', newPassword: strongPassword() })).status).toBe(401);
    });
  });

  describe("isolation au niveau de la base pour les nouvelles tables", () => {
    it('chaque entreprise ne voit que ses clients, adresses, bénéficiaires, entrepôts et adresses de réception', async () => {
      const a = await signup(company);
      const w = await createWarehouse(adminToken);
      await api(t).post('/v1/me/addresses').set(bearer(a.token)).send(addressBody());
      await api(t).get('/v1/me/receiving-addresses').set(bearer(a.token));
      await api(t).post('/v1/me/beneficiaries').set(bearer(a.token)).send({ fullName: 'Bénéficiaire' });

      for (const table of ['customer', 'customerAddress', 'beneficiary', 'warehouse', 'receivingAddress'] as const) {
        const seenByOther: any[] = await t.db.run({ companyId: other.id }, (tx) => (tx as any)[table].findMany({ where: { companyId: company.id } }));
        expect({ table, rows: seenByOther.length }).toEqual({ table, rows: 0 });
        const seenByOwner: number = await t.db.run({ companyId: company.id }, (tx) => (tx as any)[table].count());
        expect(seenByOwner).toBeGreaterThan(0);
      }
      // Insertion au nom d'une autre entreprise refusée
      await expect(
        t.db.run({ companyId: other.id }, (tx) => tx.warehouse.create({ data: { ...warehouseBody(), companyId: company.id, country: 'US', addressTemplate: ['{customerCode}'] } as any })),
      ).rejects.toThrow();
      expect(w.id).toBeTruthy();
    });
  });
});
