import {
  closeCashSessionSchema,
  createInvoiceSchema,
  creditNoteNumber,
  declarePaymentSchema,
  exportQuerySchema,
  invoiceNumber,
  receiptNumber,
  recordCashPaymentSchema,
  webhookEventSchema,
} from '../src/schemas/finance';
import {
  EVENT_CODES,
  EVENT_VARIABLES,
  MANDATORY_EVENTS,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MINUTES,
  renderTemplate,
  templateSchema,
  unknownPlaceholders,
} from '../src/notifications';

const uuid = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';

describe('finance : schémas et numéros', () => {
  it('numéros sans ambiguïté : préfixe, année, six chiffres', () => {
    expect(invoiceNumber(2026, 45)).toBe('INV-2026-000045');
    expect(creditNoteNumber(2026, 1)).toBe('CN-2026-000001');
    expect(receiptNumber(2027, 1234567)).toBe('RCT-2027-1234567');
  });

  it('facture : au moins un colis ou une ligne, pas de doublon, montants à 2 décimales', () => {
    const base = { customerId: uuid };
    expect(createInvoiceSchema.safeParse(base).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, packageIds: [uuid] }).success).toBe(true);
    expect(createInvoiceSchema.safeParse({ ...base, packageIds: [uuid, uuid] }).success).toBe(false);
    const line = { kind: 'HANDLING', description: 'Manutention', amount: 5 };
    expect(createInvoiceSchema.safeParse({ ...base, extraLines: [line] }).success).toBe(true);
    for (const amount of [0, -5, 5.123, 20_000_000]) expect(createInvoiceSchema.safeParse({ ...base, extraLines: [{ ...line, amount }] }).success).toBe(false);
    // les remises et taxes ne s'ajoutent pas comme lignes libres
    for (const kind of ['DISCOUNT', 'TAX']) expect(createInvoiceSchema.safeParse({ ...base, extraLines: [{ ...line, kind }] }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, packageIds: [uuid], discountPercent: 12.5 }).success).toBe(true);
    for (const discountPercent of [-1, 101, 12.555]) expect(createInvoiceSchema.safeParse({ ...base, packageIds: [uuid], discountPercent }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, packageIds: [uuid], surprise: 1 }).success).toBe(false);
  });

  it('paiements : montant positif, référence lisible, mode limité aux déclarations', () => {
    expect(recordCashPaymentSchema.safeParse({ invoiceId: uuid, amount: 20 }).success).toBe(true);
    expect(recordCashPaymentSchema.safeParse({ invoiceId: uuid, amount: 0 }).success).toBe(false);
    expect(declarePaymentSchema.safeParse({ method: 'BANK_TRANSFER', amount: 20, reference: 'VIR-2026-0042' }).success).toBe(true);
    expect(declarePaymentSchema.safeParse({ method: 'ZELLE', amount: 20, reference: 'ZL-2026-0042' }).success).toBe(true);
    expect(declarePaymentSchema.safeParse({ method: 'MOBILE_MONEY', amount: 20, reference: 'MC-2026-0042' }).success).toBe(true);
    for (const bad of [{ method: 'CASH' }, { method: 'CARD_ONLINE' }, { reference: 'x' }, { reference: '<script>' }]) {
      expect(declarePaymentSchema.safeParse({ method: 'BANK_TRANSFER', amount: 20, reference: 'VIR-0042', ...bad }).success).toBe(false);
    }
    expect(closeCashSessionSchema.safeParse({ countedAmount: 0 }).success).toBe(true);
    expect(closeCashSessionSchema.safeParse({ countedAmount: -1 }).success).toBe(false);
  });

  it('export : période ordonnée et limitée à un an', () => {
    expect(exportQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(true);
    expect(exportQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
    expect(exportQuerySchema.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(false);
  });

  it('webhook : événement strict', () => {
    const ok = { eventId: 'evt_12345678', type: 'payment.succeeded', providerRef: 'PROV-0001', amount: 10, currency: 'USD' };
    expect(webhookEventSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ type: 'payment.refunded' }, { currency: 'GBP' }, { eventId: 'x' }, { extra: true }]) expect(webhookEventSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
  });
});

describe('notifications : événements et modèles', () => {
  it('14 événements, chacun avec ses variables ; les événements obligatoires existent', () => {
    expect(EVENT_CODES).toHaveLength(14);
    expect(Object.keys(EVENT_VARIABLES).sort()).toEqual([...EVENT_CODES].sort());
    for (const e of MANDATORY_EVENTS) expect(EVENT_CODES).toContain(e);
  });

  it('refuse une variable inconnue, accepte les variables de l’événement', () => {
    expect(unknownPlaceholders('payment.confirmed', 'Reçu {receiptNumber}', '{customerName} {amount} {currency}')).toEqual([]);
    expect(unknownPlaceholders('package.received', 'Bonjour {customerName} {password}')).toEqual(['password']);
    const base = { eventCode: 'package.received', channel: 'IN_APP', locale: 'fr', body: 'Colis {trackingNumber} reçu' };
    expect(templateSchema.safeParse(base).success).toBe(true);
    expect(templateSchema.safeParse({ ...base, body: 'Voir {invoiceNumber}' }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, channel: 'EMAIL' }).success).toBe(false); // objet obligatoire pour un e-mail
    expect(templateSchema.safeParse({ ...base, channel: 'EMAIL', subject: 'Colis reçu' }).success).toBe(true);
    expect(templateSchema.safeParse({ ...base, body: '' }).success).toBe(false);
  });

  it('le rendu remplace sans rien évaluer ; les retours à la ligne sont retirés des objets', () => {
    expect(renderTemplate('Bonjour {customerName}, {trackingNumber}', { customerName: 'Marie', trackingNumber: 'EE-1' })).toBe('Bonjour Marie, EE-1');
    expect(renderTemplate('{x}', { x: '${process.exit()} {y}' })).toBe('${process.exit()} {y}');
    expect(renderTemplate('Objet : {customerName}', { customerName: 'A\r\nBcc: pirate@example.test' }, { singleLine: true })).toBe('Objet : A Bcc: pirate@example.test');
    expect(renderTemplate('{inconnu}', {})).toBe('');
  });

  it('les nouvelles tentatives s’espacent, puis l’échec est définitif', () => {
    expect([...RETRY_DELAYS_MINUTES]).toEqual([...RETRY_DELAYS_MINUTES].sort((a, b) => a - b));
    expect(MAX_ATTEMPTS).toBe(RETRY_DELAYS_MINUTES.length + 1);
  });
});
