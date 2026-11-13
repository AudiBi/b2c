import { api, bearer, buildTestApp, login, makeCustomer, makeTenant, makeUser, makeWarehouse, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Comptoir : clients sans compte et colis créés par le personnel', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);

  it('crée un client sans e-mail : aucun accès, aucune adresse factice visible', async () => {
    const tenant = await makeTenant(t);
    const res = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: "O'Brien", phone: '+13055550000' });
    expect(res.status).toBe(201);
    expect(res.body.hasAccess).toBe(false);
    expect(res.body.email).toBeNull();
    expect(res.body.customerCode).toBeTruthy();

    const list = await api(t).get('/v1/admin/customers').query({ q: 'Brien' }).set(bearer(tenant.token));
    expect(list.body.items[0].hasAccess).toBe(false);
    expect(list.body.items[0].email).toBeNull();
  });

  it("refuse deux clients avec la même adresse et l'invitation d'un compte déjà actif", async () => {
    const tenant = await makeTenant(t);
    const active = await makeCustomer(t, tenant.company);
    const dup = await post(tenant.token, '/v1/admin/customers', { firstName: 'A', lastName: 'B', email: active.user.email });
    expect(dup.status).toBe(409);
    expect(errorCode(dup)).toBe('EMAIL_ALREADY_USED');
  });

  it('invite un client sans compte : il obtient une adresse et un accès en attente d\'activation', async () => {
    const tenant = await makeTenant(t);
    const created = await post(tenant.token, '/v1/admin/customers', { firstName: 'Jean', lastName: 'Pierre' });
    const invited = await post(tenant.token, `/v1/admin/customers/${created.body.id}/invite`, { email: 'jean.pierre@example.test' });
    expect(invited.status).toBe(201);
    expect(invited.body.hasAccess).toBe(true);
    expect(invited.body.email).toBe('jean.pierre@example.test');
  });

  it('crée un colis de comptoir avec destinataire, reçu en entrepôt, et refuse un ancien numéro déjà utilisé', async () => {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    const body = {
      warehouseId: warehouse.id,
      customerId: customer.body.id,
      transportMode: 'AIR',
      recipientName: 'Jean Pierre',
      recipientPhone: '+50934111111',
      recipientCity: 'Port-au-Prince',
      legacyTrackingNumber: 'B2C-0001',
    };
    const res = await post(tenant.token, '/v1/admin/packages/counter', body);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('RECEIVED_AT_WAREHOUSE');

    const again = await post(tenant.token, '/v1/admin/packages/counter', body);
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('LEGACY_TRACKING_EXISTS');
  });

  it("interdit la création de clients et de colis à un compte client", async () => {
    const tenant = await makeTenant(t);
    const customer = await makeCustomer(t, tenant.company);
    const token = customer.token;
    expect((await post(token, '/v1/admin/customers', { firstName: 'X', lastName: 'Y' })).status).toBe(403);
  });

  it("autorise l'agent de réception à créer un client", async () => {
    const tenant = await makeTenant(t);
    const agent = await makeUser(t, { company: tenant.company, roleCode: 'CUSTOMER_SERVICE' });
    const token = (await login(t, agent)).accessToken;
    expect((await post(token, '/v1/admin/customers', { firstName: 'X', lastName: 'Y' })).status).toBe(201);
  });
});
