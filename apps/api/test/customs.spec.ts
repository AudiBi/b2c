import { activateRateCard, api, bearer, buildTestApp, customerIdOf, login, makeCustomer, makeTenant, makeUser, makeWarehouse, weighedPackage, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Frais CONATEL (reversés)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);

  async function world() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token);
    const customer = await makeCustomer(t, tenant.company);
    const customerId = await customerIdOf(t, customer);
    const pkg = await weighedPackage(t, tenant, customer, warehouse.id);
    const defaults = await post(tenant.token, '/v1/admin/customs-items/defaults');
    const items = (await api(t).get('/v1/admin/customs-items').set(bearer(tenant.token))).body.items as any[];
    const find = (name: string, size = '') => items.find((i) => i.name === name && i.size === size);
    return { ...tenant, customer, customerId, pkg, defaults, find };
  }

  it('charge la table de départ une seule fois (idempotent)', async () => {
    const w = await world();
    expect(w.defaults.body).toEqual({ added: 21, total: 21 });
    expect((await post(w.token, '/v1/admin/customs-items/defaults')).body.added).toBe(0);
  });

  it("réservé à ceux qui gèrent les tarifs ; la facturation lit la table sans la modifier", async () => {
    const w = await world();
    const billing = (await login(t, await makeUser(t, { company: w.company, roleCode: 'BILLING_AGENT' }))).accessToken;
    expect((await post(billing, '/v1/admin/customs-items/defaults')).status).toBe(403);
    expect((await api(t).get('/v1/admin/customs-items').set(bearer(billing))).status).toBe(200);
  });

  it('prix fixe VIP, pourcentage de la valeur, et refus du prix à confirmer', async () => {
    const w = await world();
    const iphone = w.find('IPHONE', '12 à 17');
    const fixed = await post(w.token, `/v1/admin/packages/${w.pkg.packageId}/customs-lines`, { itemId: iphone.id, quantity: 2, vip: true });
    expect(fixed.status).toBe(201);
    expect(fixed.body.fee).toBe('50.00');

    const drone = w.find('DRONE');
    expect(errorCode(await post(w.token, `/v1/admin/packages/${w.pkg.packageId}/customs-lines`, { itemId: drone.id }))).toBe('VALUE_REQUIRED');
    const pct = await post(w.token, `/v1/admin/packages/${w.pkg.packageId}/customs-lines`, { itemId: drone.id, declaredValue: 500 });
    expect(pct.body.fee).toBe('100.00');

    const watch = w.find('SMART WATCH');
    expect(errorCode(await post(w.token, `/v1/admin/packages/${w.pkg.packageId}/customs-lines`, { itemId: watch.id }))).toBe('PRICE_TO_CONFIRM');

    const list = await api(t).get(`/v1/admin/packages/${w.pkg.packageId}/customs-lines`).set(bearer(w.token));
    expect(list.body.total).toBe('150.00');
    expect(list.body.items).toHaveLength(2);
  });

  it('la facture reprend les frais en lignes CUSTOMS, puis le colis facturé ne peut plus changer', async () => {
    const w = await world();
    const line = await post(w.token, `/v1/admin/packages/${w.pkg.packageId}/customs-lines`, { itemId: w.find('IPAD').id });
    expect(line.body.fee).toBe('40.00');

    const invoice = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [w.pkg.packageId] });
    expect(invoice.status).toBe(201);
    const customs = (invoice.body.lines as any[]).filter((l) => l.kind === 'CUSTOMS');
    expect(customs).toHaveLength(1);
    expect(customs[0].amount).toBe('40.00');
    expect(customs[0].description).toContain('CONATEL');
    // fret 8,00 + manutention 1,50 (grille de test) + 40,00 de frais reversés
    expect(Number(invoice.body.total)).toBeCloseTo(49.5, 2);

    expect((await post(w.token, `/v1/admin/packages/${w.pkg.packageId}/customs-lines`, { itemId: w.find('IPAD').id })).status).toBe(409);
    expect((await api(t).delete(`/v1/admin/packages/${w.pkg.packageId}/customs-lines/${line.body.id}`).set(bearer(w.token))).status).toBe(409);
  });

  it('une ligne retirée avant facturation disparaît du total', async () => {
    const w = await world();
    const line = await post(w.token, `/v1/admin/packages/${w.pkg.packageId}/customs-lines`, { itemId: w.find('IPAD').id });
    expect((await api(t).delete(`/v1/admin/packages/${w.pkg.packageId}/customs-lines/${line.body.id}`).set(bearer(w.token))).status).toBe(204);
    const list = await api(t).get(`/v1/admin/packages/${w.pkg.packageId}/customs-lines`).set(bearer(w.token));
    expect(list.body.items).toHaveLength(0);
  });
});
