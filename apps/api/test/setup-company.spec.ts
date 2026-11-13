import { api, bearer, buildTestApp, makeTenant, type TestApp } from './helpers';
import { runSetup, type Call } from '../../../scripts/setup-company/setup';

describe('Mise en place des données réelles', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const caller = (token: string): Call => async (method, path, body) => {
    const req = method === 'GET' ? api(t).get(path) : method === 'POST' ? api(t).post(path) : api(t).put(path);
    const res = await req.set(bearer(token)).send(body as object | undefined);
    return { status: res.status, body: res.body };
  };

  it("crée tout, puis un second passage ne change rien ; les prix du prototype sont retrouvés", async () => {
    const tenant = await makeTenant(t);
    const call = caller(tenant.token);

    const first = await runSetup(call, { validFrom: '2020-01-01' });
    expect(first.created.length).toBeGreaterThanOrEqual(8);

    const second = await runSetup(call, { validFrom: '2020-01-01' });
    expect(second.created).toEqual([]);

    expect((await api(t).get('/v1/admin/warehouses').set(bearer(tenant.token))).body.items).toHaveLength(2);
    expect((await api(t).get('/v1/admin/customs-items').set(bearer(tenant.token))).body.items).toHaveLength(21);

    // aérien : 12 lb, 20×16×12 po, diviseur 166 → 115,67 $ ; maritime : 4 pi³ × 18 $ = 72 $ ; 2 barils = 440 $
    const quote = (body: object) => api(t).post(`/v1/public/companies/${tenant.company.slug}/quote`).send({ originCountry: 'US', destinationCountry: 'HT', ...body });
    const air = await quote({ transportMode: 'AIR', weight: { value: 12, unit: 'LB' }, dimensions: { length: 20, width: 16, height: 12, unit: 'IN' } });
    expect(air.status).toBe(200);
    expect(air.body.result.total).toBe('115.67');
    const sea = await quote({ transportMode: 'SEA', weight: { value: 1, unit: 'LB' }, dimensions: { length: 24, width: 18, height: 16, unit: 'IN' } });
    expect(sea.body.result.total).toBe('72.00');
    const drums = await quote({ transportMode: 'SEA', weight: { value: 1, unit: 'LB' }, categoryCode: 'DRUM', quantity: 2 });
    expect(drums.body.result.freight).toBe('440.00');
  });
});
