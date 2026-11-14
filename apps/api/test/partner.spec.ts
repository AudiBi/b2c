import { api, bearer, buildTestApp, login, makeTenant, makeUser, makeWarehouse, type TestApp } from './helpers';

describe('Rôle partenaire (site à l’étranger) et envois Haïti → États-Unis', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);
  const get = (token: string, path: string) => api(t).get(path).set(bearer(token));

  async function world() {
    const tenant = await makeTenant(t);
    const miami = await makeWarehouse(t, tenant.token, { reference: 'MIA', city: 'Miami' });
    const philadelphia = await makeWarehouse(t, tenant.token, { reference: 'PHL', city: 'Philadelphie' });
    const partner = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'PARTNER', scope: { type: 'WAREHOUSE', id: philadelphia.id } }))).accessToken;
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    return { ...tenant, miami, philadelphia, partner, customerId: customer.body.id as string };
  }

  const counter = (token: string, warehouseId: string, customerId: string, extra: Record<string, unknown> = {}) =>
    post(token, '/v1/admin/packages/counter', { warehouseId, customerId, transportMode: 'AIR', recipientName: 'Jean Pierre', ...extra });

  it('le partenaire de Philadelphie crée des colis et des clients chez lui, pas à Miami', async () => {
    const w = await world();
    expect((await counter(w.partner, w.philadelphia.id, w.customerId)).status).toBe(201);
    const refused = await counter(w.partner, w.miami.id, w.customerId);
    expect(refused.status).toBe(403);
    expect((await post(w.partner, '/v1/admin/customers', { firstName: 'Nouveau', lastName: 'Client' })).status).toBe(201);
  });

  it('il ne voit que les colis de son entrepôt', async () => {
    const w = await world();
    const mine = await counter(w.token, w.philadelphia.id, w.customerId);
    const other = await counter(w.token, w.miami.id, w.customerId);
    const list = await get(w.partner, '/v1/admin/packages');
    expect(list.status).toBe(200);
    const ids = (list.body.items as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(mine.body.id);
    expect(ids).not.toContain(other.body.id);
    expect((await get(w.partner, `/v1/admin/packages/${other.body.id}`)).status).toBe(404);
  });

  it('jamais de coûts, de profit, de dépenses, de caisses ni de référents', async () => {
    const w = await world();
    for (const path of ['/v1/admin/reports/profit', '/v1/admin/expenses', '/v1/admin/petty-cash', '/v1/admin/deposits', '/v1/admin/referrers', '/v1/admin/customs-items', '/v1/admin/invoices']) {
      expect([path, (await get(w.partner, path)).status]).toEqual([path, 403]);
    }
  });

  it('envoi Haïti → États-Unis : entrepôt en Haïti, destination choisie au comptoir', async () => {
    const w = await world();
    const port = await makeWarehouse(t, w.token, { reference: 'PAP', country: 'ht', city: 'Port-au-Prince', name: 'Dépôt de Port-au-Prince' });
    const res = await counter(w.token, port.id, w.customerId, { destinationCountry: 'US', recipientCity: 'Miami' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ originCountry: 'HT', destinationCountry: 'US', destinationCity: 'Miami' });
  });
});
