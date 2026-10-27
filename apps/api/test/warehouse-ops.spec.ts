import { formatTrackingNumber } from '@b2c/shared';
import { v7 as uuidv7 } from 'uuid';
import {
  api,
  bearer,
  buildTestApp,
  login,
  makeAgency,
  makeCustomer,
  makePrealert,
  makeTenant,
  makeUser,
  makeWarehouse,
  readyPackage,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Entrepôt : emplacements, mouvements, inventaire, scan, agences', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const tenant = await makeTenant(t);
    const w1 = await makeWarehouse(t, tenant.token, { city: 'Miami' });
    const w2 = await makeWarehouse(t, tenant.token, { city: 'Orlando' });
    const staff = async (roleCode: 'RECEPTION_AGENT' | 'WAREHOUSE_MANAGER' | 'LOGISTICS_MANAGER' | 'AGENCY_MANAGER' | 'BILLING_AGENT', scope?: { type: 'WAREHOUSE' | 'AGENCY'; id: string }) => {
      const user = await makeUser(t, { company: tenant.company, roleCode, scope });
      return (await login(t, user)).accessToken;
    };
    const customer1 = await makeCustomer(t, tenant.company);
    const customer2 = await makeCustomer(t, tenant.company);
    return { ...tenant, w1, w2, staff, customer1, customer2 };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const createLocation = (token: string, warehouseId: string, body: Record<string, unknown>) =>
    api(t).post(`/v1/admin/warehouses/${warehouseId}/locations`).set(bearer(token)).send(body);
  const move = (token: string, packageId: string, body: Record<string, unknown>) =>
    api(t).post(`/v1/admin/packages/${packageId}/move`).set(bearer(token)).send(body);
  const scan = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/scan/receive').set(bearer(token)).send(body);

  /** Colis reçu (pas encore pesé) dans l'entrepôt. */
  async function receivedPackage(w: World, warehouseId = w.w1.id) {
    const prealert = await makePrealert(t, w.customer1, warehouseId);
    const res = await api(t).post('/v1/admin/packages/receive').set(bearer(w.token)).send({ warehouseId, expectedPackageId: prealert.package.id });
    expect(res.status).toBe(200);
    return { id: prealert.package.id as string, trackingNumber: prealert.package.trackingNumber as string, supplier: prealert.supplierTracking as string };
  }

  // =============================================================================================
  describe('emplacements', () => {
    it('crée, liste, modifie ; code normalisé, doublon refusé, format contrôlé', async () => {
      const w = await setup();
      const created = await createLocation(w.token, w.w1.id, { code: 'a-01', kind: 'SHELF' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'A-01', kind: 'SHELF', status: 'ACTIVE', warehouseId: w.w1.id });
      expect(errorCode(await createLocation(w.token, w.w1.id, { code: 'A-01' }))).toBe('LOCATION_CODE_USED');
      // le même code existe librement dans un autre entrepôt
      expect((await createLocation(w.token, w.w2.id, { code: 'A-01' })).status).toBe(201);
      for (const code of ['', 'a b', '-x', '../x']) expect((await createLocation(w.token, w.w1.id, { code })).status).toBe(400);
      expect((await createLocation(w.token, uuidv7(), { code: 'Z1' })).status).toBe(404);

      const list = await api(t).get(`/v1/admin/warehouses/${w.w1.id}/locations`).set(bearer(w.token));
      expect(list.body.items.map((l: any) => l.code)).toEqual(['A-01']);

      const patched = await api(t).patch(`/v1/admin/locations/${created.body.id}`).set(bearer(w.token)).send({ kind: 'BIN' });
      expect(patched.body).toMatchObject({ kind: 'BIN', status: 'ACTIVE' });
      // modifier le type ne désactive pas l'emplacement
      expect((await api(t).patch(`/v1/admin/locations/${created.body.id}`).set(bearer(w.token)).send({})).status).toBe(400);
    });

    it('droits par entrepôt : un responsable limité à l’entrepôt 1 ne gère pas l’entrepôt 2 ; un agent de réception ne gère aucun emplacement', async () => {
      const w = await setup();
      const manager = await w.staff('WAREHOUSE_MANAGER', { type: 'WAREHOUSE', id: w.w1.id });
      const agent = await w.staff('RECEPTION_AGENT', { type: 'WAREHOUSE', id: w.w1.id });
      expect((await createLocation(manager, w.w1.id, { code: 'M1' })).status).toBe(201);
      expect((await createLocation(manager, w.w2.id, { code: 'M1' })).status).toBe(403);
      expect((await createLocation(agent, w.w1.id, { code: 'M2' })).status).toBe(403);
      expect((await api(t).get(`/v1/admin/warehouses/${w.w2.id}/locations`).set(bearer(manager))).status).toBe(403);
      expect((await createLocation(w.customer1.token, w.w1.id, { code: 'C1' })).status).toBe(403);
      expect((await api(t).get(`/v1/admin/warehouses/${w.w1.id}/locations`)).status).toBe(401);
    });

    it('un emplacement qui contient des colis ne se désactive pas', async () => {
      const w = await setup();
      const loc = (await createLocation(w.token, w.w1.id, { code: 'L1' })).body;
      const pkg = await receivedPackage(w);
      await move(w.token, pkg.id, { locationId: loc.id });
      const refused = await api(t).patch(`/v1/admin/locations/${loc.id}`).set(bearer(w.token)).send({ status: 'INACTIVE' });
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('LOCATION_NOT_EMPTY');
      await move(w.token, pkg.id, { locationId: null });
      expect((await api(t).patch(`/v1/admin/locations/${loc.id}`).set(bearer(w.token)).send({ status: 'INACTIVE' })).body.status).toBe('INACTIVE');
    });
  });

  // =============================================================================================
  describe('mouvements', () => {
    it('range, déplace, sort : chaque changement laisse un mouvement dans l’ordre', async () => {
      const w = await setup();
      const a = (await createLocation(w.token, w.w1.id, { code: 'A1' })).body;
      const b = (await createLocation(w.token, w.w1.id, { code: 'B1' })).body;
      const pkg = await receivedPackage(w);

      const first = await move(w.token, pkg.id, { locationId: a.id, note: 'Arrivée' });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ moved: true });
      expect(first.body.package.locationId).toBe(a.id);
      expect((await move(w.token, pkg.id, { locationId: b.id })).body.moved).toBe(true);
      // même emplacement : sans effet, aucun mouvement ajouté
      const same = await move(w.token, pkg.id, { locationId: b.id });
      expect(same.body.moved).toBe(false);
      expect((await move(w.token, pkg.id, { locationId: null })).body.moved).toBe(true);

      const history = await api(t).get(`/v1/admin/packages/${pkg.id}/movements`).set(bearer(w.token));
      expect(history.body.items.map((m: any) => [m.kind, m.from, m.to])).toEqual([
        ['IN', null, 'A1'],
        ['MOVE', 'A1', 'B1'],
        ['OUT', 'B1', null],
      ]);
      expect(history.body.items[0].note).toBe('Arrivée');
    });

    it('refuse un emplacement d’un autre entrepôt, inactif ou inconnu, et un colis qui n’est pas encore en entrepôt', async () => {
      const w = await setup();
      const other = (await createLocation(w.token, w.w2.id, { code: 'X1' })).body;
      const inactive = (await createLocation(w.token, w.w1.id, { code: 'X2' })).body;
      await api(t).patch(`/v1/admin/locations/${inactive.id}`).set(bearer(w.token)).send({ status: 'INACTIVE' });
      const pkg = await receivedPackage(w);
      expect((await move(w.token, pkg.id, { locationId: other.id })).status).toBe(404);
      const refusedInactive = await move(w.token, pkg.id, { locationId: inactive.id });
      expect(refusedInactive.status).toBe(409);
      expect(errorCode(refusedInactive)).toBe('LOCATION_INACTIVE');
      expect((await move(w.token, pkg.id, { locationId: uuidv7() })).status).toBe(404);
      expect((await move(w.token, pkg.id, { locationId: 'pas-un-uuid' })).status).toBe(400);

      const waiting = await makePrealert(t, w.customer1, w.w1.id);
      const good = (await createLocation(w.token, w.w1.id, { code: 'OK1' })).body;
      const notHere = await move(w.token, waiting.package.id, { locationId: good.id });
      expect(notHere.status).toBe(409);
      expect(errorCode(notHere)).toBe('NOT_IN_WAREHOUSE');
      expect((await move(w.token, uuidv7(), { locationId: good.id })).status).toBe(404);
    });

    it('droits : l’agent de l’entrepôt 1 déplace ses colis, pas ceux de l’entrepôt 2 ; un client n’a aucun accès', async () => {
      const w = await setup();
      const agent1 = await w.staff('RECEPTION_AGENT', { type: 'WAREHOUSE', id: w.w1.id });
      const loc1 = (await createLocation(w.token, w.w1.id, { code: 'S1' })).body;
      const loc2 = (await createLocation(w.token, w.w2.id, { code: 'S2' })).body;
      const p1 = await receivedPackage(w, w.w1.id);
      const p2 = await receivedPackage(w, w.w2.id);
      expect((await move(agent1, p1.id, { locationId: loc1.id })).status).toBe(200);
      expect((await move(agent1, p2.id, { locationId: loc2.id })).status).toBe(403);
      expect((await api(t).get(`/v1/admin/packages/${p2.id}/movements`).set(bearer(agent1))).status).toBe(404);
      expect((await move(w.customer1.token, p1.id, { locationId: null })).status).toBe(403);
    });

    it('la base refuse un emplacement d’un autre entrepôt et la modification de l’historique des mouvements', async () => {
      const w = await setup();
      const other = (await createLocation(w.token, w.w2.id, { code: 'D1' })).body;
      const mine = (await createLocation(w.token, w.w1.id, { code: 'D2' })).body;
      const pkg = await receivedPackage(w);
      await expect(t.admin.package.update({ where: { id: pkg.id }, data: { locationId: other.id } })).rejects.toThrow(/autre entrepôt/);
      await move(w.token, pkg.id, { locationId: mine.id });
      const movement = await t.admin.warehouseMovement.findFirstOrThrow({ where: { packageId: pkg.id } });
      await expect(t.admin.warehouseMovement.update({ where: { id: movement.id }, data: { note: 'réécrit' } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.warehouseMovement.delete({ where: { id: movement.id } })).rejects.toThrow(/ajout seul/);
    });
  });

  // =============================================================================================
  describe('inventaire et anomalies', () => {
    it('compte les colis présents par emplacement, hors colis attendus', async () => {
      const w = await setup();
      const a = (await createLocation(w.token, w.w1.id, { code: 'I1' })).body;
      await createLocation(w.token, w.w1.id, { code: 'I2' });
      const p1 = await receivedPackage(w);
      const p2 = await receivedPackage(w);
      await receivedPackage(w);
      await makePrealert(t, w.customer1, w.w1.id); // attendu : pas encore en entrepôt
      await receivedPackage(w, w.w2.id); // autre entrepôt
      await move(w.token, p1.id, { locationId: a.id });
      await move(w.token, p2.id, { locationId: a.id });

      const inv = await api(t).get(`/v1/admin/warehouses/${w.w1.id}/inventory`).set(bearer(w.token));
      expect(inv.status).toBe(200);
      expect(inv.body).toMatchObject({ total: 3, unplaced: 1 });
      expect(inv.body.locations.map((l: any) => [l.code, l.count])).toEqual([['I1', 2], ['I2', 0]]);
      expect(inv.body.items).toHaveLength(3);

      const filtered = await api(t).get(`/v1/admin/warehouses/${w.w1.id}/inventory?locationId=${a.id}`).set(bearer(w.token));
      expect(filtered.body.items.map((i: any) => i.id).sort()).toEqual([p1.id, p2.id].sort());
      expect(filtered.body.total).toBe(3);
    });

    it('limite l’inventaire à l’entrepôt du périmètre', async () => {
      const w = await setup();
      const agent = await w.staff('RECEPTION_AGENT', { type: 'WAREHOUSE', id: w.w1.id });
      expect((await api(t).get(`/v1/admin/warehouses/${w.w1.id}/inventory`).set(bearer(agent))).status).toBe(200);
      expect((await api(t).get(`/v1/admin/warehouses/${w.w2.id}/inventory`).set(bearer(agent))).status).toBe(403);
      expect((await api(t).get(`/v1/admin/warehouses/${w.w1.id}/inventory`).set(bearer(w.customer1.token))).status).toBe(403);
      expect((await api(t).get(`/v1/admin/warehouses/${uuidv7()}/inventory`).set(bearer(w.token))).status).toBe(404);
    });

    it('un colis qui part dans un lot sort de l’inventaire', async () => {
      const w = await setup();
      const loc = (await createLocation(w.token, w.w1.id, { code: 'G1' })).body;
      const ready = await readyPackage(t, w, w.customer1, w.w1.id);
      await move(w.token, ready.packageId, { locationId: loc.id });
      const shipment = (await api(t).post('/v1/admin/shipments').set(bearer(w.token)).send({ transportMode: 'AIR', originWarehouseId: w.w1.id, destinationCountry: 'HT' })).body;
      expect((await api(t).post(`/v1/admin/shipments/${shipment.id}/packages`).set(bearer(w.token)).send({ packageId: ready.packageId })).status).toBe(200);
      expect((await api(t).get(`/v1/admin/warehouses/${w.w1.id}/inventory`).set(bearer(w.token))).body.total).toBe(1);
      expect((await api(t).post(`/v1/admin/shipments/${shipment.id}/dispatch`).set(bearer(w.token)).send({})).status).toBe(200);
      const after = await api(t).get(`/v1/admin/warehouses/${w.w1.id}/inventory`).set(bearer(w.token));
      expect(after.body.total).toBe(0);
      expect(after.body.locations.find((l: any) => l.code === 'G1').count).toBe(0);
      // et une retenue en transit ne le fait pas revenir
      await api(t).post(`/v1/admin/packages/${ready.packageId}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Vérification', holdReasonCode: 'CUSTOMS' });
      expect((await api(t).get(`/v1/admin/warehouses/${w.w1.id}/inventory`).set(bearer(w.token))).body.total).toBe(0);
    });

    it('file des anomalies : retenues ouvertes et colis sans client, selon le périmètre', async () => {
      const w = await setup();
      const held = await receivedPackage(w);
      const heldOther = await receivedPackage(w, w.w2.id);
      for (const p of [held, heldOther]) {
        const r = await api(t).post(`/v1/admin/packages/${p.id}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Colis abîmé', holdReasonCode: 'DAMAGED' });
        expect(r.status).toBe(200);
      }
      const unidentified = (await scan(w.token, { warehouseId: w.w1.id, code: 'INCONNU-0001' })).body.package;

      const all = await api(t).get('/v1/admin/anomalies').set(bearer(w.token));
      expect(all.body.holds.map((h: any) => h.package.id).sort()).toEqual([held.id, heldOther.id].sort());
      expect(all.body.holds[0]).toMatchObject({ reasonCode: 'DAMAGED', note: 'Colis abîmé' });
      expect(all.body.unidentified.map((p: any) => p.id)).toEqual([unidentified.id]);

      const agent = await w.staff('RECEPTION_AGENT', { type: 'WAREHOUSE', id: w.w1.id });
      const scoped = await api(t).get('/v1/admin/anomalies').set(bearer(agent));
      expect(scoped.body.holds.map((h: any) => h.package.id)).toEqual([held.id]);
      expect((await api(t).get(`/v1/admin/anomalies?warehouseId=${w.w2.id}`).set(bearer(agent))).status).toBe(403);

      // une retenue levée sort de la file
      const manager = await w.staff('WAREHOUSE_MANAGER', { type: 'WAREHOUSE', id: w.w1.id });
      await api(t).post(`/v1/admin/packages/${held.id}/transitions`).set(bearer(manager)).send({ to: 'RECEIVED_AT_WAREHOUSE' });
      expect((await api(t).get('/v1/admin/anomalies').set(bearer(manager))).body.holds).toHaveLength(0);
      expect((await api(t).get('/v1/admin/anomalies').set(bearer(w.customer1.token))).status).toBe(403);
    });
  });

  // =============================================================================================
  describe('réception par scan', () => {
    it('reçoit un colis attendu par son numéro de suivi (avec ou sans tirets) ou par le numéro du marchand', async () => {
      const w = await setup();
      const a = await makePrealert(t, w.customer1, w.w1.id);
      const b = await makePrealert(t, w.customer2, w.w1.id);

      const byTracking = await scan(w.token, { warehouseId: w.w1.id, code: formatTrackingNumber(a.package.trackingNumber).toLowerCase() });
      expect(byTracking.status).toBe(200);
      expect(byTracking.body).toMatchObject({ outcome: 'RECEIVED', match: { status: 'MATCHED_AUTO', method: 'TRACKING_NUMBER' } });
      expect(byTracking.body.package).toMatchObject({ id: a.package.id, status: 'RECEIVED_AT_WAREHOUSE' });
      expect(byTracking.body.package.customer.customerCode).toBe(w.customer1.customerCode);

      const bySupplier = await scan(w.token, { warehouseId: w.w1.id, code: b.supplierTracking.toLowerCase() });
      expect(bySupplier.body).toMatchObject({ outcome: 'RECEIVED', match: { method: 'SUPPLIER_TRACKING' } });
      expect(bySupplier.body.package.id).toBe(b.package.id);
      expect((await t.admin.prealert.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('MATCHED_AUTO');
    });

    it('relire un colis déjà reçu est sans effet ; un code inconnu crée un colis non identifié, une seule fois', async () => {
      const w = await setup();
      const a = await makePrealert(t, w.customer1, w.w1.id);
      await scan(w.token, { warehouseId: w.w1.id, code: a.supplierTracking });
      const again = await scan(w.token, { warehouseId: w.w1.id, code: a.supplierTracking });
      expect(again.body.outcome).toBe('ALREADY_RECEIVED');
      expect(await t.admin.packageEvent.count({ where: { packageId: a.package.id, toStatus: 'RECEIVED_AT_WAREHOUSE' } })).toBe(1);

      const unknown = await scan(w.token, { warehouseId: w.w1.id, code: 'ZX-4412-INCONNU', transportMode: 'SEA' });
      expect(unknown.body).toMatchObject({ outcome: 'UNIDENTIFIED', match: { status: 'UNIDENTIFIED' } });
      expect(unknown.body.package).toMatchObject({ customer: null, supplierTracking: 'ZX-4412-INCONNU', transportMode: 'SEA', status: 'RECEIVED_AT_WAREHOUSE' });
      const rescan = await scan(w.token, { warehouseId: w.w1.id, code: 'zx-4412-inconnu' });
      expect(rescan.body.outcome).toBe('ALREADY_RECEIVED');
      expect(rescan.body.package.id).toBe(unknown.body.package.id);
    });

    it('6 lectures simultanées du même code inconnu : un seul colis créé', async () => {
      const w = await setup();
      const results = await Promise.all(Array.from({ length: 6 }, () => scan(w.token, { warehouseId: w.w1.id, code: 'RACE-INCONNU-77' })));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.outcome === 'UNIDENTIFIED')).toHaveLength(1);
      expect(results.filter((r) => r.body.outcome === 'ALREADY_RECEIVED')).toHaveLength(5);
      expect(await t.admin.package.count({ where: { companyId: w.company.id, supplierTracking: 'RACE-INCONNU-77' } })).toBe(1);
    });

    it('6 lectures simultanées d’un colis attendu : une réception, un seul événement', async () => {
      const w = await setup();
      const a = await makePrealert(t, w.customer1, w.w1.id);
      const results = await Promise.all(Array.from({ length: 6 }, () => scan(w.token, { warehouseId: w.w1.id, code: a.package.trackingNumber })));
      expect(results.filter((r) => r.body.outcome === 'RECEIVED')).toHaveLength(1);
      expect(results.filter((r) => r.body.outcome === 'ALREADY_RECEIVED')).toHaveLength(5);
      expect(await t.admin.packageEvent.count({ where: { packageId: a.package.id, toStatus: 'RECEIVED_AT_WAREHOUSE' } })).toBe(1);
    });

    it('refuse un colis annulé, un code illisible, un entrepôt inconnu ou hors périmètre', async () => {
      const w = await setup();
      const a = await makePrealert(t, w.customer1, w.w1.id);
      await api(t).delete(`/v1/me/prealerts/${a.id}`).set(bearer(w.customer1.token));
      const cancelled = await scan(w.token, { warehouseId: w.w1.id, code: a.package.trackingNumber });
      expect(cancelled.status).toBe(409);
      expect(errorCode(cancelled)).toBe('PACKAGE_CANCELLED');
      for (const code of ['abc', '', '<script>x</script>', "1Z' OR '1'='1", 'a'.repeat(81)]) {
        expect((await scan(w.token, { warehouseId: w.w1.id, code })).status).toBe(400);
      }
      expect((await scan(w.token, { warehouseId: uuidv7(), code: 'CODE-0001' })).status).toBe(404);
      const agent1 = await w.staff('RECEPTION_AGENT', { type: 'WAREHOUSE', id: w.w1.id });
      expect((await scan(agent1, { warehouseId: w.w2.id, code: 'CODE-0002' })).status).toBe(403);
      expect((await scan(agent1, { warehouseId: w.w1.id, code: 'CODE-0002' })).status).toBe(200);
      expect((await scan(w.customer1.token, { warehouseId: w.w1.id, code: 'CODE-0003' })).status).toBe(403);
      expect((await api(t).post('/v1/admin/scan/receive').send({ warehouseId: w.w1.id, code: 'CODE-0003' })).status).toBe(401);
    });

    it('un colis inconnu identifié ensuite reçoit son mode à la pesée ; un mode déjà connu n’est pas écrasé', async () => {
      const w = await setup();
      const unknown = (await scan(w.token, { warehouseId: w.w1.id, code: 'MODE-INCONNU-01' })).body.package;
      const identify = await api(t).post(`/v1/admin/packages/${unknown.id}/identify`).set(bearer(w.token)).send({ customerCode: w.customer1.customerCode });
      expect(identify.status).toBe(200);
      const body = { weight: { value: 2, unit: 'KG' }, dimensions: { length: 10, width: 10, height: 10, unit: 'CM' } };
      const register = (id: string, extra: Record<string, unknown> = {}) => api(t).post(`/v1/admin/packages/${id}/register`).set(bearer(w.token)).send({ ...body, ...extra });
      expect(errorCode(await register(unknown.id))).toBe('TRANSPORT_MODE_REQUIRED');
      const done = await register(unknown.id, { transportMode: 'SEA' });
      expect(done.status).toBe(200);
      expect(done.body.transportMode).toBe('SEA');

      const known = await receivedPackage(w); // préalerte AIR
      const kept = await register(known.id, { transportMode: 'SEA' });
      expect(kept.body.transportMode).toBe('AIR');
    });

    it('le colis scanné dans un autre entrepôt que prévu y est reçu', async () => {
      const w = await setup();
      const a = await makePrealert(t, w.customer1, w.w1.id);
      const res = await scan(w.token, { warehouseId: w.w2.id, code: a.package.trackingNumber });
      expect(res.body.package.warehouse.id).toBe(w.w2.id);
    });
  });

  // =============================================================================================
  describe('agences', () => {
    it('crée, liste, modifie ; code unique ; modifier un champ ne remet pas les autres à leur défaut', async () => {
      const w = await setup();
      const agency = await makeAgency(t, w.token, { code: 'pap-1', kind: 'PICKUP_POINT', publicVisible: false });
      expect(agency.code).toBe('PAP-1');
      const dup = await api(t).post('/v1/admin/agencies').set(bearer(w.token)).send({ code: 'PAP-1', name: 'Autre', country: 'HT', city: 'X', addressLine: 'Y' });
      expect(dup.status).toBe(409);
      expect(errorCode(dup)).toBe('AGENCY_CODE_USED');

      const renamed = await api(t).patch(`/v1/admin/agencies/${agency.id}`).set(bearer(w.token)).send({ name: 'Nouveau nom' });
      expect(renamed.body).toMatchObject({ name: 'Nouveau nom', kind: 'PICKUP_POINT', publicVisible: false, status: 'ACTIVE' });
      const cleared = await api(t).patch(`/v1/admin/agencies/${agency.id}`).set(bearer(w.token)).send({ phone: null, hours: null });
      expect(cleared.body).toMatchObject({ phone: null, hours: null });
      expect((await api(t).patch(`/v1/admin/agencies/${agency.id}`).set(bearer(w.token)).send({})).status).toBe(400);
      expect((await api(t).patch(`/v1/admin/agencies/${agency.id}`).set(bearer(w.token)).send({ code: 'NEW' })).status).toBe(400);
      expect((await api(t).patch(`/v1/admin/agencies/${uuidv7()}`).set(bearer(w.token)).send({ name: 'x' })).status).toBe(404);
      expect((await api(t).get('/v1/admin/agencies').set(bearer(w.token))).body.items.map((a: any) => a.id)).toEqual([agency.id]);
    });

    it('droits : un responsable d’agence ne voit et ne gère que sa propre agence', async () => {
      const w = await setup();
      const a = await makeAgency(t, w.token);
      const b = await makeAgency(t, w.token);
      const managerA = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: a.id });
      expect((await api(t).get('/v1/admin/agencies').set(bearer(managerA))).body.items.map((x: any) => x.id)).toEqual([a.id]);
      expect((await api(t).get(`/v1/admin/agencies/${a.id}/packages`).set(bearer(managerA))).status).toBe(200);
      expect((await api(t).get(`/v1/admin/agencies/${b.id}/packages`).set(bearer(managerA))).status).toBe(403);
      // créer ou modifier relève de l'administration
      expect((await api(t).post('/v1/admin/agencies').set(bearer(managerA)).send({ code: 'ZZ', name: 'x', country: 'HT', city: 'x', addressLine: 'x' })).status).toBe(403);
      expect((await api(t).patch(`/v1/admin/agencies/${a.id}`).set(bearer(managerA)).send({ name: 'x' })).status).toBe(403);
      expect((await api(t).get('/v1/admin/agencies').set(bearer(w.customer1.token))).status).toBe(403);
    });

    it('un rôle d’agence exige une agence existante de la même entreprise', async () => {
      const w = await setup();
      const other = await setup();
      const foreign = await makeAgency(t, other.token);
      const invite = (scopeId: string) =>
        api(t)
          .post('/v1/admin/users')
          .set(bearer(w.token))
          .send({ email: `inv${Date.now()}${Math.random().toString(16).slice(2, 6)}@test.example`, firstName: 'A', lastName: 'B', locale: 'fr', roles: [{ roleCode: 'AGENCY_MANAGER', scopeType: 'AGENCY', scopeId }] });
      expect(errorCode(await invite(uuidv7()))).toBe('SCOPE_NOT_FOUND');
      expect(errorCode(await invite(foreign.id))).toBe('SCOPE_NOT_FOUND');
      const own = await makeAgency(t, w.token);
      expect((await invite(own.id)).status).toBe(201);
    });

    it('liste publique : agences actives et visibles seulement, sans aucune donnée de colis', async () => {
      const w = await setup();
      await makeAgency(t, w.token, { name: 'Agence visible', city: 'Cap-Haïtien' });
      await makeAgency(t, w.token, { name: 'Agence cachée', publicVisible: false });
      const inactive = await makeAgency(t, w.token, { name: 'Agence fermée' });
      await api(t).patch(`/v1/admin/agencies/${inactive.id}`).set(bearer(w.token)).send({ status: 'INACTIVE' });

      const res = await api(t).get(`/v1/public/companies/${w.company.slug}/agencies`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('max-age=60');
      expect(res.body.items.map((a: any) => a.name)).toEqual(['Agence visible']);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(['addressLine', 'city', 'country', 'hours', 'kind', 'name', 'phone']);
      expect((await api(t).get('/v1/public/companies/nope-nope/agencies')).status).toBe(404);
    });

    it('affecte une agence à un colis : même pays, agence active, avant l’arrivée seulement', async () => {
      const w = await setup();
      const haiti = await makeAgency(t, w.token);
      const dominican = await makeAgency(t, w.token, { country: 'do' });
      const inactive = await makeAgency(t, w.token);
      await api(t).patch(`/v1/admin/agencies/${inactive.id}`).set(bearer(w.token)).send({ status: 'INACTIVE' });
      const pkg = await receivedPackage(w);
      const assign = (agencyId: string | null) => api(t).post(`/v1/admin/packages/${pkg.id}/agency`).set(bearer(w.token)).send({ agencyId });

      const ok = await assign(haiti.id);
      expect(ok.status).toBe(200);
      expect(ok.body.destinationAgencyId).toBe(haiti.id);
      expect(errorCode(await assign(dominican.id))).toBe('AGENCY_COUNTRY_MISMATCH');
      expect((await assign(inactive.id)).status).toBe(404);
      expect((await assign(uuidv7())).status).toBe(404);
      expect((await assign(null)).body.destinationAgencyId).toBeNull();
      expect((await api(t).post(`/v1/admin/packages/${pkg.id}/agency`).set(bearer(w.token)).send({ agencyId: 'x' })).status).toBe(400);
      expect((await api(t).post(`/v1/admin/packages/${pkg.id}/agency`).set(bearer(w.customer1.token)).send({ agencyId: null })).status).toBe(403);
    });
  });

  // =============================================================================================
  describe('isolation entre entreprises', () => {
    it('une entreprise ne voit ni les emplacements, ni les agences, ni les inventaires d’une autre', async () => {
      const a = await setup();
      const b = await setup();
      const loc = (await createLocation(a.token, a.w1.id, { code: 'ISO1' })).body;
      const agency = await makeAgency(t, a.token);
      const pkg = await receivedPackage(a);

      expect((await api(t).get(`/v1/admin/warehouses/${a.w1.id}/locations`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).patch(`/v1/admin/locations/${loc.id}`).set(bearer(b.token)).send({ kind: 'BIN' })).status).toBe(404);
      expect((await api(t).get(`/v1/admin/warehouses/${a.w1.id}/inventory`).set(bearer(b.token))).status).toBe(404);
      expect((await move(b.token, pkg.id, { locationId: null })).status).toBe(404);
      expect((await api(t).patch(`/v1/admin/agencies/${agency.id}`).set(bearer(b.token)).send({ name: 'x' })).status).toBe(404);
      expect((await api(t).get(`/v1/admin/agencies/${agency.id}/packages`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).get('/v1/admin/agencies').set(bearer(b.token))).body.items).toHaveLength(0);
      expect((await scan(b.token, { warehouseId: a.w1.id, code: pkg.trackingNumber })).status).toBe(404);
    });
  });
});
