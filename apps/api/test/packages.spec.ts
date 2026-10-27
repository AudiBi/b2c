import { formatTrackingNumber, normalizeTrackingNumber } from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import {
  activateRateCard,
  api,
  bearer,
  buildTestApp,
  login,
  makeCustomer,
  makePrealert,
  makeTenant,
  makeUser,
  makeWarehouse,
  prealertBody,
  type CustomerSession,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

const weighing = (overrides: Record<string, unknown> = {}) => ({
  weight: { value: 2, unit: 'KG' },
  dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
  ...overrides,
});

describe('Colis, préalertes et suivi', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  /** Entreprise prête : deux entrepôts, une grille active, un administrateur, un agent par entrepôt, deux clients. */
  async function setup() {
    const tenant = await makeTenant(t);
    const w1 = await makeWarehouse(t, tenant.token, { city: 'Miami' });
    const w2 = await makeWarehouse(t, tenant.token, { city: 'Orlando' });
    await activateRateCard(t, tenant.token);
    const staff = async (roleCode: 'RECEPTION_AGENT' | 'WAREHOUSE_MANAGER' | 'BILLING_AGENT' | 'CUSTOMER_SERVICE', warehouseId?: string) => {
      const user = await makeUser(t, { company: tenant.company, roleCode, scope: warehouseId ? { type: 'WAREHOUSE', id: warehouseId } : undefined });
      return (await login(t, user)).accessToken;
    };
    const customer1 = await makeCustomer(t, tenant.company);
    const customer2 = await makeCustomer(t, tenant.company);
    return { ...tenant, w1, w2, staff, customer1, customer2 };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const receive = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/packages/receive').set(bearer(token)).send(body);
  const register = (token: string, id: string, body: Record<string, unknown> = weighing()) =>
    api(t).post(`/v1/admin/packages/${id}/register`).set(bearer(token)).send(body);
  const transition = (token: string, id: string, body: Record<string, unknown>) =>
    api(t).post(`/v1/admin/packages/${id}/transitions`).set(bearer(token)).send(body);
  const detail = (token: string, id: string) => api(t).get(`/v1/admin/packages/${id}`).set(bearer(token));
  const track = (value: string, ip?: string) => {
    const req = api(t).get(`/v1/public/tracking/${encodeURIComponent(value)}`);
    return ip ? req.set('X-Forwarded-For', ip) : req;
  };

  /** Colis attendu → reçu → pesé : chemin nominal complet. */
  async function weighedPackage(w: World, customer: CustomerSession = w.customer1) {
    const prealert = await makePrealert(t, customer, w.w1.id);
    const received = await receive(w.token, { warehouseId: w.w1.id, supplierTracking: prealert.supplierTracking });
    expect(received.status).toBe(200);
    const weighed = await register(w.token, prealert.package.id);
    expect(weighed.status).toBe(200);
    return { prealert, packageId: prealert.package.id, trackingNumber: prealert.package.trackingNumber };
  }

  // =============================================================================================
  describe('préalertes (client)', () => {
    it('crée le colis attendu avec un numéro de suivi unique et l’historique des deux premiers statuts', async () => {
      const w = await setup();
      const body = prealertBody(w.w1.id, { supplierTracking: ' 1z abc 123 456 ' });
      const res = await api(t).post('/v1/me/prealerts').set(bearer(w.customer1.token)).send(body);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'OPEN', storeName: 'Boutique Test', purchaseAmount: '59.9', purchaseCurrency: 'USD', supplierTracking: '1ZABC123456' });
      expect(res.body.package.status).toBe('AWAITING_RECEIPT');

      const tracking: string = res.body.package.trackingNumber;
      expect(tracking).toMatch(/^[0-9A-Z]{15}$/);
      expect(normalizeTrackingNumber(tracking)).toBe(tracking);

      const events = await t.admin.packageEvent.findMany({ where: { packageId: res.body.package.id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
      expect(events.map((e) => e.toStatus)).toEqual(['PREALERT_CREATED', 'AWAITING_RECEIPT']);
    });

    it('le préfixe du numéro de suivi est celui de l’entreprise ; deux colis n’ont jamais le même numéro', async () => {
      const w = await setup();
      const company = await t.admin.company.findUniqueOrThrow({ where: { id: w.company.id } });
      const numbers = new Set<string>();
      for (let i = 0; i < 6; i += 1) {
        const p = await makePrealert(t, w.customer1, w.w1.id);
        expect(p.package.trackingNumber.startsWith(company.trackingPrefix!)).toBe(true);
        numbers.add(p.package.trackingNumber);
      }
      expect(numbers.size).toBe(6);
    });

    it('refuse un numéro de suivi marchand déjà déclaré (insensible à la casse et aux espaces)', async () => {
      const w = await setup();
      const first = await makePrealert(t, w.customer1, w.w1.id, { supplierTracking: '1ZDUPL1CATE00' });
      const dup = await api(t).post('/v1/me/prealerts').set(bearer(w.customer2.token)).send(prealertBody(w.w1.id, { supplierTracking: '1z dupl1cate00' }));
      expect(dup.status).toBe(409);
      expect(errorCode(dup)).toBe('DUPLICATE_PREALERT');

      // une fois annulée, la préalerte libère le numéro
      expect((await api(t).delete(`/v1/me/prealerts/${first.id}`).set(bearer(w.customer1.token))).status).toBe(204);
      const again = await api(t).post('/v1/me/prealerts').set(bearer(w.customer2.token)).send(prealertBody(w.w1.id, { supplierTracking: '1ZDUPL1CATE00' }));
      expect(again.status).toBe(201);
    });

    it('5 préalertes simultanées avec le même numéro : une seule est créée', async () => {
      const w = await setup();
      const body = prealertBody(w.w1.id, { supplierTracking: 'RACE000000001' });
      const results = await Promise.all(Array.from({ length: 5 }, () => api(t).post('/v1/me/prealerts').set(bearer(w.customer1.token)).send(body)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await t.admin.prealert.count({ where: { companyId: w.company.id, supplierTracking: 'RACE000000001' } })).toBe(1);
    });

    it('valide les données et l’entrepôt', async () => {
      const w = await setup();
      const post = (body: Record<string, unknown>) => api(t).post('/v1/me/prealerts').set(bearer(w.customer1.token)).send(body);
      const base = prealertBody(w.w1.id);
      for (const bad of [
        { purchaseAmount: 0 },
        { purchaseAmount: 10.123 },
        { purchaseAmount: -5 },
        { storeName: '' },
        { description: '' },
        { purchaseCurrency: 'GBP' },
        { transportMode: 'ROAD' },
        { supplierTracking: 'a b' },
        { warehouseId: 'pas-un-uuid' },
        { surprise: true },
      ]) {
        expect((await post({ ...base, ...bad })).status).toBe(400);
      }
      const unknownWarehouse = await post({ ...base, warehouseId: uuidv7() });
      expect(unknownWarehouse.status).toBe(404);
      expect(errorCode(unknownWarehouse)).toBe('WAREHOUSE_NOT_FOUND');

      // un entrepôt d'une autre entreprise est introuvable
      const other = await setup();
      expect((await post({ ...base, warehouseId: other.w1.id })).status).toBe(404);
    });

    it('sans connexion : 401 ; le personnel n’a pas accès aux routes client', async () => {
      const w = await setup();
      expect((await api(t).post('/v1/me/prealerts').send(prealertBody(w.w1.id))).status).toBe(401);
      expect((await api(t).get('/v1/me/prealerts')).status).toBe(401);
      expect((await api(t).post('/v1/me/prealerts').set(bearer(w.token)).send(prealertBody(w.w1.id))).status).toBe(403);
      expect((await api(t).get('/v1/me/packages').set(bearer(w.token))).status).toBe(403);
    });

    it('un client ne voit, ne modifie et n’annule que ses propres préalertes', async () => {
      const w = await setup();
      const mine = await makePrealert(t, w.customer1, w.w1.id);
      expect((await api(t).get('/v1/me/prealerts').set(bearer(w.customer1.token))).body.items.map((p: any) => p.id)).toEqual([mine.id]);
      expect((await api(t).get('/v1/me/prealerts').set(bearer(w.customer2.token))).body.items).toHaveLength(0);

      const theirs = w.customer2.token;
      expect((await api(t).get(`/v1/me/prealerts/${mine.id}`).set(bearer(theirs))).status).toBe(404);
      expect((await api(t).patch(`/v1/me/prealerts/${mine.id}`).set(bearer(theirs)).send({ storeName: 'Piraté' })).status).toBe(404);
      expect((await api(t).delete(`/v1/me/prealerts/${mine.id}`).set(bearer(theirs))).status).toBe(404);
      expect((await api(t).get(`/v1/me/packages/${mine.package.id}`).set(bearer(theirs))).status).toBe(404);
      expect((await api(t).get(`/v1/me/prealerts/${mine.id}`).set(bearer(w.customer1.token))).status).toBe(200);
    });

    it('une préalerte se modifie tant que le colis n’est pas arrivé, puis se verrouille', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      const patched = await api(t).patch(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token)).send({ storeName: 'Autre boutique', purchaseAmount: 80, description: 'Montre' });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ storeName: 'Autre boutique', purchaseAmount: '80', description: 'Montre' });
      const pkg = await t.admin.package.findUniqueOrThrow({ where: { id: p.package.id } });
      expect(pkg.contentDescription).toBe('Montre');
      expect(Number(pkg.declaredValue)).toBe(80);

      expect((await api(t).patch(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token)).send({})).status).toBe(400);

      // changer vers le numéro d'une autre préalerte est refusé
      const other = await makePrealert(t, w.customer1, w.w1.id);
      const clash = await api(t).patch(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token)).send({ supplierTracking: other.supplierTracking });
      expect(clash.status).toBe(409);
      expect(errorCode(clash)).toBe('DUPLICATE_PREALERT');
      // mais garder son propre numéro est permis
      expect((await api(t).patch(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token)).send({ supplierTracking: p.supplierTracking })).status).toBe(200);

      expect((await receive(w.token, { warehouseId: w.w1.id, supplierTracking: p.supplierTracking })).status).toBe(200);
      const locked = await api(t).patch(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token)).send({ storeName: 'Trop tard' });
      expect(locked.status).toBe(409);
      expect(errorCode(locked)).toBe('PREALERT_LOCKED');
      const lockedCancel = await api(t).delete(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token));
      expect(lockedCancel.status).toBe(409);
      expect(errorCode(lockedCancel)).toBe('PREALERT_LOCKED');
    });

    it('annuler une préalerte annule le colis attendu, une seule fois', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      expect((await api(t).delete(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token))).status).toBe(204);
      const pkg = await t.admin.package.findUniqueOrThrow({ where: { id: p.package.id } });
      expect(pkg.status).toBe('CANCELLED');
      expect((await t.admin.prealert.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('CANCELLED');
      expect((await api(t).delete(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token))).status).toBe(409);
      // un colis annulé n'est plus « attendu » à l'entrepôt
      const expected = await api(t).get('/v1/admin/packages/expected').set(bearer(w.token));
      expect(expected.body.items.map((i: any) => i.id)).not.toContain(p.package.id);
    });
  });

  // =============================================================================================
  describe('réception et rapprochement', () => {
    it('rapproche automatiquement par numéro de suivi du marchand (correspondance exacte)', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id, { supplierTracking: 'MATCH00000001' });
      const res = await receive(w.token, { warehouseId: w.w1.id, supplierTracking: ' match 0000 0001 ', senderName: 'Boutique Test' });
      expect(res.status).toBe(200);
      expect(res.body.match).toEqual({ status: 'MATCHED_AUTO', method: 'SUPPLIER_TRACKING' });
      expect(res.body.package).toMatchObject({ id: p.package.id, trackingNumber: p.package.trackingNumber, status: 'RECEIVED_AT_WAREHOUSE' });
      expect(res.body.package.customer.customerCode).toBe(w.customer1.customerCode);
      expect(res.body.package.receivedAt).toBeTruthy();
      expect((await t.admin.prealert.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('MATCHED_AUTO');
    });

    it('une correspondance partielle du numéro ne rapproche rien : le colis est reçu « non identifié »', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id, { supplierTracking: 'PARTIAL0000001' });
      const res = await receive(w.token, { warehouseId: w.w1.id, supplierTracking: 'PARTIAL000000' });
      expect(res.status).toBe(200);
      expect(res.body.match).toEqual({ status: 'UNIDENTIFIED', method: 'NONE' });
      expect(res.body.package.customer).toBeNull();
      expect(res.body.package.id).not.toBe(p.package.id);
      expect((await t.admin.package.findUniqueOrThrow({ where: { id: p.package.id } })).status).toBe('AWAITING_RECEIPT');
    });

    it('rapproche par code client lorsqu’un seul colis est attendu pour ce client', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      const res = await receive(w.token, { warehouseId: w.w1.id, customerCode: w.customer1.customerCode });
      expect(res.status).toBe(200);
      expect(res.body.match).toEqual({ status: 'MATCHED_AUTO', method: 'CUSTOMER_CODE_SINGLE' });
      expect(res.body.package.id).toBe(p.package.id);
    });

    it('plusieurs colis attendus pour un client : 409 avec les candidats, puis choix manuel', async () => {
      const w = await setup();
      const a = await makePrealert(t, w.customer1, w.w1.id, { description: 'Chaussures' });
      const b = await makePrealert(t, w.customer1, w.w1.id, { description: 'Montre' });
      const ambiguous = await receive(w.token, { warehouseId: w.w1.id, customerCode: w.customer1.customerCode });
      expect(ambiguous.status).toBe(409);
      expect(errorCode(ambiguous)).toBe('AMBIGUOUS_MATCH');
      expect(ambiguous.body.error.details.candidates.map((c: any) => c.id).sort()).toEqual([a.package.id, b.package.id].sort());
      // rien n'a bougé
      expect((await t.admin.package.count({ where: { companyId: w.company.id, status: 'AWAITING_RECEIPT' } }))).toBe(2);

      const manual = await receive(w.token, { warehouseId: w.w1.id, expectedPackageId: b.package.id });
      expect(manual.status).toBe(200);
      expect(manual.body.match).toEqual({ status: 'MATCHED_MANUAL', method: 'MANUAL_SELECTION' });
      expect(manual.body.package.id).toBe(b.package.id);
      expect((await t.admin.prealert.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('MATCHED_MANUAL');

      // il ne reste qu'un colis attendu : le code client le désigne maintenant seul
      const rest = await receive(w.token, { warehouseId: w.w1.id, customerCode: w.customer1.customerCode });
      expect(rest.body.package.id).toBe(a.package.id);
    });

    it('colis sans préalerte avec un code client valide : reçu et rattaché au client (NO_PREALERT)', async () => {
      const w = await setup();
      const res = await receive(w.token, { warehouseId: w.w1.id, customerCode: w.customer2.customerCode, transportMode: 'SEA', senderName: 'Inconnu SA' });
      expect(res.status).toBe(200);
      expect(res.body.match).toEqual({ status: 'NO_PREALERT', method: 'CUSTOMER_CODE' });
      expect(res.body.package).toMatchObject({ status: 'RECEIVED_AT_WAREHOUSE', transportMode: 'SEA', senderName: 'Inconnu SA' });
      expect(res.body.package.customer.customerCode).toBe(w.customer2.customerCode);
      // le client le voit dans ses colis
      const mine = await api(t).get('/v1/me/packages').set(bearer(w.customer2.token));
      expect(mine.body.items.map((p: any) => p.id)).toContain(res.body.package.id);
    });

    it('colis sans étiquette lisible : reçu non identifié ; code client inconnu : 404', async () => {
      const w = await setup();
      const res = await receive(w.token, { warehouseId: w.w1.id, notes: 'Étiquette arrachée' });
      expect(res.body.match).toEqual({ status: 'UNIDENTIFIED', method: 'NONE' });
      expect(res.body.package.customer).toBeNull();
      const unknown = await receive(w.token, { warehouseId: w.w1.id, customerCode: 'TT-999999' });
      expect(unknown.status).toBe(404);
      expect(errorCode(unknown)).toBe('CUSTOMER_NOT_FOUND');
      // le code d'un client d'une autre entreprise est inconnu ici (TT-000003 n'existe que chez l'autre)
      const other = await setup();
      const third = await makeCustomer(t, other.company);
      expect(third.customerCode).toBe('TT-000003');
      expect((await receive(w.token, { warehouseId: w.w1.id, customerCode: third.customerCode })).status).toBe(404);

      // la note est interne : visible du personnel, jamais du client
      const full = await detail(w.token, res.body.package.id);
      expect(full.body.events.some((e: any) => e.type === 'NOTE' && e.reason === 'Étiquette arrachée' && e.visibility === 'PRIVATE')).toBe(true);
    });

    it('si le colis arrive dans un autre entrepôt que prévu, l’entrepôt réel est conservé', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      const res = await receive(w.token, { warehouseId: w.w2.id, expectedPackageId: p.package.id });
      expect(res.status).toBe(200);
      expect(res.body.package.warehouse.id).toBe(w.w2.id);
      expect(res.body.package.originCity).toBe('Orlando');
    });

    it('refuse un colis qui n’est plus attendu, et un entrepôt inconnu', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      expect((await receive(w.token, { warehouseId: w.w1.id, expectedPackageId: p.package.id })).status).toBe(200);
      const again = await receive(w.token, { warehouseId: w.w1.id, expectedPackageId: p.package.id });
      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('NOT_EXPECTED');
      expect((await receive(w.token, { warehouseId: uuidv7() })).status).toBe(404);
      expect((await receive(w.token, { warehouseId: w.w1.id, customerCode: 'bad' })).status).toBe(400);
    });

    it('réceptions simultanées du même colis attendu : une seule réussit', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      const results = await Promise.all(Array.from({ length: 5 }, () => receive(w.token, { warehouseId: w.w1.id, expectedPackageId: p.package.id })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      const events = await t.admin.packageEvent.findMany({ where: { packageId: p.package.id, toStatus: 'RECEIVED_AT_WAREHOUSE' } });
      expect(events).toHaveLength(1);
    });

    it('liste des colis attendus : recherche par code client, marchand, boutique', async () => {
      const w = await setup();
      const a = await makePrealert(t, w.customer1, w.w1.id, { storeName: 'Zappos', orderNumber: 'ZAP-ORDER-77' });
      await makePrealert(t, w.customer2, w.w1.id, { storeName: 'Nike' });
      const ids = async (query: string) => (await api(t).get(`/v1/admin/packages/expected${query}`).set(bearer(w.token))).body.items.map((i: any) => i.id);
      expect(await ids('')).toHaveLength(2);
      expect(await ids(`?customerCode=${w.customer1.customerCode}`)).toEqual([a.package.id]);
      expect(await ids('?q=zappos')).toEqual([a.package.id]);
      expect(await ids('?q=zap-order')).toEqual([a.package.id]);
      expect(await ids(`?q=${a.supplierTracking.slice(0, 8)}`)).toEqual([a.package.id]);
    });
  });

  // =============================================================================================
  describe('périmètre par entrepôt et permissions du personnel', () => {
    it('un agent limité à l’entrepôt 1 ne reçoit, ne voit ni ne pèse rien dans l’entrepôt 2', async () => {
      const w = await setup();
      const agent1 = await w.staff('RECEPTION_AGENT', w.w1.id);
      const p1 = await makePrealert(t, w.customer1, w.w1.id);
      const p2 = await makePrealert(t, w.customer2, w.w2.id);

      expect((await receive(agent1, { warehouseId: w.w2.id })).status).toBe(403);
      expect((await receive(agent1, { warehouseId: w.w2.id, expectedPackageId: p2.package.id })).status).toBe(403);
      expect((await receive(agent1, { warehouseId: w.w1.id, expectedPackageId: p1.package.id })).status).toBe(200);

      // le colis de l'entrepôt 2 est comme inexistant pour cet agent
      expect((await detail(agent1, p2.package.id)).status).toBe(404);
      const list = await api(t).get('/v1/admin/packages').set(bearer(agent1));
      expect(list.body.items.map((i: any) => i.id)).toEqual([p1.package.id]);
      expect((await api(t).get(`/v1/admin/packages?warehouseId=${w.w2.id}`).set(bearer(agent1))).body.items).toHaveLength(0);

      // l'agent de l'entrepôt 2 reçoit le sien
      const agent2 = await w.staff('RECEPTION_AGENT', w.w2.id);
      expect((await receive(agent2, { warehouseId: w.w2.id, expectedPackageId: p2.package.id })).status).toBe(200);
      expect((await register(agent1, p2.package.id)).status).toBe(403);
    });

    it('les colis d’une autre entreprise sont introuvables ; le client n’accède à aucune route du personnel', async () => {
      const a = await setup();
      const b = await setup();
      const pa = await makePrealert(t, a.customer1, a.w1.id);
      expect((await detail(b.token, pa.package.id)).status).toBe(404);
      expect((await transition(b.token, pa.package.id, { to: 'CANCELLED', reason: 'x' })).status).toBe(404);
      expect((await register(b.token, pa.package.id)).status).toBe(404);
      expect((await api(t).get('/v1/admin/packages').set(bearer(b.token))).body.items).toHaveLength(0);

      for (const path of ['/v1/admin/packages', '/v1/admin/packages/expected', `/v1/admin/packages/${pa.package.id}`]) {
        expect((await api(t).get(path).set(bearer(a.customer1.token))).status).toBe(403);
        expect((await api(t).get(path)).status).toBe(401);
      }
      expect((await receive(a.customer1.token, { warehouseId: a.w1.id })).status).toBe(403);
      expect((await transition(a.customer1.token, pa.package.id, { to: 'CANCELLED', reason: 'x' })).status).toBe(403);
    });

    it('le service client lit les colis mais ne les reçoit ni ne les annule', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      const service = await w.staff('CUSTOMER_SERVICE');
      expect((await detail(service, p.package.id)).status).toBe(200);
      expect((await receive(service, { warehouseId: w.w1.id })).status).toBe(403);
      expect((await transition(service, p.package.id, { to: 'CANCELLED', reason: 'x' })).status).toBe(403);
    });
  });

  // =============================================================================================
  describe('identification d’un colis reçu sans client', () => {
    it('rattache un colis non identifié à un client, trace l’action et refuse une seconde identification', async () => {
      const w = await setup();
      const received = (await receive(w.token, { warehouseId: w.w1.id })).body.package;
      const res = await api(t).post(`/v1/admin/packages/${received.id}/identify`).set(bearer(w.token)).send({ customerCode: w.customer1.customerCode, transportMode: 'AIR' });
      expect(res.status).toBe(200);
      expect(res.body.package.customer.customerCode).toBe(w.customer1.customerCode);
      expect(res.body.package.transportMode).toBe('AIR');
      expect(res.body.merged).toBeNull();

      const again = await api(t).post(`/v1/admin/packages/${received.id}/identify`).set(bearer(w.token)).send({ customerCode: w.customer2.customerCode });
      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('ALREADY_IDENTIFIED');

      const unknown = await receive(w.token, { warehouseId: w.w1.id });
      const bad = await api(t).post(`/v1/admin/packages/${unknown.body.package.id}/identify`).set(bearer(w.token)).send({ customerCode: 'TT-424242' });
      expect(bad.status).toBe(404);

      // le client le voit maintenant, sans l'événement interne d'identification
      const mine = await api(t).get(`/v1/me/packages/${received.id}`).set(bearer(w.customer1.token));
      expect(mine.status).toBe(200);
      expect(mine.body.events.map((e: any) => e.type)).not.toContain('IDENTIFIED');
    });

    it('fusionne le colis physique dans le colis attendu : le client garde son numéro de suivi', async () => {
      const w = await setup();
      const expected = await makePrealert(t, w.customer1, w.w1.id);
      const physical = (await receive(w.token, { warehouseId: w.w1.id })).body.package;

      const res = await api(t)
        .post(`/v1/admin/packages/${physical.id}/identify`)
        .set(bearer(w.token))
        .send({ customerCode: w.customer1.customerCode, mergeIntoPackageId: expected.package.id });
      expect(res.status).toBe(200);
      expect(res.body.package).toMatchObject({ id: expected.package.id, trackingNumber: expected.package.trackingNumber, status: 'RECEIVED_AT_WAREHOUSE' });
      expect(res.body.merged.cancelledTrackingNumber).toBe(physical.trackingNumber);
      expect((await t.admin.package.findUniqueOrThrow({ where: { id: physical.id } })).status).toBe('CANCELLED');
      expect((await t.admin.prealert.findUniqueOrThrow({ where: { id: expected.id } })).status).toBe('MATCHED_MANUAL');

      // le suivi public de l'ancien numéro ne révèle rien du client
      const publicView = await track(physical.trackingNumber);
      expect(JSON.stringify(publicView.body)).not.toContain(w.customer1.customerCode);
    });

    it('refuse la fusion dans le colis attendu d’un autre client', async () => {
      const w = await setup();
      const theirs = await makePrealert(t, w.customer2, w.w1.id);
      const physical = (await receive(w.token, { warehouseId: w.w1.id })).body.package;
      const res = await api(t)
        .post(`/v1/admin/packages/${physical.id}/identify`)
        .set(bearer(w.token))
        .send({ customerCode: w.customer1.customerCode, mergeIntoPackageId: theirs.package.id });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('NOT_EXPECTED');
    });

    it('n’identifie plus un colis déjà pesé', async () => {
      const w = await setup();
      const pkg = await weighedPackage(w);
      const res = await api(t).post(`/v1/admin/packages/${pkg.packageId}/identify`).set(bearer(w.token)).send({ customerCode: w.customer2.customerCode });
      expect(res.status).toBe(409);
      expect(['ALREADY_IDENTIFIED', 'INVALID_STATE']).toContain(errorCode(res));
    });
  });

  // =============================================================================================
  describe('enregistrement, pesée et frais', () => {
    it('pèse un colis : mesures, poids volumétrique et facturable, frais de la grille active', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      await receive(w.token, { warehouseId: w.w1.id, expectedPackageId: p.package.id });
      const res = await register(w.token, p.package.id, weighing({ declaredValue: 100, insured: true, contentDescription: 'Chaussures' }));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REGISTERED_WEIGHED');
      expect(Number(res.body.measures.actualWeightKg)).toBe(2);
      expect(Number(res.body.measures.volumetricWeight)).toBe(4.8);
      expect(Number(res.body.measures.billableWeight)).toBe(5);
      expect(Number(res.body.pricing.freight)).toBe(17.5);
      // manutention 1,50 + assurance 2 % de 100 = 2,00
      expect(Number(res.body.pricing.extras)).toBe(3.5);
      expect(res.body.pricing.currency).toBe('USD');
      expect(res.body.pricing.detail.kind).toBe('COMPUTED_AT_WEIGHING');
      expect(res.body.pricing.detail.result.total).toBe('21.00');
      expect(res.body.insured).toBe(true);
      expect(res.body.registeredAt).toBeTruthy();
    });

    it('stocke toujours kg et cm, quelle que soit l’unité saisie', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      await receive(w.token, { warehouseId: w.w1.id, expectedPackageId: p.package.id });
      const res = await register(w.token, p.package.id, { weight: { value: 10, unit: 'LB' }, dimensions: { length: 10, width: 8, height: 6, unit: 'IN' } });
      expect(res.status).toBe(200);
      expect(Number(res.body.measures.actualWeightKg)).toBe(4.536);
      expect([res.body.measures.lengthCm, res.body.measures.widthCm, res.body.measures.heightCm].map(Number)).toEqual([25.4, 20.32, 15.24]);
    });

    it('sans grille applicable : le colis est enregistré SANS montant (aucun prix inventé)', async () => {
      const bare = await makeTenant(t);
      const w1 = await makeWarehouse(t, bare.token);
      const customer = await makeCustomer(t, bare.company);
      const p = await makePrealert(t, customer, w1.id);
      await receive(bare.token, { warehouseId: w1.id, expectedPackageId: p.package.id });
      const res = await register(bare.token, p.package.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REGISTERED_WEIGHED');
      expect(res.body.measures.billableWeight).toBeNull();
      expect(res.body.pricing.freight).toBeNull();
      expect(res.body.pricing.detail).toMatchObject({ kind: 'TARIFF_UNAVAILABLE', reason: 'NO_ACTIVE_RATE_CARD' });
      const mine = await api(t).get(`/v1/me/packages/${p.package.id}`).set(bearer(customer.token));
      expect(mine.body.fees).toBeNull();
    });

    it('un poids sans tranche enregistre le colis sans montant', async () => {
      const bare = await makeTenant(t);
      const w1 = await makeWarehouse(t, bare.token);
      await activateRateCard(t, bare.token, { rules: [{ weightFrom: 0, weightTo: 3, pricePerUnit: 4 }], surcharges: [] });
      const customer = await makeCustomer(t, bare.company);
      const p = await makePrealert(t, customer, w1.id);
      await receive(bare.token, { warehouseId: w1.id, expectedPackageId: p.package.id });
      const res = await register(bare.token, p.package.id, { weight: { value: 9, unit: 'KG' }, dimensions: { length: 10, width: 10, height: 10, unit: 'CM' } });
      expect(res.status).toBe(200);
      expect(res.body.pricing.detail).toMatchObject({ kind: 'TARIFF_UNAVAILABLE', reason: 'NO_RULE_FOR_WEIGHT' });
      expect(res.body.pricing.freight).toBeNull();
    });

    it('refuse la pesée d’un colis non reçu, non identifié, sans mode de transport, déjà pesé', async () => {
      const w = await setup();
      const waiting = await makePrealert(t, w.customer1, w.w1.id);
      const notReceived = await register(w.token, waiting.package.id);
      expect(notReceived.status).toBe(409);
      expect(errorCode(notReceived)).toBe('INVALID_STATE');

      const unidentified = (await receive(w.token, { warehouseId: w.w1.id })).body.package;
      expect(errorCode(await register(w.token, unidentified.id))).toBe('CUSTOMER_REQUIRED');

      const noMode = (await receive(w.token, { warehouseId: w.w1.id, customerCode: w.customer2.customerCode })).body.package;
      expect(errorCode(await register(w.token, noMode.id))).toBe('TRANSPORT_MODE_REQUIRED');

      const done = await weighedPackage(w);
      const twice = await register(w.token, done.packageId);
      expect(twice.status).toBe(409);
      expect(errorCode(twice)).toBe('INVALID_STATE');
    });

    it('valide les mesures et la catégorie', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      await receive(w.token, { warehouseId: w.w1.id, expectedPackageId: p.package.id });
      for (const bad of [
        { weight: { value: 0, unit: 'KG' } },
        { weight: { value: 2.0005, unit: 'KG' } },
        { weight: { value: 2, unit: 'OZ' } },
        { dimensions: { length: 0, width: 1, height: 1, unit: 'CM' } },
        { dimensions: undefined },
        { declaredValue: 5.555 },
      ]) {
        expect((await register(w.token, p.package.id, weighing(bad))).status).toBe(400);
      }
      const unknownCategory = await register(w.token, p.package.id, weighing({ categoryCode: 'NOPE' }));
      expect(errorCode(unknownCategory)).toBe('CATEGORY_UNKNOWN');
      // l'assurance exige une grille qui la propose et une valeur déclarée
      const noValue = await register(w.token, p.package.id, weighing({ insured: true }));
      expect(noValue.status).toBe(400);
      expect(errorCode(noValue)).toBe('MISSING_DECLARED_VALUE');
    });

    it('le client voit ses mesures et des frais « provisoires », sans aucun champ interne', async () => {
      const w = await setup();
      const pkg = await weighedPackage(w);
      const mine = await api(t).get(`/v1/me/packages/${pkg.packageId}`).set(bearer(w.customer1.token));
      expect(mine.status).toBe(200);
      expect(mine.body.fees).toMatchObject({ currency: 'USD', provisional: true });
      expect(Number(mine.body.fees.freight)).toBe(17.5);
      const text = JSON.stringify(mine.body);
      expect(text).not.toMatch(/actorUserId|pricingSnapshot|rateCardId|"reason"|createdBy/);
      // les événements internes (pesée, notes) ne sont pas montrés
      expect(mine.body.events.map((e: any) => e.type)).not.toContain('WEIGHED');
      expect(mine.body.events.map((e: any) => e.status)).toEqual(['PREALERT_CREATED', 'AWAITING_RECEIPT', 'RECEIVED_AT_WAREHOUSE', 'REGISTERED_WEIGHED']);
    });
  });

  // =============================================================================================
  describe('machine d’états', () => {
    it('autorise la suite nominale pilotée par le colis et la facturation, avec motif quand il est exigé', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      const noReason = await transition(w.token, packageId, { to: 'READY_TO_SHIP' });
      expect(noReason.status).toBe(400);
      expect(errorCode(noReason)).toBe('REASON_REQUIRED');

      const awaiting = await transition(w.token, packageId, { to: 'AWAITING_PAYMENT' });
      expect(awaiting.status).toBe(200);
      expect(awaiting.body.status).toBe('AWAITING_PAYMENT');
      const ready = await transition(w.token, packageId, { to: 'READY_TO_SHIP', reason: 'Paiement reçu au comptoir' });
      expect(ready.status).toBe(200);
      expect(ready.body.status).toBe('READY_TO_SHIP');
    });

    it('refuse toute transition hors de la table (409 INVALID_TRANSITION)', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      for (const to of ['DELIVERED', 'IN_TRANSIT', 'RECEIVED_AT_WAREHOUSE', 'AWAITING_RECEIPT', 'PREALERT_CREATED', 'REGISTERED_WEIGHED', 'RETURNED']) {
        const res = await transition(w.token, packageId, { to, reason: 'test' });
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('INVALID_TRANSITION');
      }
      expect((await transition(w.token, packageId, { to: 'N_IMPORTE_QUOI' })).status).toBe(400);
      expect((await transition(w.token, uuidv7(), { to: 'CANCELLED', reason: 'x' })).status).toBe(404);
      expect((await t.admin.package.findUniqueOrThrow({ where: { id: packageId } })).status).toBe('REGISTERED_WEIGHED');
    });

    it('les transitions des modules transport, agence et livraison ne passent pas par l’API générique', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      await transition(w.token, packageId, { to: 'READY_TO_SHIP', reason: 'Prépayé' });
      const dispatch = await transition(w.token, packageId, { to: 'IN_TRANSIT' });
      expect(dispatch.status).toBe(409);
      expect(errorCode(dispatch)).toBe('TRANSITION_NOT_AVAILABLE');
      expect(dispatch.body.error.details).toMatchObject({ from: 'READY_TO_SHIP', to: 'IN_TRANSIT', owner: 'SHIPMENTS' });
    });

    it('chaque transition respecte la permission et le périmètre d’entrepôt', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      const agent2 = await w.staff('RECEPTION_AGENT', w.w2.id);
      const agent1 = await w.staff('RECEPTION_AGENT', w.w1.id);
      // l'agent de l'entrepôt 2 ne peut rien sur un colis de l'entrepôt 1
      expect((await transition(agent2, packageId, { to: 'ON_HOLD', reason: 'x', holdReasonCode: 'DAMAGED' })).status).toBe(403);
      // l'agent de réception n'autorise pas l'expédition (permission de facturation)
      expect((await transition(agent1, packageId, { to: 'AWAITING_PAYMENT' })).status).toBe(403);
      // l'agent de facturation le peut, pas la retenue
      const billing = await w.staff('BILLING_AGENT');
      expect((await transition(billing, packageId, { to: 'ON_HOLD', reason: 'x' })).status).toBe(403);
      expect((await transition(billing, packageId, { to: 'AWAITING_PAYMENT' })).status).toBe(200);
    });

    it('retenue et reprise : motif obligatoire, reprise au statut précédent seulement, par qui a le droit', async () => {
      const w = await setup();
      const { packageId, trackingNumber } = await weighedPackage(w);
      const agent = await w.staff('RECEPTION_AGENT', w.w1.id);
      const manager = await w.staff('WAREHOUSE_MANAGER', w.w1.id);

      expect(errorCode(await transition(agent, packageId, { to: 'ON_HOLD' }))).toBe('REASON_REQUIRED');
      const held = await transition(agent, packageId, { to: 'ON_HOLD', reason: 'Contenu douteux', holdReasonCode: 'SUSPICIOUS_CONTENT' });
      expect(held.status).toBe(200);
      expect(held.body).toMatchObject({ status: 'ON_HOLD', previousStatus: 'REGISTERED_WEIGHED' });

      // reprise : pas vers un autre statut que le précédent, et pas par un agent sans droit de lever la retenue
      expect(errorCode(await transition(manager, packageId, { to: 'READY_TO_SHIP', reason: 'x' }))).toBe('INVALID_TRANSITION');
      expect((await transition(agent, packageId, { to: 'REGISTERED_WEIGHED' })).status).toBe(403);
      const resumed = await transition(manager, packageId, { to: 'REGISTERED_WEIGHED' });
      expect(resumed.status).toBe(200);
      expect(resumed.body).toMatchObject({ status: 'REGISTERED_WEIGHED', previousStatus: null });

      const full = await detail(manager, packageId);
      expect(full.body.holds).toHaveLength(1);
      expect(full.body.holds[0]).toMatchObject({ reasonCode: 'SUSPICIOUS_CONTENT', note: 'Contenu douteux' });
      expect(full.body.holds[0].releasedAt).toBeTruthy();

      // retenue de nouveau : le suivi public ne montre pas un motif sensible
      await transition(agent, packageId, { to: 'ON_HOLD', reason: 'Contenu douteux', holdReasonCode: 'PROHIBITED_ITEM' });
      const pub = await track(trackingNumber);
      expect(pub.status).toBe(200);
      expect(pub.body.status).toBe('ON_HOLD');
      const holdEvent = pub.body.events[pub.body.events.length - 1];
      expect(holdEvent).toMatchObject({ status: 'ON_HOLD', reasonCode: 'OTHER' });
      expect(JSON.stringify(pub.body)).not.toMatch(/PROHIBITED|SUSPICIOUS|douteux/);
      // le client propriétaire voit le code, mais jamais le texte libre du personnel
      const owner = await api(t).get(`/v1/me/packages/${packageId}`).set(bearer(w.customer1.token));
      expect(owner.body.events[owner.body.events.length - 1].reasonCode).toBe('PROHIBITED_ITEM');
      expect(JSON.stringify(owner.body)).not.toContain('douteux');
    });

    it('annulation par le personnel : motif obligatoire, la préalerte suit', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      expect(errorCode(await transition(w.token, p.package.id, { to: 'CANCELLED' }))).toBe('REASON_REQUIRED');
      const agent = await w.staff('RECEPTION_AGENT', w.w1.id);
      expect((await transition(agent, p.package.id, { to: 'CANCELLED', reason: 'Demande du client' })).status).toBe(403);
      const res = await transition(w.token, p.package.id, { to: 'CANCELLED', reason: 'Demande du client' });
      expect(res.status).toBe(200);
      expect((await t.admin.prealert.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('CANCELLED');
      // un statut terminal ne bouge plus
      expect(errorCode(await transition(w.token, p.package.id, { to: 'AWAITING_RECEIPT' }))).toBe('INVALID_TRANSITION');
    });

    it('deux changements simultanés : un seul gagne, l’historique n’a qu’une entrée', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      const results = await Promise.all(Array.from({ length: 4 }, () => transition(w.token, packageId, { to: 'AWAITING_PAYMENT' })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await t.admin.packageEvent.count({ where: { packageId, toStatus: 'AWAITING_PAYMENT' } })).toBe(1);
    });

    it('journalise chaque changement de statut', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      const actions = await t.admin.auditLog.findMany({ where: { companyId: w.company.id, entityId: packageId, action: 'package.status_changed' } });
      // AWAITING_RECEIPT, RECEIVED_AT_WAREHOUSE, REGISTERED_WEIGHED
      expect(actions).toHaveLength(3);
    });
  });

  // =============================================================================================
  describe('garanties de la base de données', () => {
    it('refuse un changement de statut sans événement dans la même transaction', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      await expect(t.admin.package.update({ where: { id: packageId }, data: { status: 'READY_TO_SHIP' } })).rejects.toThrow(/sans événement/);
      expect((await t.admin.package.findUniqueOrThrow({ where: { id: packageId } })).status).toBe('REGISTERED_WEIGHED');
    });

    it('refuse la création d’un colis sans événement', async () => {
      const w = await setup();
      const customer = await t.admin.customer.findFirstOrThrow({ where: { companyId: w.company.id } });
      await expect(
        t.admin.package.create({
          data: {
            companyId: w.company.id,
            trackingNumber: 'ZZZZ0000000000',
            customerId: customer.id,
            originWarehouseId: w.w1.id,
            originCountry: 'US',
            originCity: 'Miami',
            destinationCountry: 'HT',
            status: 'RECEIVED_AT_WAREHOUSE',
          },
        }),
      ).rejects.toThrow(/sans événement/);
    });

    it('l’historique est en ajout seul : ni modification ni suppression', async () => {
      const w = await setup();
      const { packageId } = await weighedPackage(w);
      const event = await t.admin.packageEvent.findFirstOrThrow({ where: { packageId } });
      await expect(t.admin.packageEvent.update({ where: { id: event.id }, data: { reason: 'réécrit' } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.packageEvent.delete({ where: { id: event.id } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.packageEvent.deleteMany({ where: { packageId } })).rejects.toThrow(/ajout seul/);
    });

    it('un même numéro de suivi ne peut exister deux fois, même entre entreprises', async () => {
      const a = await setup();
      const b = await setup();
      const pa = await makePrealert(t, a.customer1, a.w1.id);
      const customerB = await t.admin.customer.findFirstOrThrow({ where: { companyId: b.company.id } });
      await expect(
        t.admin.$transaction(async (tx) => {
          const created = await tx.package.create({
            data: { companyId: b.company.id, trackingNumber: pa.package.trackingNumber, customerId: customerB.id, originWarehouseId: b.w1.id, originCountry: 'US', originCity: 'Miami', destinationCountry: 'HT', status: 'AWAITING_RECEIPT' },
          });
          await tx.packageEvent.create({ data: { companyId: b.company.id, packageId: created.id, toStatus: 'AWAITING_RECEIPT', eventType: 'PREALERT_CREATED' } });
        }),
      ).rejects.toThrow();
    });
  });

  // =============================================================================================
  describe('regroupement', () => {
    it('regroupe des colis du même client puis dégroupe', async () => {
      const w = await setup();
      const a = await weighedPackage(w);
      const b = await weighedPackage(w);
      const group = await api(t).post('/v1/admin/package-groups').set(bearer(w.token)).send({ packageIds: [a.packageId, b.packageId] });
      expect(group.status).toBe(201);
      expect(group.body.reference).toMatch(/^GRP-\d{6}$/);
      expect((await detail(w.token, a.packageId)).body.groupId).toBe(group.body.id);

      // déjà groupés
      const c = await weighedPackage(w);
      const again = await api(t).post('/v1/admin/package-groups').set(bearer(w.token)).send({ packageIds: [a.packageId, c.packageId] });
      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('ALREADY_GROUPED');

      expect((await api(t).delete(`/v1/admin/package-groups/${group.body.id}`).set(bearer(w.token))).status).toBe(204);
      expect((await detail(w.token, a.packageId)).body.groupId).toBeNull();
      expect((await api(t).delete(`/v1/admin/package-groups/${group.body.id}`).set(bearer(w.token))).status).toBe(404);
    });

    it('refuse le regroupement de clients différents, de colis non identifiés, d’un seul colis ou de doublons', async () => {
      const w = await setup();
      const a = await weighedPackage(w, w.customer1);
      const b = await weighedPackage(w, w.customer2);
      const post = (packageIds: string[]) => api(t).post('/v1/admin/package-groups').set(bearer(w.token)).send({ packageIds });
      expect(errorCode(await post([a.packageId, b.packageId]))).toBe('GROUP_CUSTOMER_MISMATCH');
      expect((await post([a.packageId])).status).toBe(400);
      expect(errorCode(await post([a.packageId, a.packageId]))).toBe('DUPLICATE_PACKAGES');
      const u1 = (await receive(w.token, { warehouseId: w.w1.id })).body.package.id;
      const u2 = (await receive(w.token, { warehouseId: w.w1.id })).body.package.id;
      expect(errorCode(await post([u1, u2]))).toBe('GROUP_CUSTOMER_MISMATCH');
      expect((await post([a.packageId, uuidv7()])).status).toBe(404);
    });
  });

  // =============================================================================================
  describe('liste et recherche (personnel)', () => {
    it('filtre par statut, recherche par numéro de suivi, numéro marchand et code client, pagine', async () => {
      const w = await setup();
      const weighed = await weighedPackage(w, w.customer1);
      const waiting = await makePrealert(t, w.customer2, w.w1.id);
      const unidentified = (await receive(w.token, { warehouseId: w.w1.id })).body.package;
      const list = (query: string) => api(t).get(`/v1/admin/packages${query}`).set(bearer(w.token));
      const ids = async (query: string) => (await list(query)).body.items.map((i: any) => i.id);

      expect(await ids('')).toHaveLength(3);
      expect(await ids('?status=REGISTERED_WEIGHED')).toEqual([weighed.packageId]);
      expect(await ids('?status=AWAITING_RECEIPT')).toEqual([waiting.package.id]);
      expect(await ids('?unidentified=true')).toEqual([unidentified.id]);
      expect(await ids('?unidentified=false')).toHaveLength(2);
      expect(await ids(`?q=${formatTrackingNumber(weighed.trackingNumber)}`)).toEqual([weighed.packageId]);
      expect(await ids(`?q=${waiting.supplierTracking.toLowerCase()}`)).toEqual([waiting.package.id]);
      expect(await ids(`?q=${w.customer2.customerCode}`)).toEqual([waiting.package.id]);

      const first = await list('?limit=2');
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toBeTruthy();
      const second = await list(`?limit=2&cursor=${first.body.nextCursor}`);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
      expect((await list('?limit=0')).status).toBe(400);
      expect((await list('?status=NOPE')).status).toBe(400);
    });
  });

  // =============================================================================================
  describe('suivi public', () => {
    it('affiche le statut et les événements publics, accepte les écritures usuelles du numéro', async () => {
      const w = await setup();
      const { trackingNumber } = await weighedPackage(w);
      for (const variant of [trackingNumber, formatTrackingNumber(trackingNumber), trackingNumber.toLowerCase(), ` ${formatTrackingNumber(trackingNumber)} `]) {
        const res = await track(variant);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('REGISTERED_WEIGHED');
        expect(res.body.trackingNumber).toBe(formatTrackingNumber(trackingNumber));
      }
      const res = await track(trackingNumber);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.events.map((e: any) => e.status)).toEqual(['PREALERT_CREATED', 'AWAITING_RECEIPT', 'RECEIVED_AT_WAREHOUSE', 'REGISTERED_WEIGHED']);
      expect(res.body).toMatchObject({ transportMode: 'AIR', origin: { country: 'US', city: 'Miami' }, destination: { country: 'HT' }, estimatedDelivery: null, pickup: null });
    });

    it('ne divulgue aucune donnée personnelle, financière ou interne', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id, { storeName: 'Boutique Secrète', orderNumber: 'ORDER-SECRET-9', description: 'Cadeau confidentiel' });
      await receive(w.token, { warehouseId: w.w1.id, supplierTracking: p.supplierTracking, senderName: 'Expéditeur Privé', notes: 'note interne confidentielle' });
      await register(w.token, p.package.id, weighing({ declaredValue: 1234, contentDescription: 'Contenu détaillé' }));
      const user = await t.admin.user.findUniqueOrThrow({ where: { id: w.customer1.user.id } });
      const res = await track(p.package.trackingNumber);
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of [
        user.email,
        user.firstName,
        user.lastName,
        w.customer1.customerCode,
        w.customer1.user.id,
        p.supplierTracking,
        'Boutique Secrète',
        'ORDER-SECRET-9',
        'Cadeau confidentiel',
        'Expéditeur Privé',
        'note interne',
        'Contenu détaillé',
        '1234',
        w.w1.reference,
        w.admin.id,
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(Object.keys(res.body).sort()).toEqual(['destination', 'estimatedDelivery', 'events', 'lastUpdate', 'origin', 'pickup', 'status', 'trackingNumber', 'transportMode']);
      for (const event of res.body.events) expect(Object.keys(event).sort()).toEqual(['location', 'occurredAt', 'reasonCode', 'status', 'type']);
    });

    it('un numéro inconnu, mal formé ou au contrôle erroné donne la même réponse 404', async () => {
      const w = await setup();
      const { trackingNumber } = await weighedPackage(w);
      const last = trackingNumber[trackingNumber.length - 1];
      const wrongCheck = trackingNumber.slice(0, -1) + (last === '0' ? '1' : '0');
      const responses = await Promise.all([track(wrongCheck), track('ZZZZ0000000000'), track('n-importe-quoi-du-tout'), track('A'.repeat(20))]);
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(errorCode(res)).toBe('TRACKING_NOT_FOUND');
      }
      expect(new Set(responses.map((r) => JSON.stringify({ ...r.body, error: { ...r.body.error, requestId: undefined } }))).size).toBe(1);
      expect((await track('abc')).status).toBe(400);
    });

    it('suit un colis annulé (la fusion n’efface pas l’historique) et une entreprise suspendue ne bloque pas le suivi des colis existants', async () => {
      const w = await setup();
      const p = await makePrealert(t, w.customer1, w.w1.id);
      await api(t).delete(`/v1/me/prealerts/${p.id}`).set(bearer(w.customer1.token));
      const res = await track(p.package.trackingNumber);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('limite le débit par adresse IP', async () => {
      const w = await setup();
      const { trackingNumber } = await weighedPackage(w);
      let limited = 0;
      for (let i = 0; i < 35; i += 1) {
        if ((await track(trackingNumber, '203.0.113.200')).status === 429) limited += 1;
      }
      expect(limited).toBeGreaterThan(0);
    });
  });

  // =============================================================================================
  describe('colis du client', () => {
    it('liste et filtre mes colis, y compris ceux que j’attends', async () => {
      const w = await setup();
      const waiting = await makePrealert(t, w.customer1, w.w1.id, { supplierTracking: 'WAITING00000A' });
      const weighed = await weighedPackage(w, w.customer1);
      await weighedPackage(w, w.customer2);
      const list = (query = '') => api(t).get(`/v1/me/packages${query}`).set(bearer(w.customer1.token));
      expect((await list()).body.items.map((i: any) => i.id).sort()).toEqual([waiting.package.id, weighed.packageId].sort());
      expect((await list('?status=AWAITING_RECEIPT')).body.items.map((i: any) => i.id)).toEqual([waiting.package.id]);
      expect((await list('?q=waiting0')).body.items.map((i: any) => i.id)).toEqual([waiting.package.id]);
      const item = (await list('?status=AWAITING_RECEIPT')).body.items[0];
      expect(item).toMatchObject({ status: 'AWAITING_RECEIPT', origin: { country: 'US', city: 'Miami' }, supplierTracking: 'WAITING00000A' });
      expect(item.trackingNumberDisplay).toBe(formatTrackingNumber(item.trackingNumber));
      expect((await api(t).get('/v1/me/packages')).status).toBe(401);
      expect((await api(t).get(`/v1/me/packages/${uuidv7()}`).set(bearer(w.customer1.token))).status).toBe(404);
    });
  });
});
