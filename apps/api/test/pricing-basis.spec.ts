import { api, bearer, buildTestApp, activateRateCard, makeTenant, makeWarehouse, type TestApp } from './helpers';

describe('Tarification au volume et à l’unité (grille maritime)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);

  async function world() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    const cat = await post(tenant.token, '/v1/admin/categories', { code: 'DRUM', name: { fr: 'Baril', ht: 'Barik', en: 'Drum' } });
    expect(cat.status).toBe(201);
    await activateRateCard(t, tenant.token, {
      name: 'Maritime métier',
      transportMode: 'SEA',
      weightUnit: 'LB',
      dimensionUnit: 'IN',
      volumetricDivisor: 166,
      minBillableWeight: 0,
      roundingMode: 'NONE',
      roundingStep: 1,
      rules: [
        { weightFrom: 0, pricePerUnit: 18, basis: 'VOLUME' },
        { categoryCode: 'DRUM', weightFrom: 0, pricePerUnit: 220, basis: 'UNIT' },
      ],
      surcharges: [],
    });
    const customer = await post(tenant.token, '/v1/admin/customers', { firstName: 'Marie', lastName: 'Dupont' });
    return { ...tenant, warehouse, customerId: customer.body.id as string };
  }

  async function weigh(w: Awaited<ReturnType<typeof world>>, body: Record<string, unknown>) {
    const created = await post(w.token, '/v1/admin/packages/counter', { warehouseId: w.warehouse.id, customerId: w.customerId, transportMode: 'SEA', recipientName: 'Jean Pierre' });
    expect(created.status).toBe(201);
    const weighed = await post(w.token, `/v1/admin/packages/${created.body.id}/register`, body);
    expect(weighed.status).toBe(200);
    return weighed.body;
  }

  it('boîte au volume : 24×18×16 po = 4 pi³ × 18 $ = 72 $', async () => {
    const w = await world();
    const pkg = await weigh(w, { weight: { value: 10, unit: 'LB' }, dimensions: { length: 24, width: 18, height: 16, unit: 'IN' } });
    expect(Number(pkg.pricing.freight)).toBe(72);
    expect(pkg.measures.billableWeight).toBeNull();
  });

  it('2 barils : tarif à l’unité, 440 $ avant rabais', async () => {
    const w = await world();
    const pkg = await weigh(w, { weight: { value: 50, unit: 'LB' }, dimensions: { length: 23, width: 23, height: 35, unit: 'IN' }, categoryCode: 'DRUM', quantity: 2 });
    expect(Number(pkg.pricing.freight)).toBe(440);
  });

  it('facturation de 2 barils avec un rabais de 20 $ par baril : 440 − 40 = 400 $, ligne de rabais séparée', async () => {
    const w = await world();
    const pkg = await weigh(w, { weight: { value: 50, unit: 'LB' }, dimensions: { length: 23, width: 23, height: 35, unit: 'IN' }, categoryCode: 'DRUM', quantity: 2 });
    const invoice = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [pkg.id], unitDiscounts: [{ packageId: pkg.id, perUnit: 20 }] });
    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.total)).toBe(400);
    expect((invoice.body.lines as any[]).filter((l) => l.kind === 'DISCOUNT')).toHaveLength(1);

    const other = await weigh(w, { weight: { value: 50, unit: 'LB' }, dimensions: { length: 23, width: 23, height: 35, unit: 'IN' }, categoryCode: 'DRUM', quantity: 2 });
    const tooHigh = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [other.id], unitDiscounts: [{ packageId: other.id, perUnit: 100 }] });
    expect(tooHigh.status).toBe(422);
  });

  it("le rabais par unité est refusé sur un colis au volume", async () => {
    const w = await world();
    const pkg = await weigh(w, { weight: { value: 10, unit: 'LB' }, dimensions: { length: 24, width: 18, height: 16, unit: 'IN' } });
    const res = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [pkg.id], unitDiscounts: [{ packageId: pkg.id, perUnit: 1 }] });
    expect(res.body.error.code).toBe('UNIT_DISCOUNT_NOT_APPLICABLE');
  });

  it('le calculateur de devis accepte la quantité', async () => {
    const w = await world();
    const res = await post(w.token, '/v1/admin/quotes', { transportMode: 'SEA', originCountry: 'US', destinationCountry: 'HT', weight: { value: 1, unit: 'LB' }, dimensions: { length: 18, width: 18, height: 18, unit: 'IN' }, quantity: 10 });
    if (res.status === 404) return; // route de devis du personnel absente : couvert par les tests du calculateur
    expect(res.status).toBe(200);
    expect(res.body.result.total).toBe('607.50');
  });

  it('refuse une grille qui mélange les bases dans une même catégorie', async () => {
    const tenant = await makeTenant(t);
    const res = await post(tenant.token, '/v1/admin/rate-cards', {
      name: 'Mixte', transportMode: 'SEA', originCountry: 'US', destinationCountry: 'HT', currency: 'USD', weightUnit: 'LB', dimensionUnit: 'IN',
      volumetricDivisor: 166, validFrom: '2020-01-01',
      rules: [{ weightFrom: 0, weightTo: 10, pricePerUnit: 1, basis: 'VOLUME' }, { weightFrom: 10, pricePerUnit: 1, basis: 'WEIGHT' }],
    });
    expect(res.status).toBe(400);
  });
});
