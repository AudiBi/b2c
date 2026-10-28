import { v7 as uuidv7 } from 'uuid';
import {
  activateRateCard,
  api,
  bearer,
  buildTestApp,
  customerIdOf,
  login,
  makeAgency,
  makeCustomer,
  makeTenant,
  makeUser,
  makeWarehouse,
  weighedPackage,
  type CustomerSession,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;
const YEAR = new Date().getUTCFullYear();

describe('Finance : factures, paiements, caisse, remboursements, export', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  async function setup(options: { rateCard?: boolean; policy?: 'PAY_BEFORE_SHIPMENT' | 'PAY_BEFORE_RELEASE' } = {}) {
    const tenant = await makeTenant(t);
    if (options.policy) await t.admin.company.update({ where: { id: tenant.company.id }, data: { paymentPolicy: options.policy } });
    const w1 = await makeWarehouse(t, tenant.token);
    if (options.rateCard !== false) await activateRateCard(t, tenant.token);
    const agency = await makeAgency(t, tenant.token);
    const customer1 = await makeCustomer(t, tenant.company);
    const customer2 = await makeCustomer(t, tenant.company);
    const staff = async (roleCode: 'BILLING_AGENT' | 'AGENCY_MANAGER' | 'CUSTOMER_SERVICE' | 'LOGISTICS_MANAGER', scope?: { type: 'AGENCY'; id: string }) => {
      const user = await makeUser(t, { company: tenant.company, roleCode, scope });
      return (await login(t, user)).accessToken;
    };
    return { ...tenant, w1, agency, customer1, customer2, staff, c1: await customerIdOf(t, customer1), c2: await customerIdOf(t, customer2) };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const draft = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/invoices').set(bearer(token)).send(body);
  const issue = (token: string, id: string) => api(t).post(`/v1/admin/invoices/${id}/issue`).set(bearer(token));
  const getInvoice = (token: string, id: string) => api(t).get(`/v1/admin/invoices/${id}`).set(bearer(token));
  const openCash = (token: string, body: Record<string, unknown> = {}) => api(t).post('/v1/admin/cash-sessions').set(bearer(token)).send(body);
  const cash = (token: string, body: Record<string, unknown>, key?: string) => {
    const req = api(t).post('/v1/admin/payments/cash').set(bearer(token));
    return (key ? req.set('Idempotency-Key', key) : req).send(body);
  };
  const pkgStatus = async (id: string) => (await t.admin.package.findUniqueOrThrow({ where: { id } })).status;

  /** Facture ÉMISE de 9,50 USD (fret 8,00 + manutention 1,50) pour un colis pesé du client. */
  async function issuedInvoice(w: World, customer: CustomerSession = w.customer1, customerId = w.c1) {
    const pkg = await weighedPackage(t, w, customer, w.w1.id);
    const created = await draft(w.token, { customerId, packageIds: [pkg.packageId] });
    expect(created.status).toBe(201);
    const issued = await issue(w.token, created.body.id);
    expect(issued.status).toBe(200);
    return { invoice: issued.body as any, pkg };
  }

  // =============================================================================================
  describe('brouillon', () => {
    it('reprend les frais calculés à la pesée : fret et manutention, total exact, aucun numéro, colis réservé', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const res = await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId], notes: 'Test' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'DRAFT', number: null, currency: 'USD', subtotal: '9.50', discountTotal: '0.00', taxTotal: '0.00', total: '9.50', balance: '9.50', paidTotal: '0.00' });
      expect(res.body.lines.map((l: any) => [l.kind, l.amount])).toEqual([['FREIGHT', '8.00'], ['HANDLING', '1.50']]);
      expect(res.body.lines[0].description).toContain('Fret');
      expect(res.body.customer.customerCode).toBe(w.customer1.customerCode);
      expect(await t.admin.invoicePackage.count({ where: { packageId: pkg.packageId } })).toBe(1);
      expect(await pkgStatus(pkg.packageId)).toBe('REGISTERED_WEIGHED'); // rien ne bouge avant l'émission
    });

    it('un colis n’est facturé qu’une fois ; 3 brouillons simultanés sur le même colis : un seul gagne', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const results = await Promise.all(Array.from({ length: 3 }, () => draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409).every((r) => errorCode(r) === 'ALREADY_INVOICED')).toBe(true);
    });

    it('refuse : facture vide, colis d’un autre client, colis non pesé, colis introuvable, doublons, champs inconnus', async () => {
      const w = await setup();
      const mine = await weighedPackage(t, w, w.customer1, w.w1.id);
      const waiting = await (await import('./helpers')).makePrealert(t, w.customer1, w.w1.id);
      expect((await draft(w.token, { customerId: w.c1 })).status).toBe(400);
      expect(errorCode(await draft(w.token, { customerId: w.c2, packageIds: [mine.packageId] }))).toBe('PACKAGE_CUSTOMER_MISMATCH');
      const notBillable = await draft(w.token, { customerId: w.c1, packageIds: [waiting.package.id] });
      expect(errorCode(notBillable)).toBe('PACKAGE_NOT_BILLABLE');
      expect((await draft(w.token, { customerId: w.c1, packageIds: [uuidv7()] })).status).toBe(404);
      expect((await draft(w.token, { customerId: uuidv7(), packageIds: [mine.packageId] })).status).toBe(404);
      expect((await draft(w.token, { customerId: w.c1, packageIds: [mine.packageId, mine.packageId] })).status).toBe(400);
      expect((await draft(w.token, { customerId: w.c1, packageIds: [mine.packageId], surprise: 1 })).status).toBe(400);
    });

    it('sans tarif calculé : le fret doit être saisi, jamais inventé ; lignes libres contrôlées', async () => {
      const w = await setup({ rateCard: false });
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const refused = await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] });
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('PACKAGE_NOT_PRICED');
      const ok = await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId], extraLines: [{ kind: 'FREIGHT', description: 'Fret convenu', amount: 12.5, packageId: pkg.packageId }, { kind: 'CUSTOMS', description: 'Droits', amount: 3 }] });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ subtotal: '15.50', total: '15.50' });
      for (const bad of [{ kind: 'DISCOUNT' }, { kind: 'TAX' }, { amount: 0 }, { amount: 1.234 }]) {
        expect((await draft(w.token, { customerId: w.c1, extraLines: [{ kind: 'OTHER', description: 'x', amount: 1, ...bad }] })).status).toBe(400);
      }
      const unknown = await draft(w.token, { customerId: w.c1, extraLines: [{ kind: 'FREIGHT', description: 'x', amount: 1, packageId: uuidv7() }] });
      expect(errorCode(unknown)).toBe('EXTRA_LINE_PACKAGE_UNKNOWN');
    });

    it('un colis déjà tarifé n’accepte pas de fret saisi à la main', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const res = await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId], extraLines: [{ kind: 'FREIGHT', description: 'Autre fret', amount: 1, packageId: pkg.packageId }] });
      expect(errorCode(res)).toBe('PACKAGE_ALREADY_PRICED');
    });

    it('remise : plafonnée (10 % par défaut), modifiable par l’entreprise, calculée en décimal exact', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const above = await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId], discountPercent: 11 });
      expect(above.status).toBe(422);
      expect(errorCode(above)).toBe('DISCOUNT_ABOVE_CAP');
      const ok = await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId], discountPercent: 10 });
      expect(ok.body).toMatchObject({ subtotal: '9.50', discountTotal: '0.95', total: '8.55', discountPercent: '10.00' });
      expect(ok.body.lines[ok.body.lines.length - 1]).toMatchObject({ kind: 'DISCOUNT', amount: '-0.95' });
      await api(t).delete(`/v1/admin/invoices/${ok.body.id}`).set(bearer(w.token));

      expect((await api(t).get('/v1/admin/settings/finance').set(bearer(w.token))).body).toEqual({ maxDiscountPercent: 10, paymentInstructions: null });
      await api(t).put('/v1/admin/settings/finance').set(bearer(w.token)).send({ maxDiscountPercent: 20 });
      // modifier un champ ne remet pas l'autre à sa valeur par défaut
      const kept = await api(t).put('/v1/admin/settings/finance').set(bearer(w.token)).send({ paymentInstructions: 'Virement au compte X' });
      expect(kept.body).toEqual({ maxDiscountPercent: 20, paymentInstructions: 'Virement au compte X' });
      expect((await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId], discountPercent: 15 })).status).toBe(201);
      expect((await api(t).put('/v1/admin/settings/finance').set(bearer(w.token)).send({})).status).toBe(400);
    });

    it('un brouillon se supprime et libère ses colis', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const created = (await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] })).body;
      expect((await api(t).delete(`/v1/admin/invoices/${created.id}`).set(bearer(w.token))).status).toBe(204);
      expect((await getInvoice(w.token, created.id)).status).toBe(404);
      expect((await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] })).status).toBe(201);
    });
  });

  // =============================================================================================
  describe('émission', () => {
    it('attribue un numéro, passe le colis « en attente de paiement » et prévient le client', async () => {
      const w = await setup();
      const { invoice, pkg } = await issuedInvoice(w);
      expect(invoice).toMatchObject({ number: `INV-${YEAR}-000001`, status: 'ISSUED', total: '9.50', balance: '9.50' });
      expect(invoice.issuedAt).toBeTruthy();
      expect(await pkgStatus(pkg.packageId)).toBe('AWAITING_PAYMENT');
      const events = await t.admin.outboxEvent.findMany({ where: { companyId: w.company.id, eventCode: 'payment.required' } });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ invoiceNumber: invoice.number, amount: '9.50', currency: 'USD' });
      expect((await issue(w.token, invoice.id)).status).toBe(409);
    });

    it('numérotation sans trou ni doublon : 4 émissions simultanées → 1, 2, 3, 4', async () => {
      const w = await setup();
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
        ids.push((await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] })).body.id);
      }
      const results = await Promise.all(ids.map((id) => issue(w.token, id)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.map((r) => Number(r.body.number.split('-')[2])).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    });

    it('la numérotation est propre à chaque entreprise', async () => {
      const a = await setup();
      const b = await setup();
      expect((await issuedInvoice(a)).invoice.number).toBe(`INV-${YEAR}-000001`);
      expect((await issuedInvoice(b)).invoice.number).toBe(`INV-${YEAR}-000001`);
    });

    it('politique « paiement à la remise » : le colis est prêt à partir dès l’émission', async () => {
      const w = await setup({ policy: 'PAY_BEFORE_RELEASE' });
      const { pkg } = await issuedInvoice(w);
      expect(await pkgStatus(pkg.packageId)).toBe('READY_TO_SHIP');
    });

    it('un colis devenu non facturable entre le brouillon et l’émission bloque l’émission', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const created = (await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] })).body;
      await api(t).post(`/v1/admin/packages/${pkg.packageId}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Vérification', holdReasonCode: 'OTHER' });
      const refused = await issue(w.token, created.id);
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('PACKAGE_NOT_BILLABLE');
      expect((await getInvoice(w.token, created.id)).body.status).toBe('DRAFT');
    });
  });

  // =============================================================================================
  describe('annulation et avoirs', () => {
    it('annule une facture non encaissée : ses colis redeviennent facturables', async () => {
      const w = await setup();
      const { invoice, pkg } = await issuedInvoice(w);
      const voided = await api(t).post(`/v1/admin/invoices/${invoice.id}/void`).set(bearer(w.token)).send({ reason: 'Erreur de client' });
      expect(voided.status).toBe(200);
      expect(voided.body).toMatchObject({ status: 'VOID', voidReason: 'Erreur de client' });
      expect((await api(t).post(`/v1/admin/invoices/${invoice.id}/void`).set(bearer(w.token)).send({ reason: 'x' })).status).toBe(409);
      // le colis (resté en attente de paiement) peut être refacturé
      const again = await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] });
      expect(again.status).toBe(201);
      expect((await api(t).post(`/v1/admin/invoices/${invoice.id}/void`).set(bearer(w.token)).send({})).status).toBe(400);
    });

    it('un brouillon ne s’annule pas, une facture encaissée ou avec paiement en attente non plus', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const d = (await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] })).body;
      expect(errorCode(await api(t).post(`/v1/admin/invoices/${d.id}/void`).set(bearer(w.token)).send({ reason: 'x' }))).toBe('INVOICE_IS_DRAFT');
      expect(errorCode(await api(t).delete(`/v1/admin/invoices/${(await issue(w.token, d.id)).body.id}`).set(bearer(w.token)))).toBe('INVOICE_NOT_DRAFT');

      const { invoice } = await issuedInvoice(w, w.customer2, w.c2);
      await api(t).post(`/v1/me/invoices/${invoice.id}/payments`).set(bearer(w.customer2.token)).send({ method: 'BANK_TRANSFER', amount: 2, reference: 'VIR-VOID-001' });
      expect(errorCode(await api(t).post(`/v1/admin/invoices/${invoice.id}/void`).set(bearer(w.token)).send({ reason: 'x' }))).toBe('INVOICE_HAS_PAYMENTS');
    });

    it('avoir : réduit le dû, numéroté, limité à ce qui n’est pas encaissé ; avoir total → facture créditée', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      const credit = (amount: number) => api(t).post(`/v1/admin/invoices/${invoice.id}/credit-notes`).set(bearer(w.token)).send({ amount, reason: 'Geste commercial' });
      const first = await credit(2.5);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ creditedTotal: '2.50', balance: '7.00', status: 'ISSUED' });
      expect(first.body.credits[0].number).toBe(`CN-${YEAR}-000001`);
      const tooMuch = await credit(7.01);
      expect(tooMuch.status).toBe(422);
      expect(errorCode(tooMuch)).toBe('CREDIT_EXCEEDS_UNPAID');
      const full = await credit(7);
      expect(full.body).toMatchObject({ status: 'CREDITED', balance: '0.00' });
      expect(full.body.credits.map((c: any) => c.number)).toEqual([`CN-${YEAR}-000001`, `CN-${YEAR}-000002`]);
      expect((await credit(1)).status).toBe(409);
    });

    it('un avoir ne dépasse pas ce qui est déjà encaissé ou réservé', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      await cash(w.token, { invoiceId: invoice.id, amount: 6 });
      const res = await api(t).post(`/v1/admin/invoices/${invoice.id}/credit-notes`).set(bearer(w.token)).send({ amount: 4, reason: 'x' });
      expect(errorCode(res)).toBe('CREDIT_EXCEEDS_UNPAID');
      expect(res.body.error.details.available).toBe('3.50');
    });

    it('la base refuse de modifier une facture émise, ses lignes, ou de la supprimer', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await expect(t.admin.invoice.update({ where: { id: invoice.id }, data: { total: 1, subtotal: 1 } })).rejects.toThrow(/immuable/);
      await expect(t.admin.invoice.update({ where: { id: invoice.id }, data: { status: 'DRAFT', number: null, issuedAt: null } })).rejects.toThrow();
      await expect(t.admin.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow(/ne se supprime pas/);
      const line = await t.admin.invoiceLine.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      await expect(t.admin.invoiceLine.update({ where: { id: line.id }, data: { amount: 0 } })).rejects.toThrow(/immuables/);
      await expect(t.admin.invoiceLine.delete({ where: { id: line.id } })).rejects.toThrow(/immuables/);
      const credit = await api(t).post(`/v1/admin/invoices/${invoice.id}/credit-notes`).set(bearer(w.token)).send({ amount: 1, reason: 'x' });
      const note = await t.admin.creditNote.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(credit.status).toBe(201);
      await expect(t.admin.creditNote.update({ where: { id: note.id }, data: { amount: 5 } })).rejects.toThrow(/ajout seul/);
      await api(t).post(`/v1/admin/invoices/${invoice.id}/void`).set(bearer(w.token)).send({ reason: 'x' });
      const other = await issuedInvoice(w);
      await api(t).post(`/v1/admin/invoices/${other.invoice.id}/void`).set(bearer(w.token)).send({ reason: 'x' });
      await expect(t.admin.invoice.update({ where: { id: other.invoice.id }, data: { notes: 'après annulation' } })).rejects.toThrow(/annulée/);
    });
  });

  // =============================================================================================
  describe('espèces et caisse', () => {
    it('exige une caisse ouverte ; encaisse en deux fois ; reçus numérotés ; facture réglée → colis prêt à partir', async () => {
      const w = await setup();
      const { invoice, pkg } = await issuedInvoice(w);
      const noCash = await cash(w.token, { invoiceId: invoice.id, amount: 5 });
      expect(noCash.status).toBe(409);
      expect(errorCode(noCash)).toBe('CASH_SESSION_REQUIRED');

      expect((await openCash(w.token, { openingAmount: 100 })).status).toBe(201);
      const first = await cash(w.token, { invoiceId: invoice.id, amount: 5, reference: 'BORD-0001' });
      expect(first.status).toBe(201);
      expect(first.body.receiptNumber).toBe(`RCT-${YEAR}-000001`);
      expect(first.body.payment).toMatchObject({ method: 'CASH', status: 'CONFIRMED', amount: '5.00', currency: 'USD' });
      expect((await getInvoice(w.token, invoice.id)).body).toMatchObject({ status: 'PARTIALLY_PAID', paidTotal: '5.00', balance: '4.50' });
      expect(await pkgStatus(pkg.packageId)).toBe('AWAITING_PAYMENT');

      const second = await cash(w.token, { invoiceId: invoice.id, amount: 4.5 });
      expect(second.body.receiptNumber).toBe(`RCT-${YEAR}-000002`);
      const paid = (await getInvoice(w.token, invoice.id)).body;
      expect(paid).toMatchObject({ status: 'PAID', paidTotal: '9.50', balance: '0.00' });
      expect(await pkgStatus(pkg.packageId)).toBe('READY_TO_SHIP');
      const events = await t.admin.packageEvent.findMany({ where: { packageId: pkg.packageId, toStatus: 'READY_TO_SHIP' } });
      expect(events[0].reason).toContain(invoice.number);
      // facture réglée : plus de paiement
      expect(errorCode(await cash(w.token, { invoiceId: invoice.id, amount: 1 }))).toBe('INVOICE_NOT_PAYABLE');
    });

    it('refuse un montant au-delà du solde, un brouillon, une facture inconnue, des données invalides', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const over = await cash(w.token, { invoiceId: invoice.id, amount: 9.51 });
      expect(over.status).toBe(422);
      expect(errorCode(over)).toBe('AMOUNT_EXCEEDS_BALANCE');
      expect(over.body.error.details.available).toBe('9.50');
      const pkg = await weighedPackage(t, w, w.customer2, w.w1.id);
      const d = (await draft(w.token, { customerId: w.c2, packageIds: [pkg.packageId] })).body;
      expect(errorCode(await cash(w.token, { invoiceId: d.id, amount: 1 }))).toBe('INVOICE_NOT_PAYABLE');
      expect((await cash(w.token, { invoiceId: uuidv7(), amount: 1 })).status).toBe(404);
      for (const bad of [{ amount: 0 }, { amount: -1 }, { amount: 1.234 }, { reference: 'x' }, { extra: 1 }]) {
        expect((await cash(w.token, { invoiceId: invoice.id, amount: 1, ...bad })).status).toBe(400);
      }
    });

    it('Idempotency-Key : une requête rejouée ne double pas l’encaissement ; une clé réutilisée avec un autre contenu est refusée', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const key = 'cle-idempotence-0001';
      const first = await cash(w.token, { invoiceId: invoice.id, amount: 3 }, key);
      const replay = await cash(w.token, { invoiceId: invoice.id, amount: 3 }, key);
      expect([first.status, replay.status]).toEqual([201, 201]);
      expect(replay.body.payment.id).toBe(first.body.payment.id);
      expect(replay.body.replayed).toBe(true);
      expect(await t.admin.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect(errorCode(await cash(w.token, { invoiceId: invoice.id, amount: 4 }, key))).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await cash(w.token, { invoiceId: invoice.id, amount: 1 }, 'court')).status).toBe(400);
    });

    it('4 encaissements simultanés du montant total : un seul passe, jamais de surpaiement', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const results = await Promise.all(Array.from({ length: 4 }, () => cash(w.token, { invoiceId: invoice.id, amount: 9.5 })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => [409, 422].includes(r.status))).toHaveLength(3);
      expect((await getInvoice(w.token, invoice.id)).body).toMatchObject({ status: 'PAID', paidTotal: '9.50' });
      expect(await t.admin.receipt.count({ where: { companyId: w.company.id } })).toBe(1);
    });

    it('droits par agence : l’encaissement et la caisse d’une agence ne sont permis qu’à son responsable', async () => {
      const w = await setup();
      const other = await makeAgency(t, w.token);
      const manager = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const { invoice } = await issuedInvoice(w);
      expect((await openCash(manager, {})).status).toBe(403); // caisse de l'entreprise : droit d'entreprise
      expect((await openCash(manager, { agencyId: other.id })).status).toBe(403);
      expect((await openCash(manager, { agencyId: w.agency.id, openingAmount: 20 })).status).toBe(201);
      expect(errorCode(await openCash(manager, { agencyId: w.agency.id }))).toBe('CASH_SESSION_OPEN');
      expect((await cash(manager, { invoiceId: invoice.id, amount: 2, agencyId: other.id })).status).toBe(403);
      expect((await cash(manager, { invoiceId: invoice.id, amount: 2 })).status).toBe(403);
      expect((await cash(manager, { invoiceId: invoice.id, amount: 2, agencyId: w.agency.id })).status).toBe(201);
      // le service client ne manipule pas d'argent ; le client non plus
      expect((await cash(await w.staff('CUSTOMER_SERVICE'), { invoiceId: invoice.id, amount: 1 })).status).toBe(403);
      expect((await cash(w.customer1.token, { invoiceId: invoice.id, amount: 1 })).status).toBe(403);
      expect((await api(t).post('/v1/admin/payments/cash').send({ invoiceId: invoice.id, amount: 1 })).status).toBe(401);
    });

    it('clôture : attendu = fond + espèces − remboursements ; écart ; une caisse close ne change plus', async () => {
      const w = await setup();
      const manager = await w.staff('AGENCY_MANAGER', { type: 'AGENCY', id: w.agency.id });
      const { invoice } = await issuedInvoice(w);
      const session = (await openCash(manager, { agencyId: w.agency.id, openingAmount: 20 })).body;
      const paid = await cash(manager, { invoiceId: invoice.id, amount: 9.5, agencyId: w.agency.id });
      const billing = await w.staff('BILLING_AGENT');
      const refund = await api(t).post(`/v1/admin/payments/${paid.body.payment.id}/refunds`).set(bearer(billing)).send({ amount: 1.5, reason: 'Trop perçu' });
      expect(refund.status).toBe(201);
      const closed = await api(t).post(`/v1/admin/cash-sessions/${session.id}/close`).set(bearer(manager)).send({ countedAmount: 27.5 });
      expect(closed.status).toBe(200);
      // 20 + 9,50 − 1,50 = 28,00 attendus ; 27,50 comptés
      expect(closed.body).toMatchObject({ expectedAmount: '28.00', countedAmount: '27.50', difference: '-0.50' });
      expect(errorCode(await api(t).post(`/v1/admin/cash-sessions/${session.id}/close`).set(bearer(manager)).send({ countedAmount: 1 }))).toBe('CASH_SESSION_CLOSED');
      await expect(t.admin.cashSession.update({ where: { id: session.id }, data: { openingAmount: 0 } })).rejects.toThrow(/clôturée/);
      // une nouvelle caisse peut s'ouvrir
      expect((await openCash(manager, { agencyId: w.agency.id })).status).toBe(201);
      expect((await api(t).get('/v1/admin/cash-sessions').set(bearer(manager))).body.items).toHaveLength(2);
    });
  });

  // =============================================================================================
  describe('virement ou mobile déclaré par le client', () => {
    const declare = (token: string, invoiceId: string, body: Record<string, unknown>) => api(t).post(`/v1/me/invoices/${invoiceId}/payments`).set(bearer(token)).send(body);

    it('le client déclare, le paiement reste EN ATTENTE ; le personnel valide : reçu, facture réglée, colis libéré', async () => {
      const w = await setup();
      const { invoice, pkg } = await issuedInvoice(w);
      const res = await declare(w.customer1.token, invoice.id, { method: 'BANK_TRANSFER', amount: 9.5, reference: 'VIR-2026-0042' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'PENDING', method: 'BANK_TRANSFER', declaredByCustomer: true, receiptNumber: null });
      expect((await getInvoice(w.token, invoice.id)).body).toMatchObject({ status: 'ISSUED', paidTotal: '0.00', pendingTotal: '9.50' });
      expect(await pkgStatus(pkg.packageId)).toBe('AWAITING_PAYMENT'); // déclarer ne suffit pas

      const billing = await w.staff('BILLING_AGENT');
      const confirmed = await api(t).post(`/v1/admin/payments/${res.body.id}/confirm`).set(bearer(billing)).send({});
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.receiptNumber).toBe(`RCT-${YEAR}-000001`);
      expect(confirmed.body.payment.status).toBe('CONFIRMED');
      expect((await getInvoice(w.token, invoice.id)).body).toMatchObject({ status: 'PAID', balance: '0.00', pendingTotal: '0.00' });
      expect(await pkgStatus(pkg.packageId)).toBe('READY_TO_SHIP');
      expect(errorCode(await api(t).post(`/v1/admin/payments/${res.body.id}/confirm`).set(bearer(billing)).send({}))).toBe('PAYMENT_NOT_PENDING');
    });

    it('le montant réservé compte : on ne peut pas déclarer plus que ce qui reste ; une référence ne se déclare qu’une fois', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      expect((await declare(w.customer1.token, invoice.id, { method: 'MOBILE_MONEY', amount: 6, reference: 'MM-0001' })).status).toBe(201);
      const over = await declare(w.customer1.token, invoice.id, { method: 'MOBILE_MONEY', amount: 3.51, reference: 'MM-0002' });
      expect(over.status).toBe(422);
      expect(over.body.error.details.available).toBe('3.50');
      const dup = await declare(w.customer1.token, invoice.id, { method: 'MOBILE_MONEY', amount: 1, reference: 'mm-0001' }); // casse différente : autre chaîne
      expect([201, 409]).toContain(dup.status);
      const same = await declare(w.customer1.token, invoice.id, { method: 'MOBILE_MONEY', amount: 1, reference: 'MM-0001' });
      expect(same.status).toBe(409);
      expect(errorCode(same)).toBe('DUPLICATE_REFERENCE');
      for (const bad of [{ method: 'CASH' }, { method: 'CARD_ONLINE' }, { reference: '<x>' }, { amount: 0 }]) {
        expect((await declare(w.customer1.token, invoice.id, { method: 'BANK_TRANSFER', amount: 1, reference: 'VIR-9999', ...bad })).status).toBe(400);
      }
    });

    it('refus avec motif : la réservation est libérée ; le client peut retirer sa déclaration', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      const a = (await declare(w.customer1.token, invoice.id, { method: 'BANK_TRANSFER', amount: 9.5, reference: 'VIR-REJ-01' })).body;
      const billing = await w.staff('BILLING_AGENT');
      expect((await api(t).post(`/v1/admin/payments/${a.id}/reject`).set(bearer(billing)).send({})).status).toBe(400);
      const rejected = await api(t).post(`/v1/admin/payments/${a.id}/reject`).set(bearer(billing)).send({ reason: 'Virement introuvable' });
      expect(rejected.body).toMatchObject({ status: 'FAILED', failureReason: 'Virement introuvable' });
      expect((await getInvoice(w.token, invoice.id)).body.pendingTotal).toBe('0.00');
      const b = (await declare(w.customer1.token, invoice.id, { method: 'BANK_TRANSFER', amount: 9.5, reference: 'VIR-REJ-02' })).body;
      expect((await api(t).delete(`/v1/me/payments/${b.id}`).set(bearer(w.customer1.token))).status).toBe(204);
      expect(errorCode(await api(t).delete(`/v1/me/payments/${b.id}`).set(bearer(w.customer1.token)))).toBe('PAYMENT_NOT_PENDING');
    });

    it('un client ne déclare rien sur la facture d’un autre, ni sur un brouillon ; le personnel ne passe pas par cette route', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      expect((await declare(w.customer2.token, invoice.id, { method: 'BANK_TRANSFER', amount: 1, reference: 'VIR-AUTRE-1' })).status).toBe(404);
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      const d = (await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] })).body;
      expect((await declare(w.customer1.token, d.id, { method: 'BANK_TRANSFER', amount: 1, reference: 'VIR-BROUILLON' })).status).toBe(404);
      expect((await declare(w.token, invoice.id, { method: 'BANK_TRANSFER', amount: 1, reference: 'VIR-PERSONNEL' })).status).toBe(403);
      expect((await api(t).delete(`/v1/me/payments/${uuidv7()}`).set(bearer(w.customer1.token))).status).toBe(404);
    });

    it('un paiement en espèces ne se « confirme » pas : il l’est à l’enregistrement', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const paid = await cash(w.token, { invoiceId: invoice.id, amount: 1 });
      expect(errorCode(await api(t).post(`/v1/admin/payments/${paid.body.payment.id}/confirm`).set(bearer(w.token)).send({}))).toBe('PAYMENT_NOT_PENDING');
    });
  });

  // =============================================================================================
  describe('remboursements', () => {
    it('partiel puis total : le solde de la facture suit, jamais plus que le payé', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const paid = (await cash(w.token, { invoiceId: invoice.id, amount: 9.5 })).body.payment;
      const refund = (amount: number) => api(t).post(`/v1/admin/payments/${paid.id}/refunds`).set(bearer(w.token)).send({ amount, reason: 'Retour client' });
      const first = await refund(4);
      expect(first.status).toBe(201);
      expect(first.body.payment).toMatchObject({ status: 'REFUNDED_PARTIAL', refundedTotal: '4.00' });
      expect((await getInvoice(w.token, invoice.id)).body).toMatchObject({ status: 'PARTIALLY_PAID', paidTotal: '5.50', balance: '4.00' });
      const over = await refund(5.51);
      expect(over.status).toBe(422);
      expect(errorCode(over)).toBe('REFUND_EXCEEDS_PAYMENT');
      expect(over.body.error.details.refundable).toBe('5.50');
      const rest = await refund(5.5);
      expect(rest.body.payment).toMatchObject({ status: 'REFUNDED', refundedTotal: '9.50' });
      expect((await getInvoice(w.token, invoice.id)).body).toMatchObject({ status: 'ISSUED', paidTotal: '0.00' });
      expect(errorCode(await refund(1))).toBe('PAYMENT_NOT_REFUNDABLE');
      expect((await api(t).post(`/v1/admin/payments/${paid.id}/refunds`).set(bearer(w.token)).send({ amount: 1 })).status).toBe(400);
    });

    it('droits : la facturation rembourse, le service client non ; un paiement en attente ne se rembourse pas', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      const pending = (await api(t).post(`/v1/me/invoices/${invoice.id}/payments`).set(bearer(w.customer1.token)).send({ method: 'BANK_TRANSFER', amount: 2, reference: 'VIR-RMB-001' })).body;
      const attempt = (token: string) => api(t).post(`/v1/admin/payments/${pending.id}/refunds`).set(bearer(token)).send({ amount: 1, reason: 'x' });
      expect((await attempt(await w.staff('CUSTOMER_SERVICE'))).status).toBe(403);
      expect(errorCode(await attempt(await w.staff('BILLING_AGENT')))).toBe('PAYMENT_NOT_REFUNDABLE');
      expect((await attempt(w.customer1.token)).status).toBe(403);
    });

    it('la base : un paiement ne change ni de montant ni de facture ; reçus et remboursements en ajout seul ; plafond au commit', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const paid = (await cash(w.token, { invoiceId: invoice.id, amount: 5 })).body.payment;
      await expect(t.admin.payment.update({ where: { id: paid.id }, data: { amount: 9 } })).rejects.toThrow(/immuables/);
      await expect(t.admin.payment.update({ where: { id: paid.id }, data: { status: 'PENDING' } })).rejects.toThrow(/interdit/);
      const receipt = await t.admin.receipt.findFirstOrThrow({ where: { paymentId: paid.id } });
      await expect(t.admin.receipt.update({ where: { id: receipt.id }, data: { number: 'X' } })).rejects.toThrow(/ajout seul/);
      await api(t).post(`/v1/admin/payments/${paid.id}/refunds`).set(bearer(w.token)).send({ amount: 1, reason: 'x' });
      const refund = await t.admin.refund.findFirstOrThrow({ where: { paymentId: paid.id } });
      await expect(t.admin.refund.delete({ where: { id: refund.id } })).rejects.toThrow(/ajout seul/);
      // contournement de l'API : un paiement qui ferait dépasser le dû est refusé au commit
      await expect(
        t.admin.payment.create({
          data: { companyId: w.company.id, customerId: w.c1, invoiceId: invoice.id, method: 'BANK_TRANSFER', currency: 'USD', amount: 9, reference: 'VIR-CONTOURNE', declaredByCustomer: true },
        }),
      ).rejects.toThrow(/dépassent/);
    });
  });

  // =============================================================================================
  describe('portail client', () => {
    it('liste ses factures émises (jamais les brouillons), détail, PDF ; les factures d’un autre sont introuvables', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      const pkg = await weighedPackage(t, w, w.customer1, w.w1.id);
      await draft(w.token, { customerId: w.c1, packageIds: [pkg.packageId] });
      const list = await api(t).get('/v1/me/invoices').set(bearer(w.customer1.token));
      expect(list.body.items.map((i: any) => i.id)).toEqual([invoice.id]);
      expect(list.body.items[0]).toMatchObject({ number: invoice.number, status: 'ISSUED', total: '9.50', balance: '9.50' });
      expect(list.body.items[0].lines).toBeUndefined();
      const one = await api(t).get(`/v1/me/invoices/${invoice.id}`).set(bearer(w.customer1.token));
      expect(one.body.lines).toHaveLength(2);
      expect(one.body.packages).toHaveLength(1);
      expect((await api(t).get(`/v1/me/invoices/${invoice.id}`).set(bearer(w.customer2.token))).status).toBe(404);
      expect((await api(t).get('/v1/me/invoices').set(bearer(w.customer2.token))).body.items).toHaveLength(0);
      expect((await api(t).get('/v1/me/invoices')).status).toBe(401);
      expect((await api(t).get('/v1/me/invoices').set(bearer(w.token))).status).toBe(403);

      const pdf = await api(t).get(`/v1/me/invoices/${invoice.id}/pdf`).set(bearer(w.customer1.token)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await api(t).get(`/v1/me/invoices/${invoice.id}/pdf`).set(bearer(w.customer2.token))).status).toBe(404);
    });

    it('moyens de paiement réels : espèces, virement et mobile déclarés ; jamais de carte en ligne ; consignes de l’entreprise', async () => {
      const w = await setup();
      await api(t).put('/v1/admin/settings/finance').set(bearer(w.token)).send({ paymentInstructions: 'Virement : compte 123' });
      const res = await api(t).get('/v1/me/payment-options').set(bearer(w.customer1.token));
      expect(res.body).toEqual({ cash: true, declare: ['BANK_TRANSFER', 'MOBILE_MONEY'], online: false, instructions: 'Virement : compte 123' });
    });

    it('mes paiements et mon reçu en PDF ; le reçu d’un autre est introuvable', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const paid = (await cash(w.token, { invoiceId: invoice.id, amount: 9.5 })).body.payment;
      const mine = await api(t).get('/v1/me/payments').set(bearer(w.customer1.token));
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.items[0]).toMatchObject({ id: paid.id, status: 'CONFIRMED', receiptNumber: `RCT-${YEAR}-000001` });
      expect((await api(t).get('/v1/me/payments').set(bearer(w.customer2.token))).body.items).toHaveLength(0);
      const receipt = await api(t).get(`/v1/me/payments/${paid.id}/receipt.pdf`).set(bearer(w.customer1.token)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(Buffer.from(receipt.body).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await api(t).get(`/v1/me/payments/${paid.id}/receipt.pdf`).set(bearer(w.customer2.token))).status).toBe(404);
      const staffReceipt = await api(t).get(`/v1/admin/payments/${paid.id}/receipt.pdf`).set(bearer(w.token));
      expect(staffReceipt.status).toBe(200);
    });
  });

  // =============================================================================================
  describe('rapprochement, export et isolation', () => {
    it('export CSV : registre chronologique, cellules protégées, période contrôlée', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      const paid = (await cash(w.token, { invoiceId: invoice.id, amount: 9.5, reference: 'BORD-EXPORT' })).body.payment;
      await api(t).post(`/v1/admin/payments/${paid.id}/refunds`).set(bearer(w.token)).send({ amount: 2, reason: '=HYPERLINK("http://pirate.example")' });
      const day = new Date().toISOString().slice(0, 10);
      const res = await api(t).get(`/v1/admin/finance/export.csv?from=${day}&to=${day}`).set(bearer(w.token));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="registre-/);
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      const rows = res.text.split(/\r?\n/);
      expect(rows[1]).toContain('FACTURE');
      expect(rows.map((r) => r.split(',')[1])).toEqual(expect.arrayContaining(['Type', 'FACTURE', 'PAIEMENT', 'REMBOURSEMENT']));
      expect(res.text).toContain('-2.00');
      expect(res.text).toContain(',-2.00,'); // montant négatif resté numérique (pas d'apostrophe)
      expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
      expect(res.text).toContain(w.customer1.customerCode);
      for (const q of ['from=2026-02-01&to=2026-01-01', 'from=2020-01-01&to=2026-12-31', 'from=x&to=y', '']) expect((await api(t).get(`/v1/admin/finance/export.csv?${q}`).set(bearer(w.token))).status).toBe(400);
      const service = await w.staff('CUSTOMER_SERVICE');
      expect((await api(t).get(`/v1/admin/finance/export.csv?from=${day}&to=${day}`).set(bearer(service))).status).toBe(403);
    });

    it('synthèse de rapprochement par mode et par devise, et file des paiements en attente', async () => {
      const w = await setup();
      const { invoice } = await issuedInvoice(w);
      await openCash(w.token);
      await cash(w.token, { invoiceId: invoice.id, amount: 5 });
      await api(t).post(`/v1/me/invoices/${invoice.id}/payments`).set(bearer(w.customer1.token)).send({ method: 'MOBILE_MONEY', amount: 2, reference: 'MM-SYNTH-1' });
      const day = new Date().toISOString().slice(0, 10);
      const billing = await w.staff('BILLING_AGENT');
      const summary = await api(t).get(`/v1/admin/finance/summary?from=${day}&to=${day}`).set(bearer(billing));
      expect(summary.body.confirmed).toEqual([{ method: 'CASH', currency: 'USD', count: 1, collected: '5.00', refunded: '0.00', net: '5.00' }]);
      expect(summary.body.pending).toEqual([{ method: 'MOBILE_MONEY', currency: 'USD', count: 1, amount: '2.00' }]);
      const pending = await api(t).get('/v1/admin/payments?status=PENDING').set(bearer(w.token));
      expect(pending.body.items).toHaveLength(1);
      expect(pending.body.items[0]).toMatchObject({ method: 'MOBILE_MONEY', invoiceNumber: invoice.number, customerCode: w.customer1.customerCode });
      expect((await api(t).get('/v1/admin/payments?status=NOPE').set(bearer(w.token))).status).toBe(400);
    });

    it('une entreprise ne voit ni ne touche les factures, paiements et caisses d’une autre', async () => {
      const a = await setup();
      const b = await setup();
      const { invoice } = await issuedInvoice(a);
      await openCash(a.token);
      const paid = (await cash(a.token, { invoiceId: invoice.id, amount: 1 })).body.payment;
      expect((await getInvoice(b.token, invoice.id)).status).toBe(404);
      expect((await issue(b.token, invoice.id)).status).toBe(404);
      expect((await api(t).post(`/v1/admin/invoices/${invoice.id}/credit-notes`).set(bearer(b.token)).send({ amount: 1, reason: 'x' })).status).toBe(404);
      expect((await api(t).post(`/v1/admin/payments/${paid.id}/refunds`).set(bearer(b.token)).send({ amount: 1, reason: 'x' })).status).toBe(404);
      expect((await api(t).get(`/v1/admin/payments/${paid.id}/receipt.pdf`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).get('/v1/admin/invoices').set(bearer(b.token))).body.items).toHaveLength(0);
      expect((await api(t).get('/v1/admin/payments').set(bearer(b.token))).body.items).toHaveLength(0);
      expect((await cash(b.token, { invoiceId: invoice.id, amount: 1 })).status).toBe(409); // pas de caisse chez B
      expect((await draft(b.token, { customerId: a.c1, extraLines: [{ kind: 'OTHER', description: 'x', amount: 1 }] })).status).toBe(404);
    });

    it('liste et recherche des factures (staff) : statut, numéro, code client, pagination', async () => {
      const w = await setup();
      const one = await issuedInvoice(w);
      const two = await issuedInvoice(w, w.customer2, w.c2);
      const ids = async (q: string) => (await api(t).get(`/v1/admin/invoices${q}`).set(bearer(w.token))).body.items.map((i: any) => i.id);
      expect(await ids('')).toEqual([two.invoice.id, one.invoice.id]);
      expect(await ids(`?q=${one.invoice.number.toLowerCase()}`)).toEqual([one.invoice.id]);
      expect(await ids(`?q=${w.customer2.customerCode}`)).toEqual([two.invoice.id]);
      expect(await ids('?status=PAID')).toEqual([]);
      expect(await ids(`?customerId=${w.c1}`)).toEqual([one.invoice.id]);
      const page = await api(t).get('/v1/admin/invoices?limit=1').set(bearer(w.token));
      expect(page.body.nextCursor).toBeTruthy();
      expect((await api(t).get(`/v1/admin/invoices?limit=1&cursor=${page.body.nextCursor}`).set(bearer(w.token))).body.items).toHaveLength(1);
      expect((await api(t).get('/v1/admin/invoices?status=NOPE').set(bearer(w.token))).status).toBe(400);
      expect((await api(t).get('/v1/admin/invoices').set(bearer(w.customer1.token))).status).toBe(403);
    });
  });
});
