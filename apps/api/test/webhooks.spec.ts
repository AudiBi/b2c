import { createHmac } from 'node:crypto';
import { activateRateCard, api, bearer, buildTestApp, customerIdOf, makeCustomer, makeTenant, makeWarehouse, uniq, weighedPackage, type TestApp } from './helpers';

const SECRET = 'secret-de-test-webhook-0123456789abcdef';
const PROVIDER = 'testpay';
const errorCode = (res: { body: any }) => res.body?.error?.code;

const sign = (body: string, options: { secret?: string; t?: number } = {}) => {
  const t = options.t ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', options.secret ?? SECRET).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
};

describe('Webhook de confirmation de paiement', () => {
  let t: TestApp;
  let plain: TestApp; // même application sans prestataire configuré
  beforeAll(async () => {
    t = await buildTestApp({ PAYMENT_WEBHOOK_PROVIDER: PROVIDER, PAYMENT_WEBHOOK_SECRET: SECRET });
    plain = await buildTestApp();
  });
  afterAll(async () => {
    await t.close();
    await plain.close();
  });

  /** Facture émise de 9,50 USD avec un virement de 9,50 USD déclaré (en attente) sous la référence donnée. */
  async function pendingPayment(reference = `MM-${uniq('').toUpperCase()}`, amount = 9.5) {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token);
    const customer = await makeCustomer(t, tenant.company);
    const customerId = await customerIdOf(t, customer);
    const pkg = await weighedPackage(t, tenant, customer, warehouse.id);
    const draft = await api(t).post('/v1/admin/invoices').set(bearer(tenant.token)).send({ customerId, packageIds: [pkg.packageId] });
    const issued = await api(t).post(`/v1/admin/invoices/${draft.body.id}/issue`).set(bearer(tenant.token));
    const declared = await api(t).post(`/v1/me/invoices/${issued.body.id}/payments`).set(bearer(customer.token)).send({ method: 'MOBILE_MONEY', amount, reference });
    expect(declared.status).toBe(201);
    return { tenant, customer, pkg, invoice: issued.body, payment: declared.body };
  }

  const event = (providerRef: string, overrides: Record<string, unknown> = {}) => ({ eventId: `evt_${uniq('')}`, type: 'payment.succeeded', providerRef, amount: 9.5, currency: 'USD', ...overrides });
  const post = (slug: string, body: unknown, signature?: string | null, provider = PROVIDER, app: TestApp = t) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const req = api(app).post(`/v1/webhooks/payments/${slug}/${provider}`).set('Content-Type', 'application/json');
    return (signature === null ? req : req.set('X-Signature', signature ?? sign(raw))).send(raw);
  };

  it('sans prestataire configuré, le point d’entrée n’existe pas (rien n’est simulé)', async () => {
    const body = JSON.stringify(event('MM-AUCUNE-0001'));
    const res = await post('nimporte', body, sign(body), PROVIDER, plain);
    expect(res.status).toBe(404);
  });

  it('confirmation valide : paiement confirmé, reçu, facture réglée, colis libéré, événement « payment.confirmed » émis', async () => {
    const w = await pendingPayment();
    const res = await post(w.tenant.company.slug, event(w.payment.reference));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'PROCESSED' });
    const payment = await t.admin.payment.findUniqueOrThrow({ where: { id: w.payment.id } });
    expect(payment).toMatchObject({ status: 'CONFIRMED', provider: PROVIDER, providerRef: w.payment.reference });
    expect((await t.admin.invoice.findUniqueOrThrow({ where: { id: w.invoice.id } })).status).toBe('PAID');
    expect((await t.admin.package.findUniqueOrThrow({ where: { id: w.pkg.packageId } })).status).toBe('READY_TO_SHIP');
    expect(await t.admin.receipt.count({ where: { paymentId: w.payment.id } })).toBe(1);
    expect(await t.admin.outboxEvent.count({ where: { companyId: w.tenant.company.id, eventCode: 'payment.confirmed' } })).toBe(1);
  });

  it('rejeu : le même événement n’a jamais deux effets (DUPLICATE) ; 5 envois simultanés → un seul traitement', async () => {
    const w = await pendingPayment();
    const e = event(w.payment.reference);
    const results = await Promise.all(Array.from({ length: 5 }, () => post(w.tenant.company.slug, e)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.status === 'PROCESSED')).toHaveLength(1);
    expect(results.filter((r) => r.body.status === 'DUPLICATE')).toHaveLength(4);
    expect(await t.admin.receipt.count({ where: { paymentId: w.payment.id } })).toBe(1);
    expect(await t.admin.providerWebhookEvent.count({ where: { companyId: w.tenant.company.id } })).toBe(1);
    const again = await post(w.tenant.company.slug, e);
    expect(again.body).toEqual({ status: 'DUPLICATE' });
  });

  it('signature absente, fausse, d’un autre secret, périmée ou mal formée : 401 et aucun effet', async () => {
    const w = await pendingPayment();
    const body = JSON.stringify(event(w.payment.reference));
    const now = Math.floor(Date.now() / 1000);
    const bad: Array<string | null> = [
      null,
      'n-importe-quoi',
      sign(body, { secret: 'un-autre-secret-0123456789abcdefghij' }),
      sign(body, { t: now - 600 }), // bien au-delà de la tolérance de 300 s : la marge absorbe la lenteur de la machine
      sign(body, { t: now + 600 }),
      `t=${now},v1=${'0'.repeat(64)}`,
      `t=${now},v1=zz`,
      sign(JSON.stringify({ ...JSON.parse(body), amount: 1 })), // signature d'un autre corps
    ];
    for (const signature of bad) {
      const res = await post(w.tenant.company.slug, body, signature);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('INVALID_SIGNATURE');
    }
    expect((await t.admin.payment.findUniqueOrThrow({ where: { id: w.payment.id } })).status).toBe('PENDING');
    expect(await t.admin.providerWebhookEvent.count({ where: { companyId: w.tenant.company.id } })).toBe(0);
  });

  it('corps modifié après signature (altération) : refusé', async () => {
    const w = await pendingPayment();
    const original = JSON.stringify(event(w.payment.reference));
    const signature = sign(original);
    const tampered = original.replace('9.5', '0.5');
    expect((await post(w.tenant.company.slug, tampered, signature)).status).toBe(401);
  });

  it('montant ou devise différents du paiement attendu : MISMATCH, le paiement reste en attente', async () => {
    const w = await pendingPayment();
    const wrongAmount = await post(w.tenant.company.slug, event(w.payment.reference, { amount: 9.49 }));
    expect(wrongAmount.body).toEqual({ status: 'MISMATCH' });
    const wrongCurrency = await post(w.tenant.company.slug, event(w.payment.reference, { currency: 'HTG' }));
    expect(wrongCurrency.body).toEqual({ status: 'MISMATCH' });
    expect((await t.admin.payment.findUniqueOrThrow({ where: { id: w.payment.id } })).status).toBe('PENDING');
    expect((await t.admin.providerWebhookEvent.findMany({ where: { companyId: w.tenant.company.id } })).map((e) => e.status)).toEqual(['MISMATCH', 'MISMATCH']);
  });

  it('référence inconnue : UNMATCHED, enregistré pour examen, rien n’est confirmé', async () => {
    const w = await pendingPayment();
    const res = await post(w.tenant.company.slug, event(w.payment.reference, { providerRef: 'MM-INCONNU-9' }));
    expect(res.body).toEqual({ status: 'UNMATCHED' });
    expect((await t.admin.payment.findUniqueOrThrow({ where: { id: w.payment.id } })).status).toBe('PENDING');
  });

  it('une référence d’une autre entreprise n’est jamais rapprochée (isolation)', async () => {
    const a = await pendingPayment();
    const b = await pendingPayment();
    const res = await post(b.tenant.company.slug, event(a.payment.reference));
    expect(res.body).toEqual({ status: 'UNMATCHED' });
    expect((await t.admin.payment.findUniqueOrThrow({ where: { id: a.payment.id } })).status).toBe('PENDING');
  });

  it('échec signalé par le prestataire : paiement refusé, la réservation est libérée, la facture reste due', async () => {
    const w = await pendingPayment();
    const res = await post(w.tenant.company.slug, event(w.payment.reference, { type: 'payment.failed' }));
    expect(res.body).toEqual({ status: 'PROCESSED' });
    expect(await t.admin.payment.findUniqueOrThrow({ where: { id: w.payment.id } })).toMatchObject({ status: 'FAILED', failureReason: 'Refusé par le prestataire' });
    const invoice = await api(t).get(`/v1/admin/invoices/${w.invoice.id}`).set(bearer(w.tenant.token));
    expect(invoice.body).toMatchObject({ status: 'ISSUED', pendingTotal: '0.00', balance: '9.50' });
    // une confirmation tardive du même paiement ne le ressuscite pas
    expect((await post(w.tenant.company.slug, event(w.payment.reference))).body).toEqual({ status: 'UNMATCHED' });
  });

  it('entreprise inconnue, prestataire différent, corps illisible ou invalide', async () => {
    const w = await pendingPayment();
    const body = JSON.stringify(event(w.payment.reference));
    expect((await post('entreprise-inconnue', body)).status).toBe(404);
    expect((await post(w.tenant.company.slug, body, undefined, 'autrepay')).status).toBe(404);
    const garbage = '{pas du json';
    const res = await post(w.tenant.company.slug, garbage);
    expect(res.status).toBe(400);
    expect(res.status).toBe(400);
    for (const bad of [{ ...event(w.payment.reference), surprise: 1 }, { ...event(w.payment.reference), amount: -1 }, { ...event(w.payment.reference), type: 'payment.refunded' }, { ...event(w.payment.reference), eventId: 'court' }]) {
      expect((await post(w.tenant.company.slug, bad)).status).toBe(400);
    }
    expect((await t.admin.payment.findUniqueOrThrow({ where: { id: w.payment.id } })).status).toBe('PENDING');
  });

  it('les événements reçus ne se modifient ni ne se suppriment (base)', async () => {
    const w = await pendingPayment();
    await post(w.tenant.company.slug, event(w.payment.reference));
    const row = await t.admin.providerWebhookEvent.findFirstOrThrow({ where: { companyId: w.tenant.company.id } });
    await expect(t.admin.providerWebhookEvent.update({ where: { id: row.id }, data: { status: 'X' } })).rejects.toThrow(/ajout seul/);
    await expect(t.admin.providerWebhookEvent.delete({ where: { id: row.id } })).rejects.toThrow(/ajout seul/);
  });
});
