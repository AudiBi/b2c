import { v7 as uuidv7 } from 'uuid';
import {
  api,
  bearer,
  buildTestApp,
  login,
  makeAgency,
  makeCustomer,
  makeTenant,
  makeUser,
  makeWarehouse,
  readyPackage,
  type CustomerSession,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Lots de transport, manifestes et réception en agence', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const tenant = await makeTenant(t);
    const w1 = await makeWarehouse(t, tenant.token, { city: 'Miami' });
    const w2 = await makeWarehouse(t, tenant.token, { city: 'Orlando' });
    const agency = await makeAgency(t, tenant.token, { name: 'Agence Delmas', city: 'Delmas' });
    const staff = async (roleCode: 'RECEPTION_AGENT' | 'WAREHOUSE_MANAGER' | 'LOGISTICS_MANAGER' | 'AGENCY_MANAGER' | 'BILLING_AGENT', scope?: { type: 'WAREHOUSE' | 'AGENCY'; id: string }) => {
      const user = await makeUser(t, { company: tenant.company, roleCode, scope });
      return (await login(t, user)).accessToken;
    };
    const customer1 = await makeCustomer(t, tenant.company);
    const customer2 = await makeCustomer(t, tenant.company);
    return { ...tenant, w1, w2, agency, staff, customer1, customer2 };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const createShipment = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/shipments').set(bearer(token)).send(body);
  const shipmentBody = (w: World, overrides: Record<string, unknown> = {}) => ({ transportMode: 'AIR', originWarehouseId: w.w1.id, destinationCountry: 'HT', ...overrides });
  async function openShipment(w: World, overrides: Record<string, unknown> = {}) {
    const res = await createShipment(w.token, shipmentBody(w, overrides));
    expect(res.status).toBe(201);
    return res.body as { id: string; reference: string; status: string };
  }
  const load = (token: string, shipmentId: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/shipments/${shipmentId}/packages`).set(bearer(token)).send(body);
  const act = (token: string, shipmentId: string, action: string, body: Record<string, unknown> = {}) => api(t).post(`/v1/admin/shipments/${shipmentId}/${action}`).set(bearer(token)).send(body);
  const detail = (token: string, shipmentId: string) => api(t).get(`/v1/admin/shipments/${shipmentId}`).set(bearer(token));
  const trackingOf = (number: string) => api(t).get(`/v1/public/tracking/${number}`);
  const pkgStatus = async (id: string) => (await t.admin.package.findUniqueOrThrow({ where: { id } })).status;

  /** Lot avec n colis prêts et chargés. */
  async function loadedShipment(w: World, count = 2, customer: CustomerSession = w.customer1, overrides: Record<string, unknown> = {}) {
    const shipment = await openShipment(w, overrides);
    const packages = [];
    for (let i = 0; i < count; i += 1) {
      const p = await readyPackage(t, w, customer, w.w1.id);
      expect((await load(w.token, shipment.id, { packageId: p.packageId })).status).toBe(200);
      packages.push(p);
    }
    return { shipment, packages };
  }

  // =============================================================================================
  describe('création et lecture', () => {
    it('crée un lot ouvert avec une référence <entrepôt>-<mode>-<date>-<n>, numérotée sans doublon', async () => {
      const w = await setup();
      const first = await openShipment(w, { carrierName: 'Transporteur Test', transportRef: 'LTA-123', notes: 'Premier' });
      const second = await openShipment(w, { transportMode: 'SEA' });
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      expect(first.reference).toBe(`${w.w1.reference}-AIR-${today}-1`);
      expect(second.reference).toBe(`${w.w1.reference}-SEA-${today}-2`);
      expect(first).toMatchObject({ status: 'OPEN', carrierName: 'Transporteur Test', transportRef: 'LTA-123', departedAt: null, arrivedAt: null, packageCount: 0 });
    });

    it('5 créations simultanées : 5 références distinctes et consécutives', async () => {
      const w = await setup();
      const results = await Promise.all(Array.from({ length: 5 }, () => createShipment(w.token, shipmentBody(w))));
      expect(results.every((r) => r.status === 201)).toBe(true);
      const numbers = results.map((r) => Number(r.body.reference.split('-').pop())).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5]);
    });

    it('valide les données : mode, pays, entrepôt, agence, champs inconnus, dates prévues refusées', async () => {
      const w = await setup();
      for (const bad of [{ transportMode: 'ROAD' }, { destinationCountry: 'HTI' }, { originWarehouseId: 'x' }, { eta: '2030-01-01' }, { plannedArrival: '2030-01-01' }, { carrierName: 'x'.repeat(121) }]) {
        expect((await createShipment(w.token, shipmentBody(w, bad))).status).toBe(400);
      }
      expect((await createShipment(w.token, shipmentBody(w, { originWarehouseId: uuidv7() }))).status).toBe(404);
      expect((await createShipment(w.token, shipmentBody(w, { destinationAgencyId: uuidv7() }))).status).toBe(404);
      const mismatch = await createShipment(w.token, shipmentBody(w, { destinationCountry: 'DO', destinationAgencyId: w.agency.id }));
      expect(errorCode(mismatch)).toBe('AGENCY_COUNTRY_MISMATCH');
    });

    it('modifie un lot ouvert sans toucher aux autres champs, refuse une modification vide', async () => {
      const w = await setup();
      const s = await openShipment(w, { carrierName: 'A', transportRef: 'REF1' });
      const patched = await api(t).patch(`/v1/admin/shipments/${s.id}`).set(bearer(w.token)).send({ notes: 'Note', destinationAgencyId: w.agency.id });
      expect(patched.body).toMatchObject({ carrierName: 'A', transportRef: 'REF1', notes: 'Note' });
      expect(patched.body.destination.agency.id).toBe(w.agency.id);
      const cleared = await api(t).patch(`/v1/admin/shipments/${s.id}`).set(bearer(w.token)).send({ carrierName: null });
      expect(cleared.body.carrierName).toBeNull();
      expect(cleared.body.transportRef).toBe('REF1');
      expect((await api(t).patch(`/v1/admin/shipments/${s.id}`).set(bearer(w.token)).send({})).status).toBe(400);
    });

    it('liste filtrable et paginée ; détail avec totaux et historique', async () => {
      const w = await setup();
      const { shipment } = await loadedShipment(w, 2);
      await openShipment(w);
      await openShipment(w, { transportMode: 'SEA' });
      const all = await api(t).get('/v1/admin/shipments').set(bearer(w.token));
      expect(all.body.items).toHaveLength(3);
      expect(all.body.items.find((s: any) => s.id === shipment.id).packageCount).toBe(2);
      expect((await api(t).get('/v1/admin/shipments?status=DISPATCHED').set(bearer(w.token))).body.items).toHaveLength(0);
      expect((await api(t).get(`/v1/admin/shipments?q=${shipment.reference.toLowerCase()}`).set(bearer(w.token))).body.items.map((s: any) => s.id)).toEqual([shipment.id]);
      const page = await api(t).get('/v1/admin/shipments?limit=2').set(bearer(w.token));
      expect(page.body.items).toHaveLength(2);
      expect((await api(t).get(`/v1/admin/shipments?limit=2&cursor=${page.body.nextCursor}`).set(bearer(w.token))).body.items).toHaveLength(1);
      expect((await api(t).get('/v1/admin/shipments?status=NOPE').set(bearer(w.token))).status).toBe(400);

      const full = await detail(w.token, shipment.id);
      expect(full.body.packages).toHaveLength(2);
      expect(full.body.totals).toMatchObject({ count: 2, actualWeightKg: '4', declared: { USD: '200.00' } });
      expect(full.body.events.map((e: any) => e.type)).toEqual(['CREATED', 'PACKAGE_LOADED', 'PACKAGE_LOADED']);
      expect((await detail(w.token, uuidv7())).status).toBe(404);
    });
  });

  // =============================================================================================
  describe('droits', () => {
    it('par rôle : le responsable d’entrepôt prépare le lot de son entrepôt mais ne le fait pas partir ; le responsable logistique le peut', async () => {
      const w = await setup();
      const manager = await w.staff('WAREHOUSE_MANAGER', { type: 'WAREHOUSE', id: w.w1.id });
      const logistics = await w.staff('LOGISTICS_MANAGER');
      expect((await createShipment(manager, shipmentBody(w))).status).toBe(201);
      expect((await createShipment(manager, shipmentBody(w, { originWarehouseId: w.w2.id }))).status).toBe(403);

      const { shipment } = await loadedShipment(w, 1);
      expect((await detail(manager, shipment.id)).status).toBe(200);
      const denied = await act(manager, shipment.id, 'dispatch');
      expect(denied.status).toBe(403);
      expect((await act(logistics, shipment.id, 'dispatch')).status).toBe(200);
    });

    it('un lot d’un autre entrepôt est invisible pour un responsable limité ; facturation, agence et client n’y ont pas accès', async () => {
      const w = await setup();
      const s2 = (await createShipment(w.token, shipmentBody(w, { originWarehouseId: w.w2.id }))).body;
      const manager1 = await w.staff('WAREHOUSE_MANAGER', { type: 'WAREHOUSE', id: w.w1.id });
      expect((await detail(manager1, s2.id)).status).toBe(404);
      expect((await api(t).get('/v1/admin/shipments').set(bearer(manager1))).body.items).toHaveLength(0);
      expect((await load(manager1, s2.id, { code: 'ABCD-1234' })).status).toBe(403);

      for (const token of [await w.staff('BILLING_AGENT'), await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id }), w.customer1.token]) {
        expect((await api(t).get('/v1/admin/shipments').set(bearer(token))).status).toBe(403);
        expect((await createShipment(token, shipmentBody(w))).status).toBe(403);
      }
      expect((await api(t).get('/v1/admin/shipments')).status).toBe(401);
    });

    it('une entreprise ne voit ni ne modifie les lots d’une autre', async () => {
      const a = await setup();
      const b = await setup();
      const s = await openShipment(a);
      expect((await detail(b.token, s.id)).status).toBe(404);
      expect((await act(b.token, s.id, 'cancel')).status).toBe(404);
      expect((await load(b.token, s.id, { code: 'ABCD-1234' })).status).toBe(404);
      expect((await api(t).get(`/v1/admin/shipments/${s.id}/manifest.csv`).set(bearer(b.token))).status).toBe(404);
      expect((await createShipment(b.token, shipmentBody(a))).status).toBe(404); // entrepôt d'une autre entreprise
    });
  });

  // =============================================================================================
  describe('chargement', () => {
    it('charge par identifiant, par numéro de suivi ou par numéro du marchand ; recharger est sans effet', async () => {
      const w = await setup();
      const s = await openShipment(w);
      const a = await readyPackage(t, w, w.customer1, w.w1.id);
      const b = await readyPackage(t, w, w.customer1, w.w1.id);
      const c = await readyPackage(t, w, w.customer2, w.w1.id);
      expect((await load(w.token, s.id, { packageId: a.packageId })).body.outcome).toBe('LOADED');
      expect((await load(w.token, s.id, { code: b.trackingNumber })).body.outcome).toBe('LOADED');
      expect((await load(w.token, s.id, { code: c.supplier.toLowerCase() })).body.outcome).toBe('LOADED');
      expect((await load(w.token, s.id, { packageId: a.packageId })).body.outcome).toBe('ALREADY_LOADED');
      expect((await detail(w.token, s.id)).body.packageCount).toBe(3);
      expect(await t.admin.shipmentPackage.count({ where: { shipmentId: s.id } })).toBe(3);
    });

    it('refuse un colis non prêt, d’un autre mode, d’un autre entrepôt, d’une autre destination, inconnu', async () => {
      const w = await setup();
      const s = await openShipment(w);

      // reçu et pesé seulement : pas encore autorisé à partir (I12)
      const prealert = await (await import('./helpers')).makePrealert(t, w.customer1, w.w1.id);
      await api(t).post('/v1/admin/packages/receive').set(bearer(w.token)).send({ warehouseId: w.w1.id, expectedPackageId: prealert.package.id });
      await api(t).post(`/v1/admin/packages/${prealert.package.id}/register`).set(bearer(w.token)).send({ weight: { value: 1, unit: 'KG' }, dimensions: { length: 10, width: 10, height: 10, unit: 'CM' } });
      const notReady = await load(w.token, s.id, { packageId: prealert.package.id });
      expect(notReady.status).toBe(409);
      expect(errorCode(notReady)).toBe('PACKAGE_NOT_READY');
      expect(notReady.body.error.details.status).toBe('REGISTERED_WEIGHED');

      const sea = await readyPackage(t, w, w.customer1, w.w1.id, { transportMode: 'SEA' });
      expect(errorCode(await load(w.token, s.id, { packageId: sea.packageId }))).toBe('MODE_MISMATCH');
      const orlando = await readyPackage(t, w, w.customer1, w.w2.id);
      expect(errorCode(await load(w.token, s.id, { packageId: orlando.packageId }))).toBe('WAREHOUSE_MISMATCH');
      const elsewhere = await readyPackage(t, w, w.customer1, w.w1.id);
      await t.admin.package.update({ where: { id: elsewhere.packageId }, data: { destinationCountry: 'DO' } });
      expect(errorCode(await load(w.token, s.id, { packageId: elsewhere.packageId }))).toBe('DESTINATION_MISMATCH');

      expect((await load(w.token, s.id, { code: 'INCONNU-9999' })).status).toBe(404);
      expect((await load(w.token, s.id, { packageId: uuidv7() })).status).toBe(404);
      expect((await load(w.token, s.id, {})).status).toBe(400);
      expect((await load(w.token, s.id, { code: 'ABCD-1234', packageId: uuidv7() })).status).toBe(400);
    });

    it('un colis n’est que dans un lot à la fois ; 2 chargements simultanés dans 2 lots : un seul gagne', async () => {
      const w = await setup();
      const s1 = await openShipment(w);
      const s2 = await openShipment(w);
      const p = await readyPackage(t, w, w.customer1, w.w1.id);
      await load(w.token, s1.id, { packageId: p.packageId });
      const refused = await load(w.token, s2.id, { packageId: p.packageId });
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('ALREADY_IN_SHIPMENT');
      expect(refused.body.error.details.shipment).toBe(s1.reference);

      const q = await readyPackage(t, w, w.customer1, w.w1.id);
      const results = await Promise.all([load(w.token, s1.id, { packageId: q.packageId }), load(w.token, s2.id, { packageId: q.packageId }), load(w.token, s1.id, { code: q.trackingNumber }), load(w.token, s2.id, { code: q.trackingNumber })]);
      const loaded = results.filter((r) => r.body.outcome === 'LOADED');
      expect(loaded).toHaveLength(1);
      expect(results.filter((r) => r.status === 409 || r.body.outcome === 'ALREADY_LOADED')).toHaveLength(3);
      expect(await t.admin.shipmentPackage.count({ where: { packageId: q.packageId, removedAt: null } })).toBe(1);
    });

    it('retire un colis, qui redevient libre pour un autre lot ; le chargement hérite de l’agence du lot', async () => {
      const w = await setup();
      const s1 = await openShipment(w, { destinationAgencyId: w.agency.id });
      const s2 = await openShipment(w);
      const p = await readyPackage(t, w, w.customer1, w.w1.id);
      const loaded = await load(w.token, s1.id, { packageId: p.packageId });
      expect(loaded.body.package.destinationAgencyId).toBeNull(); // lu avant l'héritage
      expect((await t.admin.package.findUniqueOrThrow({ where: { id: p.packageId } })).destinationAgencyId).toBe(w.agency.id);

      expect((await api(t).delete(`/v1/admin/shipments/${s1.id}/packages/${p.packageId}`).set(bearer(w.token))).status).toBe(204);
      expect((await api(t).delete(`/v1/admin/shipments/${s1.id}/packages/${p.packageId}`).set(bearer(w.token))).status).toBe(404);
      expect((await load(w.token, s2.id, { packageId: p.packageId })).body.outcome).toBe('LOADED');
      // l'historique de l'ancien chargement est conservé
      expect(await t.admin.shipmentPackage.count({ where: { packageId: p.packageId } })).toBe(2);
    });

    it('la base refuse tout chargement sur un lot qui n’est plus ouvert, et un double chargement actif', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 1);
      const other = await readyPackage(t, w, w.customer1, w.w1.id);
      await act(w.token, shipment.id, 'dispatch');
      await expect(t.admin.shipmentPackage.create({ data: { companyId: w.company.id, shipmentId: shipment.id, packageId: other.packageId } })).rejects.toThrow(/plus ouvert/);

      const open = await openShipment(w);
      await expect(t.admin.shipmentPackage.create({ data: { companyId: w.company.id, shipmentId: open.id, packageId: packages[0].packageId } })).rejects.toThrow();
    });
  });

  // =============================================================================================
  describe('départ, arrivée, douane, clôture, annulation', () => {
    it('le départ fait passer tous les colis « en transit », fixe la date réelle et vide les emplacements', async () => {
      const w = await setup();
      const loc = (await api(t).post(`/v1/admin/warehouses/${w.w1.id}/locations`).set(bearer(w.token)).send({ code: 'D1' })).body;
      const { shipment, packages } = await loadedShipment(w, 2);
      await api(t).post(`/v1/admin/packages/${packages[0].packageId}/move`).set(bearer(w.token)).send({ locationId: loc.id });

      const before = Date.now();
      const res = await act(w.token, shipment.id, 'dispatch', { note: 'Vol AA123' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ advanced: 2, skipped: [] });
      expect(res.body.shipment.status).toBe('DISPATCHED');
      expect(new Date(res.body.shipment.departedAt).getTime()).toBeGreaterThanOrEqual(before - 2000);
      expect(res.body.shipment.arrivedAt).toBeNull();

      for (const p of packages) expect(await pkgStatus(p.packageId)).toBe('IN_TRANSIT');
      const moved = await t.admin.package.findUniqueOrThrow({ where: { id: packages[0].packageId } });
      expect(moved.locationId).toBeNull();
      const movements = await t.admin.warehouseMovement.findMany({ where: { packageId: packages[0].packageId }, orderBy: { occurredAt: 'asc' } });
      expect(movements.map((m) => m.kind)).toEqual(['IN', 'OUT']);

      // le suivi public montre l'étape, depuis la ville d'origine, sans rien d'inventé
      const pub = await trackingOf(packages[0].trackingNumber);
      expect(pub.body.status).toBe('IN_TRANSIT');
      expect(pub.body.events[pub.body.events.length - 1]).toMatchObject({ status: 'IN_TRANSIT', location: 'Miami' });
      expect(pub.body.estimatedDelivery).toBeNull();
      expect(JSON.stringify(pub.body)).not.toContain(shipment.reference);
      const events = (await detail(w.token, shipment.id)).body.events;
      expect(events[events.length - 1]).toMatchObject({ type: 'STATUS_CHANGE', from: 'OPEN', to: 'DISPATCHED', note: 'Vol AA123' });
    });

    it('un lot vide ne part pas ; un colis devenu non prêt bloque le départ et est nommé', async () => {
      const w = await setup();
      const empty = await openShipment(w);
      const refusedEmpty = await act(w.token, empty.id, 'dispatch');
      expect(refusedEmpty.status).toBe(409);
      expect(errorCode(refusedEmpty)).toBe('SHIPMENT_EMPTY');

      const { shipment, packages } = await loadedShipment(w, 2);
      await api(t).post(`/v1/admin/packages/${packages[1].packageId}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Contenu à vérifier', holdReasonCode: 'SUSPICIOUS_CONTENT' });
      const refused = await act(w.token, shipment.id, 'dispatch');
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('PACKAGES_NOT_READY');
      expect(refused.body.error.details.packages).toEqual([{ trackingNumber: packages[1].trackingNumber, status: 'ON_HOLD' }]);
      // rien n'a bougé
      expect(await pkgStatus(packages[0].packageId)).toBe('READY_TO_SHIP');
      expect((await detail(w.token, shipment.id)).body.status).toBe('OPEN');
      // une fois le colis retiré, le lot peut partir
      await api(t).delete(`/v1/admin/shipments/${shipment.id}/packages/${packages[1].packageId}`).set(bearer(w.token));
      expect((await act(w.token, shipment.id, 'dispatch')).status).toBe(200);
    });

    it('4 départs simultanés du même lot : un seul réussit, chaque colis n’a qu’un événement de départ', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 2);
      const results = await Promise.all(Array.from({ length: 4 }, () => act(w.token, shipment.id, 'dispatch')));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      for (const p of packages) expect(await t.admin.packageEvent.count({ where: { packageId: p.packageId, toStatus: 'IN_TRANSIT' } })).toBe(1);
    });

    it('un lot parti ne se modifie plus : ni chargement, ni retrait, ni changement, ni annulation', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 1);
      await act(w.token, shipment.id, 'dispatch');
      const extra = await readyPackage(t, w, w.customer1, w.w1.id);
      expect(errorCode(await load(w.token, shipment.id, { packageId: extra.packageId }))).toBe('SHIPMENT_NOT_OPEN');
      expect((await api(t).delete(`/v1/admin/shipments/${shipment.id}/packages/${packages[0].packageId}`).set(bearer(w.token))).status).toBe(409);
      expect(errorCode(await api(t).patch(`/v1/admin/shipments/${shipment.id}`).set(bearer(w.token)).send({ notes: 'x' }))).toBe('SHIPMENT_NOT_OPEN');
      expect(errorCode(await act(w.token, shipment.id, 'cancel'))).toBe('INVALID_SHIPMENT_TRANSITION');
      expect(errorCode(await act(w.token, shipment.id, 'dispatch'))).toBe('INVALID_SHIPMENT_TRANSITION');
    });

    it('l’arrivée fait passer les colis « arrivés » ; un colis retenu en route est signalé et laissé tel quel', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 3, w.customer1, { destinationCity: 'Port-au-Prince' });
      await act(w.token, shipment.id, 'dispatch');
      await api(t).post(`/v1/admin/packages/${packages[2].packageId}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Colis abîmé', holdReasonCode: 'DAMAGED' });

      expect(errorCode(await act(w.token, shipment.id, 'customs'))).toBe('INVALID_SHIPMENT_TRANSITION'); // pas avant l'arrivée
      const arrived = await act(w.token, shipment.id, 'arrive');
      expect(arrived.status).toBe(200);
      expect(arrived.body.advanced).toBe(2);
      expect(arrived.body.skipped).toEqual([{ trackingNumber: packages[2].trackingNumber, status: 'ON_HOLD' }]);
      expect(arrived.body.shipment.arrivedAt).toBeTruthy();
      expect(await pkgStatus(packages[0].packageId)).toBe('ARRIVED_DESTINATION');
      expect(await pkgStatus(packages[2].packageId)).toBe('ON_HOLD');
      const pub = await trackingOf(packages[0].trackingNumber);
      expect(pub.body.events[pub.body.events.length - 1]).toMatchObject({ status: 'ARRIVED_DESTINATION', location: 'Port-au-Prince' });
    });

    it('douane : les colis arrivés passent « en traitement douanier », puis sont reçus en agence', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 1, w.customer1, { destinationAgencyId: w.agency.id });
      await act(w.token, shipment.id, 'dispatch');
      await act(w.token, shipment.id, 'arrive');
      const customs = await act(w.token, shipment.id, 'customs');
      expect(customs.body).toMatchObject({ advanced: 1 });
      expect(await pkgStatus(packages[0].packageId)).toBe('IN_CUSTOMS');
      const agent = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const received = await api(t).post(`/v1/admin/agencies/${w.agency.id}/receive`).set(bearer(agent)).send({ code: packages[0].trackingNumber });
      expect(received.body.outcome).toBe('RECEIVED');
      expect(await pkgStatus(packages[0].packageId)).toBe('RECEIVED_AT_AGENCY');
    });

    it('la clôture est refusée tant que des colis n’ont pas été reçus en agence', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 2, w.customer1, { destinationAgencyId: w.agency.id });
      await act(w.token, shipment.id, 'dispatch');
      await act(w.token, shipment.id, 'arrive');
      const refused = await act(w.token, shipment.id, 'close');
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('PACKAGES_PENDING_RECEIPT');
      expect(refused.body.error.details.count).toBe(2);

      const agent = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      for (const p of packages) await api(t).post(`/v1/admin/agencies/${w.agency.id}/receive`).set(bearer(agent)).send({ code: p.trackingNumber });
      const closed = await act(w.token, shipment.id, 'close');
      expect(closed.status).toBe(200);
      expect(closed.body.shipment.status).toBe('CLOSED');
      expect(errorCode(await act(w.token, shipment.id, 'close'))).toBe('INVALID_SHIPMENT_TRANSITION');
    });

    it('annuler un lot ouvert libère ses colis, qui peuvent partir dans un autre lot', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 2);
      expect((await act(w.token, shipment.id, 'cancel', { note: 'Vol annulé' })).body.shipment.status).toBe('CANCELLED');
      for (const p of packages) expect(await pkgStatus(p.packageId)).toBe('READY_TO_SHIP');
      expect(await t.admin.shipmentPackage.count({ where: { shipmentId: shipment.id, removedAt: null } })).toBe(0);
      const next = await openShipment(w);
      expect((await load(w.token, next.id, { packageId: packages[0].packageId })).body.outcome).toBe('LOADED');
      // un lot annulé ne rouvre pas
      expect(errorCode(await act(w.token, shipment.id, 'dispatch'))).toBe('INVALID_SHIPMENT_TRANSITION');
    });

    it('un statut de colis ne peut plus être forcé vers un événement de lot par l’API générique', async () => {
      const w = await setup();
      const { packages } = await loadedShipment(w, 1);
      const forced = await api(t).post(`/v1/admin/packages/${packages[0].packageId}/transitions`).set(bearer(w.token)).send({ to: 'IN_TRANSIT' });
      expect(forced.status).toBe(409);
      expect(errorCode(forced)).toBe('TRANSITION_NOT_AVAILABLE');
    });

    it('la base impose des dates réelles cohérentes et un historique de lot en ajout seul', async () => {
      const w = await setup();
      const s = await openShipment(w);
      await expect(t.admin.shipment.update({ where: { id: s.id }, data: { departedAt: new Date() } })).rejects.toThrow();
      await expect(t.admin.shipment.update({ where: { id: s.id }, data: { status: 'ARRIVED' } })).rejects.toThrow();
      const event = await t.admin.shipmentEvent.findFirstOrThrow({ where: { shipmentId: s.id } });
      await expect(t.admin.shipmentEvent.update({ where: { id: event.id }, data: { note: 'réécrit' } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.shipmentEvent.delete({ where: { id: event.id } })).rejects.toThrow(/ajout seul/);
    });
  });

  // =============================================================================================
  describe('réception en agence', () => {
    async function arrivedShipment(w: World, overrides: Record<string, unknown> = {}) {
      const loaded = await loadedShipment(w, 2, w.customer1, { destinationAgencyId: w.agency.id, ...overrides });
      await act(w.token, loaded.shipment.id, 'dispatch');
      return loaded;
    }
    const receive = (token: string, agencyId: string, code: string) => api(t).post(`/v1/admin/agencies/${agencyId}/receive`).set(bearer(token)).send({ code });

    it('refuse un colis dont le lot n’est pas arrivé, puis le reçoit ; relire est sans effet', async () => {
      const w = await setup();
      const agent = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const { shipment, packages } = await arrivedShipment(w);
      const early = await receive(agent, w.agency.id, packages[0].trackingNumber);
      expect(early.status).toBe(409);
      expect(errorCode(early)).toBe('NOT_ARRIVED');

      await act(w.token, shipment.id, 'arrive');
      const ok = await receive(agent, w.agency.id, packages[0].trackingNumber.toLowerCase());
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ outcome: 'RECEIVED' });
      expect(ok.body.package.status).toBe('RECEIVED_AT_AGENCY');
      expect(ok.body.package.destinationAgencyId).toBe(w.agency.id);
      expect((await receive(agent, w.agency.id, packages[0].supplier)).body.outcome).toBe('ALREADY_RECEIVED');
      expect(await t.admin.packageEvent.count({ where: { packageId: packages[0].packageId, toStatus: 'RECEIVED_AT_AGENCY' } })).toBe(1);
      expect((await receive(agent, w.agency.id, 'INCONNU-0000')).status).toBe(404);
      expect((await receive(agent, w.agency.id, 'a')).status).toBe(400);
    });

    it('refuse un colis destiné à une autre agence et un responsable d’une autre agence', async () => {
      const w = await setup();
      const second = await makeAgency(t, w.token, { name: 'Agence Pétion-Ville', city: 'Pétion-Ville' });
      const agentOne = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const agentTwo = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: second.id });
      const { shipment, packages } = await arrivedShipment(w);
      await act(w.token, shipment.id, 'arrive');

      const wrong = await receive(agentTwo, second.id, packages[0].trackingNumber);
      expect(wrong.status).toBe(409);
      expect(errorCode(wrong)).toBe('WRONG_AGENCY');
      expect(wrong.body.error.details.expected).toBe('Agence Delmas');
      expect((await receive(agentTwo, w.agency.id, packages[0].trackingNumber)).status).toBe(403);
      expect((await receive(w.customer1.token, w.agency.id, packages[0].trackingNumber)).status).toBe(403);
      expect((await api(t).post(`/v1/admin/agencies/${w.agency.id}/receive`).send({ code: 'ABCD-1234' })).status).toBe(401);
      expect(await pkgStatus(packages[0].packageId)).toBe('ARRIVED_DESTINATION');
      expect((await receive(agentOne, w.agency.id, packages[0].trackingNumber)).status).toBe(200);
    });

    it('deux lectures simultanées du même colis : une réception, un seul événement', async () => {
      const w = await setup();
      const agent = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const { shipment, packages } = await arrivedShipment(w);
      await act(w.token, shipment.id, 'arrive');
      const results = await Promise.all(Array.from({ length: 5 }, () => receive(agent, w.agency.id, packages[0].trackingNumber)));
      expect(results.filter((r) => r.body.outcome === 'RECEIVED')).toHaveLength(1);
      expect(results.filter((r) => r.body.outcome === 'ALREADY_RECEIVED')).toHaveLength(4);
      expect(await t.admin.packageEvent.count({ where: { packageId: packages[0].packageId, toStatus: 'RECEIVED_AT_AGENCY' } })).toBe(1);
    });

    it('« prêt pour retrait » : le client voit son point de retrait, le suivi public aussi si l’agence est publique', async () => {
      const w = await setup();
      const hidden = await makeAgency(t, w.token, { name: 'Agence discrète', publicVisible: false });
      const agent = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const { shipment, packages } = await arrivedShipment(w);
      await act(w.token, shipment.id, 'arrive');

      // avant la réception : aucun point de retrait affiché
      expect((await trackingOf(packages[0].trackingNumber)).body.pickup).toBeNull();
      expect((await api(t).get(`/v1/me/packages/${packages[0].packageId}`).set(bearer(w.customer1.token))).body.pickup).toBeNull();

      await receive(agent, w.agency.id, packages[0].trackingNumber);
      const received = await trackingOf(packages[0].trackingNumber);
      expect(received.body.status).toBe('RECEIVED_AT_AGENCY');
      expect(received.body.pickup).toMatchObject({ name: 'Agence Delmas', city: 'Delmas', ready: false });

      const ready = await api(t).post(`/v1/admin/agencies/${w.agency.id}/packages/${packages[0].packageId}/ready-for-pickup`).set(bearer(agent));
      expect(ready.status).toBe(200);
      expect(ready.body.status).toBe('READY_FOR_PICKUP');
      const mine = await api(t).get(`/v1/me/packages/${packages[0].packageId}`).set(bearer(w.customer1.token));
      expect(mine.body.status).toBe('READY_FOR_PICKUP');
      expect(mine.body.pickup).toMatchObject({ name: 'Agence Delmas', ready: true, hours: 'Lun-Ven 8h-17h' });
      const pub = await trackingOf(packages[0].trackingNumber);
      expect(pub.body.pickup).toMatchObject({ name: 'Agence Delmas', ready: true });
      const last = pub.body.events[pub.body.events.length - 1];
      expect(last).toMatchObject({ status: 'READY_FOR_PICKUP', location: 'Delmas' });
      expect(JSON.stringify(pub.body)).not.toContain(w.customer1.customerCode);

      // une agence non publique reste visible du client, jamais du public
      await t.admin.package.update({ where: { id: packages[0].packageId }, data: { destinationAgencyId: hidden.id } });
      expect((await trackingOf(packages[0].trackingNumber)).body.pickup).toBeNull();
      expect((await api(t).get(`/v1/me/packages/${packages[0].packageId}`).set(bearer(w.customer1.token))).body.pickup.name).toBe('Agence discrète');
      // et un autre client ne voit rien
      expect((await api(t).get(`/v1/me/packages/${packages[0].packageId}`).set(bearer(w.customer2.token))).status).toBe(404);
    });

    it('« prêt pour retrait » : seulement après réception, seulement dans la bonne agence', async () => {
      const w = await setup();
      const other = await makeAgency(t, w.token);
      const agent = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const { shipment, packages } = await arrivedShipment(w);
      const ready = (agencyId: string, id: string, token = agent) => api(t).post(`/v1/admin/agencies/${agencyId}/packages/${id}/ready-for-pickup`).set(bearer(token));
      expect((await ready(w.agency.id, packages[0].packageId)).status).toBe(409); // encore en transit
      await act(w.token, shipment.id, 'arrive');
      expect((await ready(w.agency.id, packages[0].packageId)).status).toBe(409); // pas encore reçu
      await receive(agent, w.agency.id, packages[0].trackingNumber);
      expect((await ready(other.id, packages[0].packageId)).status).toBe(403);
      expect((await ready(w.agency.id, packages[0].packageId, w.customer1.token)).status).toBe(403);
      expect((await ready(w.agency.id, uuidv7())).status).toBe(404);
      expect((await ready(w.agency.id, packages[0].packageId)).status).toBe(200);
    });

    it('inventaire de l’agence : colis présents et colis attendus', async () => {
      const w = await setup();
      const agent = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const { shipment, packages } = await arrivedShipment(w);
      const inTransit = await api(t).get(`/v1/admin/agencies/${w.agency.id}/packages`).set(bearer(agent));
      expect(inTransit.body).toMatchObject({ expected: 2 });
      expect(inTransit.body.items).toHaveLength(0);
      await act(w.token, shipment.id, 'arrive');
      await receive(agent, w.agency.id, packages[0].trackingNumber);
      const after = await api(t).get(`/v1/admin/agencies/${w.agency.id}/packages`).set(bearer(agent));
      expect(after.body.expected).toBe(1);
      expect(after.body.items.map((p: any) => p.id)).toEqual([packages[0].packageId]);
    });
  });

  // =============================================================================================
  describe('manifeste', () => {
    it('CSV : métadonnées, lignes, totaux, accents (BOM) ; en-têtes de téléchargement', async () => {
      const w = await setup();
      const { shipment, packages } = await loadedShipment(w, 2, w.customer1, { carrierName: 'Cargo, Express', transportRef: 'LTA-001' });
      const res = await api(t).get(`/v1/admin/shipments/${shipment.id}/manifest.csv`).set(bearer(w.token)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="manifeste-[A-Za-z0-9._-]+\.csv"$/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      const text = Buffer.from(res.body).toString('utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain(`Lot,${shipment.reference}`);
      expect(text).toContain('"Cargo, Express"'); // virgule protégée par des guillemets
      expect(text).toContain('LTA-001');
      for (const p of packages) expect(text).toContain(p.trackingNumber.slice(0, 2)); // numéros affichés avec tirets
      expect(text).toMatch(/Nombre de colis,2/);
      expect(text).toContain('Valeur déclarée totale,200.00,USD');
      expect(text).toContain(w.customer1.customerCode);
      // aucune date prévue : départ et arrivée réels vides tant que le lot n'est pas parti
      expect(text).toMatch(/Départ réel,\r?\n/);
    });

    it('CSV : les textes saisis par des tiers ne peuvent pas devenir des formules de tableur', async () => {
      const w = await setup();
      const evil = await makeCustomer(t, w.company);
      await t.admin.user.update({ where: { id: evil.user.id }, data: { firstName: '=HYPERLINK("http://pirate.example","x")', lastName: '+cmd|calc' } });
      const shipment = await openShipment(w);
      const prealert = await (await import('./helpers')).makePrealert(t, evil, w.w1.id);
      await api(t).post('/v1/admin/packages/receive').set(bearer(w.token)).send({ warehouseId: w.w1.id, expectedPackageId: prealert.package.id });
      await api(t).post(`/v1/admin/packages/${prealert.package.id}/register`).set(bearer(w.token)).send({ weight: { value: 1, unit: 'KG' }, dimensions: { length: 10, width: 10, height: 10, unit: 'CM' }, contentDescription: '@SUM(1+1)*cmd' });
      await api(t).post(`/v1/admin/packages/${prealert.package.id}/transitions`).set(bearer(w.token)).send({ to: 'READY_TO_SHIP', reason: 'Prépayé' });
      await load(w.token, shipment.id, { packageId: prealert.package.id });

      const res = await api(t).get(`/v1/admin/shipments/${shipment.id}/manifest.csv`).set(bearer(w.token));
      const rows = res.text.split(/\r?\n/);
      const row = rows.find((r) => r.includes(evil.customerCode)) as string;
      expect(row).toBeDefined();
      expect(row).toContain(`"'=HYPERLINK(""http://pirate.example"",""x"") +cmd|calc"`.replace(` +cmd`, ' +cmd')); // nom complet précédé d'une apostrophe
      expect(row).toContain("'@SUM(1+1)*cmd");
      // aucune cellule ne commence par un caractère de formule
      for (const cell of row.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g) ?? []) {
        const value = cell.replace(/^,/, '').replace(/^"/, '');
        expect(value).not.toMatch(/^[=+\-@]/);
      }
    });

    it('PDF : document valide, imprimable, en téléchargement', async () => {
      const w = await setup();
      const { shipment } = await loadedShipment(w, 3);
      const res = await api(t).get(`/v1/admin/shipments/${shipment.id}/manifest.pdf`).set(bearer(w.token)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="manifeste-/);
      const body = Buffer.from(res.body);
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.subarray(-8).toString()).toContain('%%EOF');
      expect(body.length).toBeGreaterThan(1500);
    });

    it('un lot vide n’a pas de manifeste ; droits et isolation respectés', async () => {
      const w = await setup();
      const empty = await openShipment(w);
      expect(errorCode(await api(t).get(`/v1/admin/shipments/${empty.id}/manifest.csv`).set(bearer(w.token)))).toBe('SHIPMENT_EMPTY');
      expect(errorCode(await api(t).get(`/v1/admin/shipments/${empty.id}/manifest.pdf`).set(bearer(w.token)))).toBe('SHIPMENT_EMPTY');

      const { shipment } = await loadedShipment(w, 1);
      const agent2 = await w.staff('WAREHOUSE_MANAGER', { type: 'WAREHOUSE', id: w.w2.id });
      expect((await api(t).get(`/v1/admin/shipments/${shipment.id}/manifest.csv`).set(bearer(agent2))).status).toBe(404);
      expect((await api(t).get(`/v1/admin/shipments/${shipment.id}/manifest.pdf`).set(bearer(w.customer1.token))).status).toBe(403);
      expect((await api(t).get(`/v1/admin/shipments/${shipment.id}/manifest.pdf`)).status).toBe(401);
      expect((await api(t).get(`/v1/admin/shipments/${uuidv7()}/manifest.pdf`).set(bearer(w.token))).status).toBe(404);
    });
  });
});
