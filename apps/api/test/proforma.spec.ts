import { activateRateCard, api, bearer, buildTestApp, makeCustomer, makeTenant, makeWarehouse, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Proforma du personnel', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);
  const get = (token: string, path: string) => api(t).get(path).set(bearer(token));
  const quote = { transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 30, unit: 'LB' }, dimensions: { length: 12, width: 10, height: 8, unit: 'IN' } };

  async function world(withCard = true) {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    if (withCard) {
      await activateRateCard(t, tenant.token, { name: 'Aérien', transportMode: 'AIR', weightUnit: 'LB', dimensionUnit: 'IN', volumetricDivisor: 166, minBillableWeight: 0, roundingMode: 'NONE', roundingStep: 1, surcharges: [], rules: [{ weightFrom: 0, pricePerUnit: 5 }] });
    }
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    return { ...tenant, warehouse, customerId: customer.body.id as string };
  }

  it('crée une proforma figée (150 $), numérotée, valable 30 jours, avec son PDF', async () => {
    const w = await world();
    const res = await post(w.token, '/v1/admin/proformas', { customerId: w.customerId, quote });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ currency: 'USD', total: '150.00', expired: false, convertedPackageId: null });
    expect(res.body.number).toMatch(/^PF-\d{4}-000001$/);
    const days = (new Date(res.body.validUntil).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(31);

    const pdf = await get(w.token, `/v1/admin/proformas/${res.body.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await get(w.token, '/v1/admin/proformas')).body.items).toHaveLength(1);
  });

  it('se transforme en colis de comptoir une seule fois', async () => {
    const w = await world();
    const pf = await post(w.token, '/v1/admin/proformas', { customerId: w.customerId, quote });
    const body = { warehouseId: w.warehouse.id, recipientName: 'Jean Pierre', recipientCity: 'Delmas' };
    const converted = await post(w.token, `/v1/admin/proformas/${pf.body.id}/convert`, body);
    expect(converted.status).toBe(201);
    expect(converted.body).toMatchObject({ status: 'RECEIVED_AT_WAREHOUSE', transportMode: 'AIR', recipientName: 'Jean Pierre', destinationCity: 'Delmas' });
    expect((await get(w.token, `/v1/admin/proformas/${pf.body.id}`)).body.convertedPackageId).toBe(converted.body.id);
    expect(errorCode(await post(w.token, `/v1/admin/proformas/${pf.body.id}/convert`, body))).toBe('PROFORMA_ALREADY_CONVERTED');
  });

  it('une proforma périmée ne se transforme pas', async () => {
    const w = await world();
    const pf = await post(w.token, '/v1/admin/proformas', { customerId: w.customerId, quote, validDays: 1 });
    await t.admin.proforma.update({ where: { id: pf.body.id }, data: { validUntil: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await get(w.token, `/v1/admin/proformas/${pf.body.id}`)).body.expired).toBe(true);
    expect(errorCode(await post(w.token, `/v1/admin/proformas/${pf.body.id}/convert`, { warehouseId: w.warehouse.id, recipientName: 'X' }))).toBe('PROFORMA_EXPIRED');
  });

  it('sans tarif applicable : 422, jamais de prix inventé ; un client n’y accède pas', async () => {
    const w = await world(false);
    const none = await post(w.token, '/v1/admin/proformas', { customerId: w.customerId, quote });
    expect(none.status).toBe(422);
    expect(errorCode(none)).toBe('TARIFF_UNAVAILABLE');
    const client = await makeCustomer(t, w.company);
    expect((await get(client.token, '/v1/admin/proformas')).status).toBe(403);
    expect((await api(t).get('/v1/admin/proformas')).status).toBe(401);
  });
});
