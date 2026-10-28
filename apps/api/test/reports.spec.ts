import {
  activateRateCard,
  api,
  bearer,
  buildTestApp,
  customerIdOf,
  login,
  makeAgency,
  makeCustomer,
  makeTenant,
  makeUser,
  makeWarehouse,
  readyPackage,
  weighedPackage,
  type TestApp,
} from './helpers';

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('Tableau de bord : indicateurs calculés sur les données réelles', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const tenant = await makeTenant(t);
    const w1 = await makeWarehouse(t, tenant.token, { city: 'Miami' });
    await activateRateCard(t, tenant.token);
    const agency = await makeAgency(t, tenant.token, { name: 'Agence Delmas', city: 'Delmas' });
    const customer = await makeCustomer(t, tenant.company);
    const staff = async (roleCode: 'AGENCY_MANAGER' | 'BILLING_AGENT' | 'AUDITOR' | 'DRIVER', scope?: { type: 'AGENCY'; id: string }) => {
      const user = await makeUser(t, { company: tenant.company, roleCode, scope });
      return { user, token: (await login(t, user)).accessToken };
    };
    const manager = await staff('AGENCY_MANAGER', { type: 'AGENCY', id: agency.id });
    return { ...tenant, w1, agency, customer, staff, manager };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const dashboard = (token: string, query = '') => api(t).get(`/v1/admin/dashboard${query}`).set(bearer(token));

  async function deliveredPackage(w: World) {
    await api(t).put('/v1/admin/settings/delivery').set(bearer(w.token)).send({ requireOtp: false, requireIdDocument: false, requirePhoto: false });
    const pkg = await readyPackage(t, w, w.customer, w.w1.id);
    const shipment = await api(t).post('/v1/admin/shipments').set(bearer(w.token)).send({ transportMode: 'AIR', originWarehouseId: w.w1.id, destinationCountry: 'HT', destinationAgencyId: w.agency.id });
    await api(t).post(`/v1/admin/shipments/${shipment.body.id}/packages`).set(bearer(w.token)).send({ packageId: pkg.packageId });
    for (const step of ['dispatch', 'arrive']) await api(t).post(`/v1/admin/shipments/${shipment.body.id}/${step}`).set(bearer(w.token)).send({});
    await api(t).post(`/v1/admin/agencies/${w.agency.id}/receive`).set(bearer(w.manager.token)).send({ code: pkg.trackingNumber });
    await api(t).post(`/v1/admin/agencies/${w.agency.id}/packages/${pkg.packageId}/ready-for-pickup`).set(bearer(w.manager.token)).send({});
    const done = await api(t).post(`/v1/admin/packages/${pkg.packageId}/handover`).set(bearer(w.manager.token)).send({ recipientKind: 'CUSTOMER' });
    expect(done.status).toBe(200);
    return pkg;
  }

  it('entreprise vide : tout est à zéro et les moyennes sont « sans mesure » (null), jamais inventées', async () => {
    const w = await setup();
    const empty = await makeTenant(t);
    const res = await dashboard(empty.token);
    expect(res.status).toBe(200);
    expect(res.body.customers).toEqual({ total: 0, newInRange: 0 });
    expect(res.body.packages).toMatchObject({ receivedInRange: 0, deliveredInRange: 0, inTransit: 0, awaitingPayment: 0, toDeliver: 0, onHold: 0 });
    expect(res.body.shipments.byMode).toEqual([]);
    expect(res.body.warehouses).toEqual([]);
    expect(res.body.finance).toEqual({ collected: [], refunded: [], invoiced: [], unpaid: [] });
    expect(res.body.delays).toEqual({
      warehouseReceiptToReady: { count: 0, avgHours: null },
      transport: { count: 0, avgHours: null },
      agencyReceiptToDelivered: { count: 0, avgHours: null },
    });
    expect(res.body.agencies).toEqual([]);
    expect(res.body.drivers).toEqual([]);
    expect(res.body.range).toEqual({ from: day(-29), to: day(0) });
    expect(w.company.id).not.toBe(empty.company.id);
  });

  it('compte clients, colis par état, expéditions par mode, entrepôts et agences à partir des vraies données', async () => {
    const w = await setup();
    const waiting = await readyPackage(t, w, w.customer, w.w1.id);
    const delivered = await deliveredPackage(w);
    await readyPackage(t, w, w.customer, w.w1.id, { transportMode: 'SEA' });
    const unpaid = await weighedPackage(t, w, w.customer, w.w1.id);
    expect(waiting.packageId).not.toBe(unpaid.packageId);

    const res = await dashboard(w.token);
    expect(res.body.customers.total).toBe(1);
    expect(res.body.packages.deliveredInRange).toBe(1);
    expect(res.body.packages.receivedInRange).toBe(4);
    expect(res.body.packages.byStatus).toMatchObject({ DELIVERED: 1, READY_TO_SHIP: 2, REGISTERED_WEIGHED: 1 });
    expect(res.body.shipments.byMode).toEqual([{ mode: 'AIR', count: 1 }]);
    expect(res.body.warehouses).toEqual([{ id: w.w1.id, name: expect.any(String), city: 'Miami', atWarehouse: 3, receivedInRange: 4 }]);
    expect(res.body.agencies).toEqual([expect.objectContaining({ id: w.agency.id, inAgency: 0, deliveredInRange: 1 })]);
    expect(res.body.agencies[0].avgHoursToDeliver).not.toBeNull();
    expect(res.body.delays.agencyReceiptToDelivered.count).toBe(1);
    expect(res.body.delays.agencyReceiptToDelivered.avgHours).toBeGreaterThanOrEqual(0);
    expect(res.body.delays.warehouseReceiptToReady.count).toBe(3);
    expect(res.body.delays.transport.count).toBe(1);
    expect(delivered.packageId).toBeTruthy();
  });

  it('revenus, remboursements, facturé et soldes impayés par devise, calculés sur les paiements et factures réels', async () => {
    const w = await setup();
    const customerId = await customerIdOf(t, w.customer);
    const invoiceFor = async () => {
      const pkg = await weighedPackage(t, w, w.customer, w.w1.id);
      const draft = await api(t).post('/v1/admin/invoices').set(bearer(w.token)).send({ customerId, packageIds: [pkg.packageId] });
      const issued = await api(t).post(`/v1/admin/invoices/${draft.body.id}/issue`).set(bearer(w.token));
      expect(issued.status).toBe(200);
      return issued.body.id as string;
    };
    const paid = await invoiceFor();
    await invoiceFor(); // reste dû : 9,50
    const partial = await invoiceFor();
    expect((await api(t).post('/v1/admin/cash-sessions').set(bearer(w.token)).send({})).status).toBe(201);
    const payment = await api(t).post('/v1/admin/payments/cash').set(bearer(w.token)).send({ invoiceId: paid, amount: 9.5 });
    await api(t).post('/v1/admin/payments/cash').set(bearer(w.token)).send({ invoiceId: partial, amount: 4 });
    expect((await api(t).post(`/v1/admin/payments/${payment.body.payment.id}/refunds`).set(bearer(w.token)).send({ amount: 1.5, reason: 'Geste' })).status).toBe(201);

    const res = await dashboard(w.token);
    expect(res.body.finance.collected).toEqual([{ currency: 'USD', amount: '13.50', count: 2 }]);
    expect(res.body.finance.refunded).toEqual([{ currency: 'USD', amount: '1.50' }]);
    expect(res.body.finance.invoiced).toEqual([{ currency: 'USD', amount: '28.50', count: 3 }]);
    // 9,50 (rien payé) + 5,50 (payé 4,00) + 1,50 (payé 9,50 puis remboursé 1,50)
    expect(res.body.finance.unpaid).toEqual([{ currency: 'USD', amount: '16.50', count: 3 }]);
    expect(res.body.packages.awaitingPayment).toBe(2);
  });

  it('incidents et réclamations : retenues ouvertes, réclamations par état, performance des livreurs', async () => {
    const w = await setup();
    const held = await readyPackage(t, w, w.customer, w.w1.id);
    expect((await api(t).post(`/v1/admin/packages/${held.packageId}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Contrôle', holdReasonCode: 'OTHER' })).status).toBe(200);
    expect((await api(t).post('/v1/me/claims').set(bearer(w.customer.token)).send({ category: 'LOST', subject: 'Perdu', message: 'Je ne trouve pas mon colis.' })).status).toBe(201);
    const second = await api(t).post('/v1/me/claims').set(bearer(w.customer.token)).send({ category: 'OTHER', subject: 'Question', message: 'Une question.' });
    await t.admin.claim.update({ where: { id: second.body.id }, data: { status: 'REJECTED', resolution: 'Hors sujet', resolvedAt: new Date() } });

    const res = await dashboard(w.token);
    expect(res.body.incidents).toMatchObject({ openHolds: 1, holdsOpenedInRange: 1, claimsOpenedInRange: 2, claimsOpenInProgress: 1 });
    expect(res.body.incidents.claimsByStatus).toEqual({ OPEN: 1, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 1 });
    expect(res.body.packages.onHold).toBe(1);
  });

  it('la période filtre les événements, pas les stocks ; périodes incohérentes refusées', async () => {
    const w = await setup();
    await deliveredPackage(w);
    const past = await dashboard(w.token, `?from=${day(-60)}&to=${day(-40)}`);
    expect(past.status).toBe(200);
    expect(past.body.packages).toMatchObject({ receivedInRange: 0, deliveredInRange: 0 });
    expect(past.body.packages.byStatus.DELIVERED).toBe(1); // état actuel, indépendant de la période
    expect(past.body.delays.agencyReceiptToDelivered).toEqual({ count: 0, avgHours: null });
    const future = await dashboard(w.token, `?from=${day(1)}&to=${day(5)}`);
    expect(future.body.packages.deliveredInRange).toBe(0);
    const exact = await dashboard(w.token, `?from=${day(0)}&to=${day(0)}`);
    expect(exact.body.packages.deliveredInRange).toBe(1); // la journée de fin est incluse

    for (const q of [`?from=${day(0)}`, `?to=${day(0)}`, `?from=${day(0)}&to=${day(-1)}`, `?from=${day(-400)}&to=${day(0)}`, '?from=x&to=y', '?bidon=1']) {
      expect((await dashboard(w.token, q)).status).toBe(400);
    }
  });

  it('réservé aux droits portant sur toute l’entreprise ; une autre entreprise ne voit rien de celle-ci', async () => {
    const a = await setup();
    const b = await setup();
    await deliveredPackage(a);
    expect((await dashboard(a.manager.token)).status).toBe(403); // droit limité à une agence
    expect((await dashboard(a.customer.token)).status).toBe(403);
    expect((await dashboard((await a.staff('BILLING_AGENT')).token)).status).toBe(403);
    expect((await dashboard((await a.staff('DRIVER')).token)).status).toBe(403);
    expect((await api(t).get('/v1/admin/dashboard')).status).toBe(401);
    const auditor = await dashboard((await a.staff('AUDITOR')).token);
    expect([200, 403]).toContain(auditor.status);
    const other = await dashboard(b.token);
    expect(other.body.packages.deliveredInRange).toBe(0);
    expect(other.body.customers.total).toBe(1);
    expect(other.body.finance.collected).toEqual([]);
  });

  it('performance des livreurs : réussites, échecs et taux, par livreur', async () => {
    const w = await setup();
    await api(t).put('/v1/admin/settings/delivery').set(bearer(w.token)).send({ requireOtp: false, requireIdDocument: false });
    await api(t).post('/v1/me/addresses').set(bearer(w.customer.token)).send({ kind: 'DELIVERY', label: 'Maison', recipientName: 'Marie', line1: '1 rue A', city: 'Delmas', country: 'ht' });
    const driver = await w.staff('DRIVER');
    const atAgency = async () => {
      const pkg = await readyPackage(t, w, w.customer, w.w1.id);
      const shipment = await api(t).post('/v1/admin/shipments').set(bearer(w.token)).send({ transportMode: 'AIR', originWarehouseId: w.w1.id, destinationCountry: 'HT', destinationAgencyId: w.agency.id });
      await api(t).post(`/v1/admin/shipments/${shipment.body.id}/packages`).set(bearer(w.token)).send({ packageId: pkg.packageId });
      for (const step of ['dispatch', 'arrive']) await api(t).post(`/v1/admin/shipments/${shipment.body.id}/${step}`).set(bearer(w.token)).send({});
      await api(t).post(`/v1/admin/agencies/${w.agency.id}/receive`).set(bearer(w.manager.token)).send({ code: pkg.trackingNumber });
      await api(t).post(`/v1/admin/agencies/${w.agency.id}/packages/${pkg.packageId}/ready-for-pickup`).set(bearer(w.manager.token)).send({});
      return pkg;
    };
    const route = (await api(t).post('/v1/admin/routes').set(bearer(w.token)).send({ agencyId: w.agency.id, driverUserId: driver.user.id, plannedDate: day(0) })).body;
    const stops = [];
    for (let i = 0; i < 3; i += 1) {
      const pkg = await atAgency();
      stops.push((await api(t).post(`/v1/admin/routes/${route.id}/stops`).set(bearer(w.token)).send({ packageId: pkg.packageId })).body);
    }
    expect((await api(t).post(`/v1/admin/routes/${route.id}/start`).set(bearer(w.token))).status).toBe(200);
    await api(t).post(`/v1/admin/route-stops/${stops[0].id}/deliver`).set(bearer(driver.token)).send({ recipientKind: 'CUSTOMER' });
    await api(t).post(`/v1/admin/route-stops/${stops[1].id}/deliver`).set(bearer(driver.token)).send({ recipientKind: 'CUSTOMER' });
    await api(t).post(`/v1/admin/route-stops/${stops[2].id}/fail`).set(bearer(driver.token)).send({ reason: 'ABSENT' });

    const res = await dashboard(w.token);
    expect(res.body.drivers).toEqual([{ id: driver.user.id, name: expect.any(String), succeeded: 2, failed: 1, successRate: 67 }]);
  });
});
