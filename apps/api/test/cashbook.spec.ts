import { activateRateCard, api, bearer, buildTestApp, customerIdOf, login, makeCustomer, makeTenant, makeUser, makeWarehouse, weighedPackage, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;
const today = () => new Date().toISOString().slice(0, 10);

describe('Petite caisse et dépôts bancaires', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);
  const get = (token: string, path: string) => api(t).get(path).set(bearer(token));

  async function world() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token);
    const customer = await makeCustomer(t, tenant.company);
    const customerId = await customerIdOf(t, customer);
    const accountant = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'ACCOUNTANT' }))).accessToken;
    const billing = (await login(t, await makeUser(t, { company: tenant.company, roleCode: 'BILLING_AGENT' }))).accessToken;
    return { ...tenant, warehouse, customer, customerId, accountant, billing };
  }
  type World = Awaited<ReturnType<typeof world>>;

  /** Une caisse USD ouverte avec un fonds de 20 $, un encaissement en espèces, puis clôturée : retourne la caisse et le montant encaissé. */
  async function closedSession(w: World, counted?: number) {
    const open = await post(w.token, '/v1/admin/cash-sessions', { openingAmount: 20 });
    expect(open.status).toBe(201);
    const pkg = await weighedPackage(t, w, w.customer, w.warehouse.id);
    const draft = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [pkg.packageId] });
    await post(w.token, `/v1/admin/invoices/${draft.body.id}/issue`);
    const amount = Number(draft.body.total);
    const paid = await post(w.token, '/v1/admin/payments/cash', { invoiceId: draft.body.id, amount });
    expect(paid.status).toBe(201);
    const closed = await post(w.token, `/v1/admin/cash-sessions/${open.body.id}/close`, { countedAmount: counted ?? 20 + amount });
    expect(closed.status).toBe(200);
    return { id: open.body.id as string, amount };
  }

  describe('petite caisse', () => {
    it('approvisionnement, dépense, solde par devise, refus d’une dépense au-delà du solde, alerte de solde bas', async () => {
      const w = await world();
      const fund = await post(w.accountant, '/v1/admin/petty-cash', { entryDate: today(), kind: 'FUNDING', description: 'Fonds', amount: 150, currency: 'USD' });
      expect(fund.status).toBe(201);
      expect(fund.body.number).toMatch(/^PC-\d{4}-000001$/);
      expect((await post(w.accountant, '/v1/admin/petty-cash', { entryDate: today(), kind: 'EXPENSE', category: 'TRANSPORT', description: 'Taxi', amount: 12.5, currency: 'USD' })).status).toBe(201);
      const over = await post(w.accountant, '/v1/admin/petty-cash', { entryDate: today(), kind: 'EXPENSE', category: 'FUEL', description: 'Essence', amount: 500, currency: 'USD' });
      expect(over.status).toBe(422);
      expect(errorCode(over)).toBe('PETTY_CASH_INSUFFICIENT');
      expect((await post(w.accountant, '/v1/admin/petty-cash', { entryDate: today(), kind: 'EXPENSE', description: 'Sans catégorie', amount: 1, currency: 'USD' })).status).toBe(400);

      await api(t).put('/v1/admin/petty-cash/thresholds').set(bearer(w.accountant)).send({ thresholds: { USD: 200 } });
      const list = await get(w.accountant, '/v1/admin/petty-cash');
      expect(list.body.balances).toEqual([{ currency: 'USD', balance: '137.50', threshold: 200, low: true }]);
      const daily = await get(w.accountant, `/v1/admin/petty-cash/daily?date=${today()}`);
      expect(daily.body.totals).toEqual([{ currency: 'USD', funding: '150.00', expense: '12.50', balance: '137.50' }]);
    });

    it('réservée : ni la facturation ni un client', async () => {
      const w = await world();
      expect((await get(w.billing, '/v1/admin/petty-cash')).status).toBe(403);
      expect((await get(w.customer.token, '/v1/admin/petty-cash')).status).toBe(403);
      expect((await api(t).get('/v1/admin/petty-cash')).status).toBe(401);
    });
  });

  describe('dépôts bancaires', () => {
    it('dépôt d’une caisse clôturée : attendu = compté − fonds ; écart figé ; caisse non redéposable ; bordereau PDF', async () => {
      const w = await world();
      const s = await closedSession(w);
      const toDeposit = await get(w.accountant, '/v1/admin/deposits/to-deposit');
      expect(toDeposit.body.totals).toEqual([{ currency: 'USD', toDeposit: s.amount.toFixed(2) }]);

      const deposit = await post(w.accountant, '/v1/admin/deposits', { sessionIds: [s.id], depositDate: today(), bank: 'Sogebank', accountLast4: '0123', slipRef: 'BRD-1001', depositedAmount: s.amount - 1 });
      expect(deposit.status).toBe(201);
      expect(deposit.body).toMatchObject({ currency: 'USD', expected: s.amount.toFixed(2), difference: '-1.00', bank: 'Sogebank', accountLast4: '0123' });
      expect(deposit.body.number).toMatch(/^DEP-\d{4}-000001$/);

      const again = await post(w.accountant, '/v1/admin/deposits', { sessionIds: [s.id], depositDate: today(), bank: 'Sogebank', slipRef: 'BRD-1002', depositedAmount: s.amount });
      expect(errorCode(again)).toBe('ALREADY_DEPOSITED');
      expect((await get(w.accountant, '/v1/admin/deposits/to-deposit')).body.totals).toEqual([]);

      const pdf = await get(w.accountant, `/v1/admin/deposits/${deposit.body.id}/slip.pdf`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((await get(w.accountant, '/v1/admin/deposits')).body.items).toHaveLength(1);
    });

    it('refuse une caisse ouverte, un identifiant inconnu, et un numéro de compte complet', async () => {
      const w = await world();
      const open = await post(w.token, '/v1/admin/cash-sessions', { openingAmount: 5 });
      const notClosed = await post(w.accountant, '/v1/admin/deposits', { sessionIds: [open.body.id], depositDate: today(), bank: 'X', slipRef: 'B', depositedAmount: 0 });
      expect(errorCode(notClosed)).toBe('CASH_SESSION_OPEN');
      const unknown = await post(w.accountant, '/v1/admin/deposits', { sessionIds: ['3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11'], depositDate: today(), bank: 'X', slipRef: 'B', depositedAmount: 0 });
      expect(errorCode(unknown)).toBe('CASH_SESSION_NOT_FOUND');
      const full = await post(w.accountant, '/v1/admin/deposits', { sessionIds: [open.body.id], depositDate: today(), bank: 'X', accountLast4: '0123456789', slipRef: 'B', depositedAmount: 0 });
      expect(full.status).toBe(400);
    });

    it('réservé : la facturation ne dépose pas', async () => {
      const w = await world();
      expect((await post(w.billing, '/v1/admin/deposits', { sessionIds: ['3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11'], depositDate: today(), bank: 'X', slipRef: 'B', depositedAmount: 0 })).status).toBe(403);
      expect((await get(w.billing, '/v1/admin/deposits')).status).toBe(403);
    });
  });
});
