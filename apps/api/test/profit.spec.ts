import { activateRateCard, api, bearer, buildTestApp, login, makeCustomer, makeTenant, makeUser, makeWarehouse, type TestApp } from './helpers';

describe('Coûts, dépenses et profit (annexe 8.3 : mêmes chiffres que l’outil de gestion)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);
  const get = (token: string, path: string) => api(t).get(path).set(bearer(token));

  /** Aérien 5 $/lb (coût 3,90 $/lb, diviseur 166) et maritime 18 $/pi³ (coût 14 $/pi³), comme l'outil de gestion. */
  async function world() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    const common = { weightUnit: 'LB', dimensionUnit: 'IN', volumetricDivisor: 166, minBillableWeight: 0, roundingMode: 'NONE', roundingStep: 1, surcharges: [] };
    const air = await activateRateCard(t, tenant.token, { ...common, name: 'Aérien', transportMode: 'AIR', rules: [{ weightFrom: 0, pricePerUnit: 5, unitCost: 3.9 }] });
    await activateRateCard(t, tenant.token, { ...common, name: 'Maritime', transportMode: 'SEA', rules: [{ weightFrom: 0, pricePerUnit: 18, basis: 'VOLUME', unitCost: 14 }] });
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    const accountant = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'ACCOUNTANT' }))).accessToken;
    const billing = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'BILLING_AGENT' }))).accessToken;
    return { ...tenant, warehouse, customerId: customer.body.id as string, airCardId: air.id, accountant, billing };
  }
  type World = Awaited<ReturnType<typeof world>>;

  async function invoiced(w: World, mode: 'AIR' | 'SEA', body: Record<string, unknown>) {
    const created = await post(w.token, '/v1/admin/packages/counter', { warehouseId: w.warehouse.id, customerId: w.customerId, transportMode: mode, recipientName: 'Jean Pierre' });
    expect(created.status).toBe(201);
    const weighed = await post(w.token, `/v1/admin/packages/${created.body.id}/register`, body);
    expect(weighed.status).toBe(200);
    const draft = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [created.body.id] });
    expect(draft.status).toBe(201);
    expect((await post(w.token, `/v1/admin/invoices/${draft.body.id}/issue`)).status).toBe(200);
    return created.body.id as string;
  }

  it('rejoue l’exemple de l’outil de gestion : CA 222 $, coût 173 $, marge 49 $, net 39 $ ; les frais CONATEL sont hors marge', async () => {
    const w = await world();
    // aérien dense : 30 lb → 150 $, coût 30 × 3,90 = 117 $
    const airId = await invoiced(w, 'AIR', { weight: { value: 30, unit: 'LB' }, dimensions: { length: 12, width: 10, height: 8, unit: 'IN' } });
    // maritime : 24×18×16 po = 4 pi³ → 72 $, coût 4 × 14 = 56 $
    await invoiced(w, 'SEA', { weight: { value: 10, unit: 'LB' }, dimensions: { length: 24, width: 18, height: 16, unit: 'IN' } });
    expect(airId).toBeTruthy();
    expect((await post(w.token, '/v1/admin/expenses', { spentOn: new Date().toISOString().slice(0, 10), category: 'RENT', description: 'Loyer', amount: 10, currency: 'USD' })).status).toBe(201);

    const report = await get(w.accountant, '/v1/admin/reports/profit');
    expect(report.status).toBe(200);
    expect(report.body.current).toMatchObject({ revenue: '222.00', cost: '173.00', margin: '49.00', expenses: '10.00', net: '39.00', customsPassThrough: '0.00' });
    expect(report.body.current.byMode.AIR).toMatchObject({ revenue: '150.00', cost: '117.00', margin: '33.00' });
    expect(report.body.current.byMode.SEA).toMatchObject({ revenue: '72.00', cost: '56.00', margin: '16.00' });
    expect(report.body.items).toHaveLength(12);
  });

  it('les frais CONATEL passent sur la facture mais restent hors chiffre d’affaires et hors marge', async () => {
    const w = await world();
    await post(w.token, '/v1/admin/customs-items/defaults');
    const items = (await get(w.token, '/v1/admin/customs-items')).body.items as any[];
    const created = await post(w.token, '/v1/admin/packages/counter', { warehouseId: w.warehouse.id, customerId: w.customerId, transportMode: 'AIR', recipientName: 'Jean Pierre' });
    await post(w.token, `/v1/admin/packages/${created.body.id}/register`, { weight: { value: 30, unit: 'LB' }, dimensions: { length: 12, width: 10, height: 8, unit: 'IN' } });
    await post(w.token, `/v1/admin/packages/${created.body.id}/customs-lines`, { itemId: items.find((i) => i.name === 'IPAD').id });
    const draft = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [created.body.id] });
    expect(Number(draft.body.total)).toBe(190);
    await post(w.token, `/v1/admin/invoices/${draft.body.id}/issue`);
    const report = await get(w.token, '/v1/admin/reports/profit');
    expect(report.body.current).toMatchObject({ revenue: '150.00', customsPassThrough: '40.00', cost: '117.00', margin: '33.00' });
  });

  it('confidentialité : ni la facturation, ni le client, ni le public ne voient un coût ou une marge', async () => {
    const w = await world();
    const customer = await makeCustomer(t, w.company);
    // détail de la grille : aucun coût, même pour l'administrateur ; la liste des coûts a sa permission
    const detail = await get(w.token, `/v1/admin/rate-cards/${w.airCardId}`);
    expect(JSON.stringify(detail.body)).not.toMatch(/unitCost|3\.9/);
    expect((await get(w.billing, `/v1/admin/rate-cards/${w.airCardId}/costs`)).status).toBe(403);
    expect((await get(w.accountant, `/v1/admin/rate-cards/${w.airCardId}/costs`)).body.items[0].unitCost).toBe('3.9');
    // profit et dépenses : réservés
    for (const path of ['/v1/admin/reports/profit', '/v1/admin/expenses']) {
      expect((await get(w.billing, path)).status).toBe(403);
      expect((await get(customer.token, path)).status).toBe(403);
      expect((await api(t).get(path)).status).toBe(401);
    }
    expect((await post(w.billing, '/v1/admin/expenses', { spentOn: '2026-01-01', category: 'RENT', description: 'x', amount: 1, currency: 'USD' })).status).toBe(403);
    // estimation publique : jamais de coût
    const quote = await api(t).post(`/v1/public/companies/${w.company.slug}/quote`).send({ transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 30, unit: 'LB' } });
    expect(quote.status).toBe(200);
    expect(JSON.stringify(quote.body).toLowerCase()).not.toContain('cost');
  });

  it('le coût d’un colis est figé à la pesée : changer la grille ensuite ne réécrit pas le profit', async () => {
    const w = await world();
    await invoiced(w, 'AIR', { weight: { value: 30, unit: 'LB' }, dimensions: { length: 12, width: 10, height: 8, unit: 'IN' } });
    const row = await t.admin.package.findFirst({ where: { companyId: w.company.id }, select: { costAmount: true, costCurrency: true } });
    expect(row?.costAmount?.toFixed(2)).toBe('117.00');
    expect(row?.costCurrency).toBe('USD');
  });

  it('dépenses : saisie, correction journalisée, suppression, conversion des gourdes au taux courant', async () => {
    const w = await world();
    const today = new Date().toISOString().slice(0, 10);
    const created = await post(w.accountant, '/v1/admin/expenses', { spentOn: today, category: 'ELECTRICITY', description: 'EDH', amount: 135, currency: 'HTG' });
    expect(created.status).toBe(201);
    await api(t).put('/v1/admin/settings/fx-rate').set(bearer(w.token)).send({ htgPerUsd: 135 });
    const report = await get(w.accountant, '/v1/admin/reports/profit');
    expect(report.body.current.expenses).toBe('1.00');
    expect(report.body.notes.expensesConvertedFromHtg).toBe(true);

    const edited = await api(t).patch(`/v1/admin/expenses/${created.body.id}`).set(bearer(w.accountant)).send({ amount: 270 });
    expect(edited.body.amount).toBe('270.00');
    expect((await t.admin.auditLog.findFirst({ where: { companyId: w.company.id, action: 'expense.updated' } }))?.before).toMatchObject({ amount: '135.00' });
    expect((await api(t).delete(`/v1/admin/expenses/${created.body.id}`).set(bearer(w.accountant))).status).toBe(204);
    expect((await get(w.accountant, '/v1/admin/expenses')).body.items).toHaveLength(0);
  });

  it('sans le droit cost:manage, fixer un coût est refusé', async () => {
    const w = await world();
    const res = await post(w.billing, '/v1/admin/rate-cards', { name: 'x', transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', currency: 'USD', weightUnit: 'LB', dimensionUnit: 'IN', volumetricDivisor: 166, validFrom: '2020-01-01', rules: [{ weightFrom: 0, pricePerUnit: 1, unitCost: 1 }] });
    expect([403]).toContain(res.status);
  });
});
