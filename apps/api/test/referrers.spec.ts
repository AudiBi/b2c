import { activateRateCard, api, bearer, buildTestApp, login, makeCustomer, makeTenant, makeUser, makeWarehouse, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;
const today = () => new Date().toISOString().slice(0, 10);

describe('Référents, commissions et incidents', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);
  const put = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).put(path).set(bearer(token)).send(body);
  const get = (token: string, path: string) => api(t).get(path).set(bearer(token));

  async function world() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token, {
      name: 'Aérien', transportMode: 'AIR', weightUnit: 'LB', dimensionUnit: 'IN', volumetricDivisor: 166, minBillableWeight: 0, roundingMode: 'NONE', roundingStep: 1, surcharges: [],
      rules: [{ weightFrom: 0, pricePerUnit: 5, unitCost: 3.9 }],
    });
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Rose', lastName: 'Pierre' });
    const accountant = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'ACCOUNTANT' }))).accessToken;
    const billing = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'BILLING_AGENT' }))).accessToken;
    return { ...tenant, warehouse, customerId: customer.body.id as string, accountant, billing };
  }
  type World = Awaited<ReturnType<typeof world>>;

  /** Colis aérien dense de 30 lb : 150 $ de fret, 117 $ de coût, 33 $ de profit, facture émise. */
  async function invoiced(w: World) {
    const created = await post(w.token, '/v1/admin/packages/counter', { warehouseId: w.warehouse.id, customerId: w.customerId, transportMode: 'AIR', recipientName: 'Jean Pierre' });
    await post(w.token, `/v1/admin/packages/${created.body.id}/register`, { weight: { value: 30, unit: 'LB' }, dimensions: { length: 12, width: 10, height: 8, unit: 'IN' } });
    const draft = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [created.body.id] });
    await post(w.token, `/v1/admin/invoices/${draft.body.id}/issue`);
  }

  it('relevé du mois : commission = 10 % du profit (33 $ → 3,30 $), payée une seule fois', async () => {
    const w = await world();
    const referrer = await post(w.accountant, '/v1/admin/referrers', { name: 'Paul Henry', rate: 10 });
    expect(referrer.status).toBe(201);
    expect((await put(w.accountant, `/v1/admin/customers/${w.customerId}/referrer`, { referrerId: referrer.body.id })).status).toBe(200);
    await invoiced(w);

    const month = today().slice(0, 7);
    const statement = await get(w.accountant, `/v1/admin/referrers/${referrer.body.id}/statement?month=${month}`);
    expect(statement.body).toMatchObject({ customers: 1, newCustomers: 1, packages: 1, revenue: '150.00', cost: '117.00', profit: '33.00', commission: '3.30', payout: null });

    const paid = await post(w.accountant, `/v1/admin/referrers/${referrer.body.id}/payouts`, { month, paidOn: today() });
    expect(paid.status).toBe(201);
    expect(paid.body.amount).toBe('3.30');
    expect(errorCode(await post(w.accountant, `/v1/admin/referrers/${referrer.body.id}/payouts`, { month, paidOn: today() }))).toBe('ALREADY_PAID');
    expect((await get(w.accountant, `/v1/admin/referrers/${referrer.body.id}/statement?month=${month}`)).body.payout).toMatchObject({ amount: '3.30' });
    // un mois sans activité : rien à payer
    expect(errorCode(await post(w.accountant, `/v1/admin/referrers/${referrer.body.id}/payouts`, { month: '2020-01', paidOn: today() }))).toBe('NOTHING_TO_PAY');
  });

  it('le profit net déduit les commissions et les incidents (indemnité 5 $ − remboursement 2 $)', async () => {
    const w = await world();
    const referrer = await post(w.accountant, '/v1/admin/referrers', { name: 'Paul Henry', rate: 10 });
    await put(w.accountant, `/v1/admin/customers/${w.customerId}/referrer`, { referrerId: referrer.body.id });
    await invoiced(w);

    const client = await makeCustomer(t, w.company);
    const claim = await api(t).post('/v1/me/claims').set(bearer(client.token)).send({ category: 'DAMAGED', subject: 'Colis abîmé', message: 'Écrasé.' });
    expect(claim.status).toBe(201);
    const compensation = await put(w.accountant, `/v1/admin/claims/${claim.body.id}/compensation`, { indemnity: 5, reimbursement: 2, currency: 'USD', paidOn: today() });
    expect(compensation.body).toMatchObject({ indemnity: '5.00', reimbursement: '2.00', net: '3.00' });

    const report = await get(w.accountant, '/v1/admin/reports/profit');
    expect(report.body.current).toMatchObject({ margin: '33.00', commissions: '3.30', incidents: '3.00', net: '26.70' });
  });

  it('confidentialité : le client ne voit jamais l’indemnité ni son référent ; la facturation n’accède à rien', async () => {
    const w = await world();
    const client = await makeCustomer(t, w.company);
    const claim = await api(t).post('/v1/me/claims').set(bearer(client.token)).send({ category: 'DAMAGED', subject: 'Colis abîmé', message: 'Écrasé.' });
    await put(w.accountant, `/v1/admin/claims/${claim.body.id}/compensation`, { indemnity: 50, reimbursement: 10, currency: 'USD', paidOn: today() });
    const mine = await get(client.token, `/v1/me/claims/${claim.body.id}`);
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body).toLowerCase()).not.toMatch(/indemnity|reimbursement|compensation|"50\.00"/);
    expect((await get(client.token, `/v1/admin/claims/${claim.body.id}/compensation`)).status).toBe(403);
    for (const path of ['/v1/admin/referrers', `/v1/admin/claims/${claim.body.id}/compensation`]) expect((await get(w.billing, path)).status).toBe(403);
    expect((await post(w.billing, '/v1/admin/referrers', { name: 'X', rate: 5 })).status).toBe(403);
  });

  it('refuse un pourcentage hors limites, un nom en double, un référent retiré', async () => {
    const w = await world();
    expect((await post(w.accountant, '/v1/admin/referrers', { name: 'A', rate: 120 })).status).toBe(400);
    const a = await post(w.accountant, '/v1/admin/referrers', { name: 'A', rate: 10 });
    expect(errorCode(await post(w.accountant, '/v1/admin/referrers', { name: 'A', rate: 5 }))).toBe('REFERRER_EXISTS');
    await api(t).patch(`/v1/admin/referrers/${a.body.id}`).set(bearer(w.accountant)).send({ active: false });
    expect(errorCode(await put(w.accountant, `/v1/admin/customers/${w.customerId}/referrer`, { referrerId: a.body.id }))).toBe('REFERRER_NOT_FOUND');
    expect((await put(w.accountant, `/v1/admin/customers/${w.customerId}/referrer`, { referrerId: null })).status).toBe(200);
  });
});
