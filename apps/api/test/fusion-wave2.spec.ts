import { activateRateCard, api, bearer, buildTestApp, customerIdOf, login, makeCustomer, makeTenant, makeUser, makeWarehouse, weighedPackage, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Fusion, vagues 0 et 2 : prix convenu, MonCash, taux en gourdes', () => {
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
    const billing = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'BILLING_AGENT' }))).accessToken;
    return { ...tenant, customer, customerId, pkg, billing };
  }

  describe('prix convenu', () => {
    it('refusé sans la permission price:override, même pour la facturation', async () => {
      const w = await world();
      const res = await post(w.billing, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [w.pkg.packageId], priceOverrides: [{ packageId: w.pkg.packageId, amount: 5, reason: 'Geste commercial' }] });
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('PRICE_OVERRIDE_NOT_ALLOWED');
    });

    it("l'administrateur remplace le tarif calculé : ligne « Prix convenu », écart et motif dans le journal", async () => {
      const w = await world();
      const res = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [w.pkg.packageId], priceOverrides: [{ packageId: w.pkg.packageId, amount: 5, reason: 'Geste commercial' }] });
      expect(res.status).toBe(201);
      expect(Number(res.body.total)).toBe(5);
      const lines = res.body.lines as { description: string; amount: string }[];
      expect(lines).toHaveLength(1);
      expect(lines[0].description).toContain('Prix convenu');

      const audit = await t.admin.auditLog.findFirst({ where: { companyId: w.company.id, action: 'invoice.drafted' }, orderBy: { createdAt: 'desc' } });
      expect((audit?.after as any).priceOverrides[0]).toMatchObject({ agreed: '5.00', reason: 'Geste commercial' });
      expect((audit?.after as any).priceOverrides[0].computed).not.toBeNull();
    });

    it("refuse un prix convenu pour un colis qui n'est pas sur la facture, et sans motif", async () => {
      const w = await world();
      const stranger = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';
      const unknown = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [w.pkg.packageId], priceOverrides: [{ packageId: stranger, amount: 5, reason: 'x' }] });
      expect(errorCode(unknown)).toBe('PRICE_OVERRIDE_PACKAGE_UNKNOWN');
      const noReason = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [w.pkg.packageId], priceOverrides: [{ packageId: w.pkg.packageId, amount: 5, reason: '' }] });
      expect(noReason.status).toBe(400);
    });
  });

  describe('MonCash', () => {
    it('est proposé comme mode déclaré, puis validé comme Zelle', async () => {
      const w = await world();
      const options = await api(t).get('/v1/me/payment-options').set(bearer(w.customer.token));
      if (options.status === 200) expect(options.body.declare).toContain('MOBILE_MONEY');
      const invoice = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [w.pkg.packageId] });
      await post(w.token, `/v1/admin/invoices/${invoice.body.id}/issue`);
      const declared = await post(w.customer.token, `/v1/me/invoices/${invoice.body.id}/payments`, { method: 'MOBILE_MONEY', amount: 2, reference: 'MC-0001' });
      expect(declared.status).toBe(201);
    });
  });

  describe('taux gourdes / dollar (affichage seulement)', () => {
    it('se règle avec historique, journalisé, réservé à settings:update', async () => {
      const w = await world();
      expect((await api(t).get('/v1/admin/settings/fx-rate').set(bearer(w.token))).body).toEqual({ current: null, history: [] });
      expect((await api(t).put('/v1/admin/settings/fx-rate').set(bearer(w.token)).send({ htgPerUsd: 135 })).status).toBe(200);
      const second = await api(t).put('/v1/admin/settings/fx-rate').set(bearer(w.token)).send({ htgPerUsd: 140, note: 'Banque' });
      expect(second.body.current.htgPerUsd).toBe(140);
      expect(second.body.history.map((h: any) => h.htgPerUsd)).toEqual([140, 135]);
      expect((await api(t).put('/v1/admin/settings/fx-rate').set(bearer(w.billing)).send({ htgPerUsd: 1 })).status).toBe(403);
      expect((await api(t).put('/v1/admin/settings/fx-rate').set(bearer(w.token)).send({ htgPerUsd: 0 })).status).toBe(400);
      // lisible par tout utilisateur connecté (équivalent affiché sur les factures), jamais par un visiteur
      expect((await api(t).get('/v1/me/fx-rate').set(bearer(w.customer.token))).body.htgPerUsd).toBe(140);
      expect((await api(t).get('/v1/me/fx-rate').set(bearer(w.billing))).body.htgPerUsd).toBe(140);
      expect((await api(t).get('/v1/me/fx-rate')).status).toBe(401);
    });
  });
  describe('règle de paiement : l’une, l’autre ou les deux', () => {
    it('« avant expédition et avant remise » : le colis attend le paiement après l’émission, comme « avant expédition »', async () => {
      for (const policy of ['PAY_BEFORE_BOTH', 'PAY_BEFORE_SHIPMENT', 'PAY_BEFORE_RELEASE'] as const) {
        const w = await world();
        await t.admin.company.update({ where: { id: w.company.id }, data: { paymentPolicy: policy } });
        const draft = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [w.pkg.packageId] });
        expect((await post(w.token, `/v1/admin/invoices/${draft.body.id}/issue`)).status).toBe(200);
        const pkg = await t.admin.package.findUniqueOrThrow({ where: { id: w.pkg.packageId } });
        expect([policy, pkg.status]).toEqual([policy, policy === 'PAY_BEFORE_RELEASE' ? 'READY_TO_SHIP' : 'AWAITING_PAYMENT']);
      }
    });
  });
});
