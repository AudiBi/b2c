import { v7 as uuidv7 } from 'uuid';
import { activateRateCard, api, bearer, customerIdOf, login, makeAgency, makeCustomer, makeTenant, makeUser, makeWarehouse, weighedPackage, buildTestApp, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;
const today = () => new Date().toISOString().slice(0, 10);

describe('Finance : remboursements et plusieurs devises', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  /** Entreprise avec une grille AÉRIENNE en USD et une grille MARITIME en HTG, une agence, un client, un agent de facturation et un responsable d'agence. */
  async function setup() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token); // AIR, USD : fret 8,00 + manutention 1,50 pour le colis de test
    await activateRateCard(t, tenant.token, {
      name: 'Grille maritime HTG',
      transportMode: 'SEA',
      currency: 'HTG',
      rules: [{ weightFrom: 0, pricePerUnit: 400, flatFee: 0, minCharge: 300 }],
      surcharges: [{ code: 'HANDLING', name: { fr: 'Manutention', ht: 'Manitansyon', en: 'Handling' }, kind: 'SURCHARGE', method: 'FLAT', value: 150, optional: false }],
    });
    const agency = await makeAgency(t, tenant.token);
    const customer = await makeCustomer(t, tenant.company);
    const customerId = await customerIdOf(t, customer);
    const staff = async (roleCode: 'BILLING_AGENT' | 'AGENCY_MANAGER', scope?: { type: 'AGENCY'; id: string }) =>
      (await login(t, await makeUser(t, { company: tenant.company, roleCode, scope }))).accessToken;
    return { ...tenant, warehouse, agency, customer, customerId, billing: await staff('BILLING_AGENT'), manager: await staff('AGENCY_MANAGER', { type: 'AGENCY', id: agency.id }) };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const post = (token: string, path: string, body: Record<string, unknown> = {}) => api(t).post(path).set(bearer(token)).send(body);
  const openCash = (token: string, body: Record<string, unknown> = {}) => post(token, '/v1/admin/cash-sessions', body);
  const cash = (token: string, body: Record<string, unknown>) => post(token, '/v1/admin/payments/cash', body);
  const refund = (token: string, paymentId: string, amount: number, reason = 'Trop perçu') => post(token, `/v1/admin/payments/${paymentId}/refunds`, { amount, reason });
  const invoiceOf = async (w: World, id: string) => (await api(t).get(`/v1/admin/invoices/${id}`).set(bearer(w.token))).body;

  /** Facture ÉMISE pour un colis pesé : AIR → USD (9,50), SEA → HTG. */
  async function issued(w: World, mode: 'AIR' | 'SEA' = 'AIR') {
    const pkg = await weighedPackage(t, w, w.customer, w.warehouse.id, { transportMode: mode });
    const draft = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [pkg.packageId] });
    expect(draft.status).toBe(201);
    const res = await post(w.token, `/v1/admin/invoices/${draft.body.id}/issue`);
    expect(res.status).toBe(200);
    return { invoice: res.body as { id: string; total: string; currency: string }, pkg };
  }

  /** Facture USD payée en espèces par la facturation (caisse de l'entreprise ouverte). */
  async function paidCash(w: World, amount?: number) {
    const { invoice } = await issued(w);
    const paid = await cash(w.billing, { invoiceId: invoice.id, amount: amount ?? Number(invoice.total) });
    expect(paid.status).toBe(201);
    return { invoice, paymentId: paid.body.payment.id as string };
  }

  // =============================================================================================
  describe('remboursements', () => {
    it('partiel puis complet : statut du paiement, solde de la facture, plus rien à rembourser ensuite', async () => {
      const w = await setup();
      expect((await openCash(w.billing)).status).toBe(201);
      const { invoice, paymentId } = await paidCash(w);
      expect(await invoiceOf(w, invoice.id)).toMatchObject({ status: 'PAID', paidTotal: '9.50', balance: '0.00' });

      const first = await refund(w.billing, paymentId, 4);
      expect(first.status).toBe(201);
      expect(first.body.payment).toMatchObject({ status: 'REFUNDED_PARTIAL', refundedTotal: '4.00' });
      expect(await invoiceOf(w, invoice.id)).toMatchObject({ status: 'PARTIALLY_PAID', paidTotal: '5.50', balance: '4.00' });

      const second = await refund(w.billing, paymentId, 5.5);
      expect(second.status).toBe(201);
      expect(second.body.payment).toMatchObject({ status: 'REFUNDED', refundedTotal: '9.50' });
      expect(await invoiceOf(w, invoice.id)).toMatchObject({ status: 'ISSUED', paidTotal: '0.00', balance: '9.50' }); // la facture redevient à payer

      const again = await refund(w.billing, paymentId, 0.5);
      expect([again.status, errorCode(again)]).toEqual([409, 'PAYMENT_NOT_REFUNDABLE']);
    });

    it('au-delà du montant remboursable : 422 avec le reste remboursable, rien n’est enregistré', async () => {
      const w = await setup();
      await openCash(w.billing);
      const { invoice, paymentId } = await paidCash(w);
      expect((await refund(w.billing, paymentId, 3)).status).toBe(201);
      const tooMuch = await refund(w.billing, paymentId, 6.51);
      expect([tooMuch.status, errorCode(tooMuch)]).toEqual([422, 'REFUND_EXCEEDS_PAYMENT']);
      expect(tooMuch.body.error.details).toMatchObject({ refundable: '6.50' });
      expect(await t.admin.refund.count({ where: { paymentId } })).toBe(1);
      expect(await invoiceOf(w, invoice.id)).toMatchObject({ paidTotal: '6.50' });
    });

    it('validation : montant nul, négatif ou à 3 décimales, motif absent ou vide, champ inconnu → 400 ; paiement inconnu → 404', async () => {
      const w = await setup();
      await openCash(w.billing);
      const { paymentId } = await paidCash(w);
      for (const body of [{ amount: 0, reason: 'x' }, { amount: -1, reason: 'x' }, { amount: 1.005, reason: 'x' }, { amount: 1 }, { amount: 1, reason: '' }, { amount: 1, reason: 'x', surprise: true }]) {
        const res = await post(w.billing, `/v1/admin/payments/${paymentId}/refunds`, body);
        expect([res.status, errorCode(res)]).toEqual([400, 'VALIDATION_ERROR']);
      }
      expect((await refund(w.billing, uuidv7(), 1)).status).toBe(404);
      expect(await t.admin.refund.count({ where: { paymentId } })).toBe(0);
    });

    it('4 remboursements simultanés du montant total : un seul passe, jamais de sur-remboursement', async () => {
      const w = await setup();
      await openCash(w.billing);
      const { invoice, paymentId } = await paidCash(w);
      const results = await Promise.all(Array.from({ length: 4 }, () => refund(w.billing, paymentId, 9.5)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => [409, 422].includes(r.status))).toHaveLength(3);
      expect(await t.admin.refund.count({ where: { paymentId } })).toBe(1);
      expect(await invoiceOf(w, invoice.id)).toMatchObject({ paidTotal: '0.00', balance: '9.50' });
    });

    it('le paiement d’une autre entreprise reste introuvable (404) ; seuls la facturation et l’administrateur remboursent', async () => {
      const w = await setup();
      const other = await setup();
      await openCash(w.billing);
      const { paymentId } = await paidCash(w);
      expect((await refund(other.billing, paymentId, 1)).status).toBe(404);
      expect((await refund(w.manager, paymentId, 1)).status).toBe(403); // le responsable d'agence encaisse mais ne rembourse pas
      expect((await refund(w.token, paymentId, 1)).status).toBe(201); // l'administrateur de l'entreprise le peut
    });

    it('journal d’audit et export comptable : le remboursement est tracé, en négatif, avec sa devise', async () => {
      const w = await setup();
      await openCash(w.billing);
      const { paymentId } = await paidCash(w);
      expect((await refund(w.billing, paymentId, 2, 'Colis annulé')).status).toBe(201);
      const audit = await t.admin.auditLog.findMany({ where: { companyId: w.company.id, action: 'payment.refunded' } });
      expect(audit).toHaveLength(1);
      expect((audit[0].after as any)).toMatchObject({ amount: '2.00', reason: 'Colis annulé' });
      const csv = (await api(t).get(`/v1/admin/finance/export.csv?from=${today()}&to=${today()}`).set(bearer(w.billing))).text;
      const line = csv.split('\n').find((l) => l.includes('REMBOURSEMENT'));
      expect(line).toBeDefined();
      expect(line).toContain('USD');
      expect(line).toContain('-2.00');
    });
  });

  // =============================================================================================
  describe('plusieurs devises', () => {
    it('une facture ne mélange pas les devises : colis USD + colis HTG → 409 CURRENCY_MISMATCH', async () => {
      const w = await setup();
      const air = await weighedPackage(t, w, w.customer, w.warehouse.id, { transportMode: 'AIR' });
      const sea = await weighedPackage(t, w, w.customer, w.warehouse.id, { transportMode: 'SEA' });
      const res = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [air.packageId, sea.packageId] });
      expect([res.status, errorCode(res)]).toEqual([409, 'CURRENCY_MISMATCH']);
      expect((res.body.error.details.currencies as string[]).sort()).toEqual(['HTG', 'USD']);
    });

    it('un même client a une facture par devise ; le paiement et le remboursement gardent la devise de leur facture', async () => {
      const w = await setup();
      await openCash(w.billing); // caisse USD (devise par défaut)
      await openCash(w.billing, { currency: 'HTG' }); // une caisse par devise
      const usd = await issued(w, 'AIR');
      const htg = await issued(w, 'SEA');
      expect([usd.invoice.currency, htg.invoice.currency]).toEqual(['USD', 'HTG']);
      expect(Number(htg.invoice.total)).toBeGreaterThan(Number(usd.invoice.total)); // 950 HTG contre 9,50 USD : jamais convertis l'un en l'autre

      const payUsd = await cash(w.billing, { invoiceId: usd.invoice.id, amount: Number(usd.invoice.total) });
      const payHtg = await cash(w.billing, { invoiceId: htg.invoice.id, amount: Number(htg.invoice.total) });
      expect([payUsd.body.payment.currency, payHtg.body.payment.currency]).toEqual(['USD', 'HTG']);
      expect((await refund(w.billing, payHtg.body.payment.id, 100)).status).toBe(201);
      expect(await t.admin.payment.findUniqueOrThrow({ where: { id: payHtg.body.payment.id } })).toMatchObject({ currency: 'HTG' });

      // Un montant d'une devise ne règle pas une facture de l'autre : l'excédent est refusé, pas converti
      const tooBig = await cash(w.billing, { invoiceId: usd.invoice.id, amount: 1 });
      expect(tooBig.status).toBe(409); // facture USD déjà réglée
    });

    it('la synthèse de rapprochement sépare les devises (jamais de total mélangé) et l’export porte la devise de chaque ligne', async () => {
      const w = await setup();
      await openCash(w.billing); // caisse USD (devise par défaut)
      await openCash(w.billing, { currency: 'HTG' }); // une caisse par devise
      const usd = await issued(w, 'AIR');
      const htg = await issued(w, 'SEA');
      await cash(w.billing, { invoiceId: usd.invoice.id, amount: Number(usd.invoice.total) });
      const payHtg = await cash(w.billing, { invoiceId: htg.invoice.id, amount: Number(htg.invoice.total) });
      await refund(w.billing, payHtg.body.payment.id, 50);

      const summary = (await api(t).get(`/v1/admin/finance/summary?from=${today()}&to=${today()}`).set(bearer(w.billing))).body;
      const cashRows = (summary.confirmed as { method: string; currency: string; collected: string; refunded: string; net: string }[]).filter((r) => r.method === 'CASH');
      expect(cashRows.map((r) => r.currency).sort()).toEqual(['HTG', 'USD']);
      expect(cashRows.find((r) => r.currency === 'USD')).toMatchObject({ collected: '9.50', refunded: '0.00', net: '9.50' });
      const hrow = cashRows.find((r) => r.currency === 'HTG')!;
      expect([hrow.collected, hrow.refunded, hrow.net]).toEqual([Number(htg.invoice.total).toFixed(2), '50.00', (Number(htg.invoice.total) - 50).toFixed(2)]);

      const csv = (await api(t).get(`/v1/admin/finance/export.csv?from=${today()}&to=${today()}`).set(bearer(w.billing))).text;
      for (const kind of ['FACTURE', 'PAIEMENT']) {
        const lines = csv.split('\n').filter((l) => l.includes(kind));
        expect(lines.some((l) => l.includes('USD'))).toBe(true);
        expect(lines.some((l) => l.includes('HTG'))).toBe(true);
      }
    });

    it('le solde dû d’un colis ne peut pas mélanger deux devises : un colis ne se facture qu’une fois (ALREADY_INVOICED), même dans une autre devise', async () => {
      const w = await setup();
      const { pkg } = await issued(w, 'SEA');
      const again = await post(w.token, '/v1/admin/invoices', { customerId: w.customerId, packageIds: [pkg.packageId] });
      expect([again.status, errorCode(again)]).toEqual([409, 'ALREADY_INVOICED']);
    });

    // Corrigé (docs/RISKS.md B6) : une caisse a UNE devise. L'encaissement entre dans la caisse ouverte de la devise de la facture ;
    // sans caisse dans cette devise il est refusé ; une agence qui encaisse deux devises ouvre deux caisses ; chaque clôture reste dans sa devise.
    it('une caisse a une devise : l’encaissement va dans la caisse de la devise de la facture, jamais dans une autre ; chaque clôture reste dans sa devise', async () => {
      const w = await setup();
      const usd = await issued(w, 'AIR');
      const htg = await issued(w, 'SEA');
      const body = (invoice: { id: string; total: string }) => ({ invoiceId: invoice.id, amount: Number(invoice.total), agencyId: w.agency.id });

      // Caisse USD seule (devise par défaut de l'entreprise) : l'encaissement en gourdes est refusé, rien n'est enregistré
      const usdSession = await openCash(w.manager, { agencyId: w.agency.id });
      expect([usdSession.status, usdSession.body.currency]).toEqual([201, 'USD']);
      const refused = await cash(w.manager, body(htg.invoice));
      expect([refused.status, errorCode(refused)]).toEqual([409, 'CASH_SESSION_REQUIRED']);
      expect(refused.body.error.details).toMatchObject({ currency: 'HTG' });
      expect(await t.admin.payment.count({ where: { invoiceId: htg.invoice.id } })).toBe(0);

      // Une seule caisse ouverte par devise ; une caisse HTG s'ouvre à côté de la caisse USD
      const again = await openCash(w.manager, { agencyId: w.agency.id, currency: 'USD' });
      expect([again.status, errorCode(again)]).toEqual([409, 'CASH_SESSION_OPEN']);
      const htgSession = await openCash(w.manager, { agencyId: w.agency.id, currency: 'HTG', openingAmount: 100 });
      expect([htgSession.status, htgSession.body.currency]).toEqual([201, 'HTG']);

      // Chaque encaissement entre dans la caisse de sa devise
      const payUsd = await cash(w.manager, body(usd.invoice));
      const payHtg = await cash(w.manager, body(htg.invoice));
      expect([payUsd.status, payHtg.status]).toEqual([201, 201]);
      expect((await t.admin.payment.findUniqueOrThrow({ where: { id: payUsd.body.payment.id } })).cashSessionId).toBe(usdSession.body.id);
      expect((await t.admin.payment.findUniqueOrThrow({ where: { id: payHtg.body.payment.id } })).cashSessionId).toBe(htgSession.body.id);

      // Un remboursement en gourdes ne touche que la caisse HTG
      expect((await refund(w.billing, payHtg.body.payment.id, 50)).status).toBe(201);

      // Clôtures : attendu = fond + espèces − remboursements, dans la devise de la caisse
      const closedUsd = await post(w.manager, `/v1/admin/cash-sessions/${usdSession.body.id}/close`, { countedAmount: 9.5 });
      expect(closedUsd.body).toMatchObject({ currency: 'USD', expectedAmount: '9.50', difference: '0.00' });
      const closedHtg = await post(w.manager, `/v1/admin/cash-sessions/${htgSession.body.id}/close`, { countedAmount: 100 + Number(htg.invoice.total) - 50 });
      expect(closedHtg.body).toMatchObject({ currency: 'HTG', expectedAmount: (100 + Number(htg.invoice.total) - 50).toFixed(2), difference: '0.00' });
    });

    it('devise de la caisse : valeur inconnue refusée (400), devise par défaut de l’entreprise sinon', async () => {
      const w = await setup();
      const bad = await openCash(w.billing, { currency: 'XYZ' });
      expect([bad.status, errorCode(bad)]).toEqual([400, 'VALIDATION_ERROR']);
      await t.admin.company.update({ where: { id: w.company.id }, data: { defaultCurrency: 'HTG' } });
      expect((await openCash(w.billing)).body.currency).toBe('HTG');
    });
  });
});
