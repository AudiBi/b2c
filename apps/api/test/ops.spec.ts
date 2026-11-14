import { api, bearer, buildTestApp, login, makeTenant, makeUser, makeWarehouse, type TestApp } from './helpers';

describe('Exploitation : alerte de retard et flot par client', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);
  const get = (token: string, path: string) => api(t).get(path).set(bearer(token));

  it('un colis resté sans changement plus de 14 jours est signalé ; un colis récent non', async () => {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    const old = await post(tenant.token, '/v1/admin/packages/counter', { warehouseId: warehouse.id, customerId: customer.body.id, transportMode: 'AIR', recipientName: 'Jean Pierre' });
    const fresh = await post(tenant.token, '/v1/admin/packages/counter', { warehouseId: warehouse.id, customerId: customer.body.id, transportMode: 'AIR', recipientName: 'Anne Pierre' });
    await t.admin.package.update({ where: { id: old.body.id }, data: { updatedAt: new Date(Date.now() - 20 * 86_400_000) } });

    const report = await get(tenant.token, '/v1/admin/reports/delays');
    expect(report.status).toBe(200);
    const ids = (report.body.items as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(old.body.id);
    expect(ids).not.toContain(fresh.body.id);
    expect(report.body.items[0].idleDays).toBeGreaterThanOrEqual(19);
    expect((await get(tenant.token, '/v1/admin/reports/delays?days=60')).body.items).toHaveLength(0);
  });

  it('flot d’un client : total, colis ouverts, répartition par statut', async () => {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    for (const name of ['A', 'B']) await post(tenant.token, '/v1/admin/packages/counter', { warehouseId: warehouse.id, customerId: customer.body.id, transportMode: 'AIR', recipientName: name });
    const flow = await get(tenant.token, `/v1/admin/customers/${customer.body.id}/flow`);
    expect(flow.body).toMatchObject({ total: 2, open: 2, byStatus: { RECEIVED_AT_WAREHOUSE: 2 } });
    expect(flow.body.recent).toHaveLength(2);
  });

  it('le partenaire d’un autre site ne voit pas les retards des entrepôts qui ne sont pas les siens', async () => {
    const tenant = await makeTenant(t);
    const miami = await makeWarehouse(t, tenant.token, { reference: 'MIA' });
    const phl = await makeWarehouse(t, tenant.token, { reference: 'PHL' });
    const partner = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'PARTNER', scope: { type: 'WAREHOUSE', id: phl.id } }))).accessToken;
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    const inMiami = await post(tenant.token, '/v1/admin/packages/counter', { warehouseId: miami.id, customerId: customer.body.id, transportMode: 'AIR', recipientName: 'X' });
    await t.admin.package.update({ where: { id: inMiami.body.id }, data: { updatedAt: new Date(Date.now() - 30 * 86_400_000) } });
    expect((await get(partner, '/v1/admin/reports/delays')).body.items).toHaveLength(0);
    expect((await get(tenant.token, '/v1/admin/reports/delays')).body.items).toHaveLength(1);
  });
});
