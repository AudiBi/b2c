import { v7 as uuidv7 } from 'uuid';
import { MAX_ATTEMPTS, RETRY_DELAYS_MINUTES } from '@b2c/shared';
import { NotificationWorker } from '../src/notifications/notification.worker';
import {
  activateRateCard,
  api,
  bearer,
  buildTestApp,
  customerIdOf,
  login,
  makeCustomer,
  makePrealert,
  makeTenant,
  makeUser,
  makeWarehouse,
  mailsTo,
  processNotifications,
  weighedPackage,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;
const minutes = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

describe('Notifications : outbox, envoi, tentatives, modèles, portail', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());
  afterEach(() => jest.restoreAllMocks());

  async function setup() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token);
    const customer = await makeCustomer(t, tenant.company);
    return { ...tenant, warehouse, customer, customerId: await customerIdOf(t, customer) };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const notifications = (w: World, where: Record<string, unknown> = {}) => t.admin.notification.findMany({ where: { companyId: w.company.id, ...where }, orderBy: { id: 'asc' } });
  const setPrefs = (w: World, prefs: Record<string, boolean>) => t.admin.customer.update({ where: { id: w.customerId }, data: { notificationPrefs: prefs } });
  const emitDirect = (w: World, eventCode: string, payload: Record<string, string>) =>
    t.admin.outboxEvent.create({ data: { companyId: w.company.id, eventCode, aggregateType: 'package', aggregateId: uuidv7(), customerId: w.customerId, payload } });
  const putTemplate = (w: World, body: Record<string, unknown>) => api(t).put('/v1/admin/notification-templates').set(bearer(w.token)).send(body);

  // =============================================================================================
  describe('émission et envoi', () => {
    it('une action métier écrit l’événement ; le traitement produit portail + e-mail dans la langue du client', async () => {
      const w = await setup();
      await t.admin.user.update({ where: { id: w.customer.user.id }, data: { locale: 'en' } });
      const prealert = await makePrealert(t, w.customer, w.warehouse.id);
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id, eventCode: 'prealert.created' } })).toBe(1);
      expect(await notifications(w)).toHaveLength(0); // rien n'est envoyé dans la requête elle-même

      const result = await processNotifications(t, w.company.id);
      expect(result).toMatchObject({ fannedOut: 1, sent: 1, failed: 0 });
      const rows = await notifications(w);
      expect(rows.map((n) => [n.channel, n.status, n.locale])).toEqual([
        ['IN_APP', 'SENT', 'en'],
        ['EMAIL', 'SENT', 'en'],
      ].concat(rows.length > 2 ? rows.slice(2).map((n) => [n.channel, n.status, n.locale]) : []));
      const mail = mailsTo(t, w.customer.user.email);
      expect(mail).toHaveLength(1);
      expect(mail[0].subject).toBe('Purchase declared');
      expect(mail[0].text.replace(/-/g, '')).toContain(prealert.package.trackingNumber);
      expect(mail[0].text).toContain('Boutique Test');
    });

    it('SMS et WhatsApp activés par le client mais sans prestataire : « ignoré » visible, rien d’envoyé', async () => {
      const w = await setup();
      await setPrefs(w, { email: true, sms: true, whatsapp: true, inApp: true });
      await makePrealert(t, w.customer, w.warehouse.id);
      const result = await processNotifications(t, w.company.id);
      expect(result.skipped).toBe(2);
      const skipped = await notifications(w, { channel: { in: ['SMS', 'WHATSAPP'] } });
      expect(skipped.map((n) => [n.channel, n.status, n.skipReason])).toEqual([['SMS', 'SKIPPED', 'CHANNEL_NOT_CONFIGURED'], ['WHATSAPP', 'SKIPPED', 'CHANNEL_NOT_CONFIGURED']]);
      expect(mailsTo(t, w.customer.user.email)).toHaveLength(1); // le seul envoi réel est l'e-mail
    });

    it('préférences : canal coupé → PREFERENCE_OFF ; un événement obligatoire (paiement confirmé) passe quand même', async () => {
      const w = await setup();
      await setPrefs(w, { email: false, sms: false, whatsapp: false, inApp: false });
      await makePrealert(t, w.customer, w.warehouse.id);
      await emitDirect(w, 'payment.confirmed', { customerName: 'Client', invoiceNumber: 'INV-1', receiptNumber: 'RCT-1', amount: '9.50', currency: 'USD' });
      await processNotifications(t, w.company.id);
      const optional = await notifications(w, { eventCode: 'prealert.created' });
      expect(optional.map((n) => [n.channel, n.status, n.skipReason])).toEqual([['IN_APP', 'SKIPPED', 'PREFERENCE_OFF'], ['EMAIL', 'SKIPPED', 'PREFERENCE_OFF']]);
      const mandatory = await notifications(w, { eventCode: 'payment.confirmed' });
      expect(mandatory.filter((n) => n.channel === 'IN_APP' || n.channel === 'EMAIL').map((n) => n.status)).toEqual(['SENT', 'SENT']);
      expect(mailsTo(t, w.customer.user.email).map((m) => m.subject)).toEqual(['Paiement reçu : RCT-1']);
    });

    it('traitements simultanés et rejeu : une seule série de notifications, un seul e-mail', async () => {
      const w = await setup();
      await makePrealert(t, w.customer, w.warehouse.id);
      await Promise.all([processNotifications(t, w.company.id), processNotifications(t, w.company.id), processNotifications(t, w.company.id)]);
      await processNotifications(t, w.company.id);
      const rows = await notifications(w);
      expect(new Set(rows.map((n) => n.dedupeKey)).size).toBe(rows.length);
      expect(rows.filter((n) => n.channel === 'EMAIL')).toHaveLength(1);
      expect(mailsTo(t, w.customer.user.email)).toHaveLength(1);
      // rejouer le même événement : les clés de déduplication empêchent tout doublon
      const event = await t.admin.outboxEvent.findFirstOrThrow({ where: { companyId: w.company.id } });
      await t.admin.outboxEvent.update({ where: { id: event.id }, data: { processedAt: null } });
      await processNotifications(t, w.company.id);
      expect(await notifications(w)).toHaveLength(rows.length);
      expect(mailsTo(t, w.customer.user.email)).toHaveLength(1);
    });

    it('un événement dont le client a disparu est écarté avec une erreur lisible, sans bloquer la file', async () => {
      const w = await setup();
      const orphan = await t.admin.outboxEvent.create({ data: { companyId: w.company.id, eventCode: 'prealert.created', aggregateType: 'package', aggregateId: uuidv7(), customerId: uuidv7(), payload: { customerName: 'X' } } });
      await makePrealert(t, w.customer, w.warehouse.id);
      const result = await processNotifications(t, w.company.id);
      expect(result.fannedOut).toBe(2);
      expect(mailsTo(t, w.customer.user.email)).toHaveLength(1);
      expect(await t.admin.outboxEvent.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({ lastError: 'CUSTOMER_NOT_FOUND' });
      expect((await t.admin.outboxEvent.findUniqueOrThrow({ where: { id: orphan.id } })).processedAt).not.toBeNull();
    });
  });

  // =============================================================================================
  describe('tentatives et échecs', () => {
    it('échec d’envoi : nouvelles tentatives espacées (1, 5, 30, 120 min) puis ÉCHEC définitif ; relance par le personnel', async () => {
      const w = await setup();
      jest.spyOn(t.mail, 'send').mockRejectedValue(new Error('SMTP indisponible'));
      await makePrealert(t, w.customer, w.warehouse.id);
      const start = new Date(Date.now() + 2000);

      let now = start;
      const first = await processNotifications(t, w.company.id, now);
      expect(first.retried).toBe(1);
      let email = (await notifications(w, { channel: 'EMAIL' }))[0];
      expect(email).toMatchObject({ status: 'QUEUED', attempts: 1, lastError: 'SMTP indisponible' });
      expect(email.nextAttemptAt!.getTime()).toBe(minutes(now, RETRY_DELAYS_MINUTES[0]).getTime());

      // pas encore l'heure : aucune tentative
      expect((await processNotifications(t, w.company.id, minutes(now, 0.5))).retried).toBe(0);

      for (let attempt = 2; attempt < MAX_ATTEMPTS; attempt += 1) {
        now = email.nextAttemptAt!;
        const res = await processNotifications(t, w.company.id, now);
        expect(res.retried).toBe(1);
        email = (await notifications(w, { channel: 'EMAIL' }))[0];
        expect(email.attempts).toBe(attempt);
        expect(email.nextAttemptAt!.getTime()).toBe(minutes(now, RETRY_DELAYS_MINUTES[attempt - 1]).getTime());
      }
      const last = await processNotifications(t, w.company.id, email.nextAttemptAt!);
      expect(last.failed).toBe(1);
      email = (await notifications(w, { channel: 'EMAIL' }))[0];
      expect(email).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, nextAttemptAt: null });
      // le portail, lui, a fonctionné malgré l'échec de l'e-mail
      expect((await notifications(w, { channel: 'IN_APP' }))[0].status).toBe('SENT');

      // journal et relance
      const log = await api(t).get('/v1/admin/notifications?status=FAILED').set(bearer(w.token));
      expect(log.body.items).toHaveLength(1);
      expect(log.body.items[0]).toMatchObject({ channel: 'EMAIL', status: 'FAILED', attempts: MAX_ATTEMPTS, lastError: 'SMTP indisponible', customerCode: w.customer.customerCode });
      jest.restoreAllMocks();
      const retried = await api(t).post(`/v1/admin/notifications/${email.id}/retry`).set(bearer(w.token));
      expect(retried.body).toMatchObject({ status: 'QUEUED', attempts: 0 });
      expect((await processNotifications(t, w.company.id)).sent).toBe(1);
      expect(mailsTo(t, w.customer.user.email)).toHaveLength(1);
      expect(errorCode(await api(t).post(`/v1/admin/notifications/${email.id}/retry`).set(bearer(w.token)))).toBe('NOT_FAILED');
    });

    it('un échec passager puis un succès : une seule remise', async () => {
      const w = await setup();
      const send = jest.spyOn(t.mail, 'send').mockRejectedValueOnce(new Error('timeout'));
      await makePrealert(t, w.customer, w.warehouse.id);
      const start = new Date(Date.now() + 2000);
      await processNotifications(t, w.company.id, start);
      const result = await processNotifications(t, w.company.id, minutes(start, 2));
      expect(result.sent).toBe(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect((await notifications(w, { channel: 'EMAIL' }))[0]).toMatchObject({ status: 'SENT', attempts: 2, lastError: null });
    });

    it('le traitement de fond (tick) traite les entreprises qui ont du travail', async () => {
      const w = await setup();
      await makePrealert(t, w.customer, w.warehouse.id);
      await t.app.get(NotificationWorker).tick();
      expect(await notifications(w, { status: 'SENT' })).not.toHaveLength(0);
      expect(mailsTo(t, w.customer.user.email)).toHaveLength(1);
    });

    it('le déclenchement manuel du traitement est réservé à ceux qui gèrent les modèles', async () => {
      const w = await setup();
      const reader = await login(t, await makeUser(t, { company: w.company, roleCode: 'CUSTOMER_SERVICE' }));
      expect((await api(t).post('/v1/admin/notifications/process').set(bearer(reader.accessToken))).status).toBe(403);
      await makePrealert(t, w.customer, w.warehouse.id);
      const res = await api(t).post('/v1/admin/notifications/process').set(bearer(w.token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ fannedOut: 1, sent: 1 });
    });
  });

  // =============================================================================================
  describe('modèles', () => {
    it('liste les modèles effectifs : défaut tant qu’aucun n’est personnalisé', async () => {
      const w = await setup();
      const res = await api(t).get('/v1/admin/notification-templates').set(bearer(w.token));
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(12 * 2 * 3);
      const one = res.body.items.find((i: any) => i.eventCode === 'payment.confirmed' && i.channel === 'EMAIL' && i.locale === 'fr');
      expect(one).toMatchObject({ source: 'DEFAULT', active: true, mandatory: true, subject: 'Paiement reçu : {receiptNumber}' });
      expect(one.variables).toEqual(['customerName', 'invoiceNumber', 'receiptNumber', 'amount', 'currency']);
    });

    it('un modèle personnalisé remplace le modèle par défaut ; le retour au défaut le rétablit', async () => {
      const w = await setup();
      const saved = await putTemplate(w, { eventCode: 'prealert.created', channel: 'EMAIL', locale: 'fr', subject: 'Votre achat {storeName}', body: 'Salut {customerName}, suivi : {trackingNumber}.' });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ source: 'COMPANY', active: true });
      const prealert = await makePrealert(t, w.customer, w.warehouse.id);
      await processNotifications(t, w.company.id);
      const mail = mailsTo(t, w.customer.user.email)[0];
      expect(mail.subject).toBe('Votre achat Boutique Test');
      expect(mail.text.startsWith('Salut ')).toBe(true);
      expect(mail.text.replace(/-/g, '')).toContain(`suivi : ${prealert.package.trackingNumber}.`);
      // le portail garde son modèle par défaut (un modèle par canal)
      expect((await notifications(w, { channel: 'IN_APP' }))[0].subject).toBe('Achat déclaré');

      const reset = (query: string) => api(t).delete(`/v1/admin/notification-templates?${query}`).set(bearer(w.token));
      expect((await reset('eventCode=prealert.created&channel=EMAIL&locale=fr')).status).toBe(204);
      expect(errorCode(await reset('eventCode=prealert.created&channel=EMAIL&locale=fr'))).toBe('TEMPLATE_NOT_FOUND');
      expect((await reset('eventCode=nope&channel=EMAIL&locale=fr')).status).toBe(400);
    });

    it('variables inconnues, sujet manquant, canal SMS/WhatsApp, corps vide ou démesuré : refusés', async () => {
      const w = await setup();
      const base = { eventCode: 'package.received', channel: 'EMAIL', locale: 'fr', subject: 'Sujet', body: 'Corps {trackingNumber}' };
      expect((await putTemplate(w, { ...base, body: 'Bonjour {password}' })).status).toBe(400);
      expect((await putTemplate(w, { ...base, subject: '{invoiceNumber}' })).status).toBe(400); // variable d'un autre événement
      expect((await putTemplate(w, { ...base, subject: undefined })).status).toBe(400);
      expect((await putTemplate(w, { ...base, body: '' })).status).toBe(400);
      expect((await putTemplate(w, { ...base, body: 'x'.repeat(2001) })).status).toBe(400);
      expect((await putTemplate(w, { ...base, extra: 1 })).status).toBe(400);
      expect(errorCode(await putTemplate(w, { ...base, channel: 'SMS' }))).toBe('CHANNEL_NOT_CONFIGURED');
      expect((await putTemplate(w, base)).status).toBe(200);
    });

    it('modèle désactivé : le canal est ignoré (TEMPLATE_DISABLED), sauf pour un événement obligatoire', async () => {
      const w = await setup();
      await putTemplate(w, { eventCode: 'prealert.created', channel: 'EMAIL', locale: 'fr', subject: 'S', body: 'B {trackingNumber}', active: false });
      await putTemplate(w, { eventCode: 'payment.confirmed', channel: 'EMAIL', locale: 'fr', subject: 'S', body: 'B', active: false });
      await makePrealert(t, w.customer, w.warehouse.id);
      await emitDirect(w, 'payment.confirmed', { customerName: 'C', invoiceNumber: 'INV-1', receiptNumber: 'RCT-1', amount: '1.00', currency: 'USD' });
      await processNotifications(t, w.company.id);
      expect((await notifications(w, { eventCode: 'prealert.created', channel: 'EMAIL' }))[0]).toMatchObject({ status: 'SKIPPED', skipReason: 'TEMPLATE_DISABLED' });
      const paid = (await notifications(w, { eventCode: 'payment.confirmed', channel: 'EMAIL' }))[0];
      expect(paid.status).toBe('SENT');
      expect(paid.subject).toBe('Paiement reçu : RCT-1'); // le modèle par défaut s'applique
    });

    it('texte brut : aucune interprétation ; retours à la ligne retirés de l’objet (pas d’injection d’en-tête)', async () => {
      const w = await setup();
      await putTemplate(w, { eventCode: 'prealert.created', channel: 'EMAIL', locale: 'fr', subject: 'Achat {storeName}', body: '<b>{storeName}</b> {{customerName}}' });
      await emitDirect(w, 'prealert.created', { customerName: 'Marie', trackingNumber: 'T-1', storeName: 'Boutique\r\nBcc: pirate@example.com' });
      await processNotifications(t, w.company.id);
      const mail = mailsTo(t, w.customer.user.email)[0];
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.subject).toContain('Boutique');
      expect(mail.text.startsWith('<b>Boutique')).toBe(true); // le HTML reste du texte
    });

    it('droits : le personnel lit, seuls les gestionnaires modifient ; le client n’a pas accès', async () => {
      const w = await setup();
      const service = (await login(t, await makeUser(t, { company: w.company, roleCode: 'CUSTOMER_SERVICE' }))).accessToken;
      expect((await api(t).get('/v1/admin/notification-templates').set(bearer(service))).status).toBe(200);
      expect((await api(t).get('/v1/admin/notifications').set(bearer(service))).status).toBe(200);
      expect((await putTemplate({ ...w, token: service } as World, { eventCode: 'package.received', channel: 'EMAIL', locale: 'fr', subject: 'S', body: 'B' })).status).toBe(403);
      expect((await api(t).get('/v1/admin/notification-templates').set(bearer(w.customer.token))).status).toBe(403);
      expect((await api(t).get('/v1/admin/notifications').set(bearer(w.customer.token))).status).toBe(403);
      expect((await api(t).get('/v1/admin/notifications')).status).toBe(401);
    });
  });

  // =============================================================================================
  describe('émetteurs métier', () => {
    it('réception et pesée : « colis reçu » ; mise en attente : « incident » ; la sortie d’attente n’en émet pas', async () => {
      const w = await setup();
      const pkg = await weighedPackage(t, w, w.customer, w.warehouse.id);
      const codes = async () => (await t.admin.outboxEvent.findMany({ where: { companyId: w.company.id }, orderBy: { id: 'asc' } })).map((e) => e.eventCode);
      expect(await codes()).toEqual(['prealert.created', 'package.received']);
      const hold = await api(t).post(`/v1/admin/packages/${pkg.packageId}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Colis endommagé', holdReasonCode: 'DAMAGED' });
      expect(hold.status).toBe(200);
      expect(await codes()).toEqual(['prealert.created', 'package.received', 'package.incident']);
      const release = await api(t).post(`/v1/admin/packages/${pkg.packageId}/transitions`).set(bearer(w.token)).send({ to: 'REGISTERED_WEIGHED', reason: 'Vérifié' });
      expect(release.status).toBe(200);
      expect(await codes()).toEqual(['prealert.created', 'package.received', 'package.incident']);
      const payload = (await t.admin.outboxEvent.findFirstOrThrow({ where: { companyId: w.company.id, eventCode: 'package.incident' } })).payload as Record<string, string>;
      expect(payload.trackingNumber.replace(/-/g, '')).toBe(pkg.trackingNumber);
      expect(JSON.stringify(payload)).not.toMatch(/Colis endommagé|DAMAGED/); // la raison interne n'est pas envoyée au client
    });

    it('une action refusée n’émet rien (l’événement vit dans la transaction de l’action)', async () => {
      const w = await setup();
      const before = await t.admin.outboxEvent.count({ where: { companyId: w.company.id } });
      const refused = await api(t).post('/v1/admin/packages/receive').set(bearer(w.token)).send({ warehouseId: w.warehouse.id, expectedPackageId: uuidv7() });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id } })).toBe(before);
    });

    it('un colis non identifié (sans client) n’émet aucune notification', async () => {
      const w = await setup();
      const received = await api(t).post('/v1/admin/packages/receive').set(bearer(w.token)).send({ warehouseId: w.warehouse.id, supplierTracking: `1Z${Date.now()}`, transportMode: 'AIR' });
      expect(received.status).toBeLessThan(300);
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id } })).toBe(0);
    });
  });

  // =============================================================================================
  describe('portail client', () => {
    it('boîte de réception : liste, non lues, lecture d’une notification puis de toutes', async () => {
      const w = await setup();
      await makePrealert(t, w.customer, w.warehouse.id);
      await makePrealert(t, w.customer, w.warehouse.id);
      await processNotifications(t, w.company.id);
      const inbox = await api(t).get('/v1/me/notifications').set(bearer(w.customer.token));
      expect(inbox.status).toBe(200);
      expect(inbox.body.unread).toBe(2);
      expect(inbox.body.items).toHaveLength(2);
      expect(inbox.body.items[0]).toMatchObject({ eventCode: 'prealert.created', subject: 'Achat déclaré', readAt: null });
      expect(inbox.body.items[0].channel).toBeUndefined(); // pas de champs techniques
      const first = inbox.body.items[0].id;
      expect((await api(t).post(`/v1/me/notifications/${first}/read`).set(bearer(w.customer.token))).body).toEqual({ updated: 1 });
      expect((await api(t).get('/v1/me/notifications').set(bearer(w.customer.token))).body.unread).toBe(1);
      expect((await api(t).get('/v1/me/notifications?unread=true').set(bearer(w.customer.token))).body.items).toHaveLength(1);
      expect((await api(t).post('/v1/me/notifications/read-all').set(bearer(w.customer.token))).body).toEqual({ updated: 1 });
      expect((await api(t).get('/v1/me/notifications').set(bearer(w.customer.token))).body.unread).toBe(0);
      const page = await api(t).get('/v1/me/notifications?limit=1').set(bearer(w.customer.token));
      expect(page.body.items).toHaveLength(1);
      expect(page.body.nextCursor).toBeTruthy();
    });

    it('un client ne voit ni ne lit les notifications d’un autre ; le personnel n’a pas cette boîte', async () => {
      const w = await setup();
      const other = await makeCustomer(t, w.company);
      await makePrealert(t, w.customer, w.warehouse.id);
      await processNotifications(t, w.company.id);
      const mine = (await api(t).get('/v1/me/notifications').set(bearer(w.customer.token))).body.items[0].id;
      expect((await api(t).get('/v1/me/notifications').set(bearer(other.token))).body.items).toHaveLength(0);
      expect((await api(t).post(`/v1/me/notifications/${mine}/read`).set(bearer(other.token))).status).toBe(404);
      expect((await api(t).get('/v1/me/notifications').set(bearer(w.token))).status).toBe(403);
      expect((await api(t).get('/v1/me/notifications')).status).toBe(401);
      expect((await api(t).post('/v1/me/notifications/pas-un-uuid/read').set(bearer(w.customer.token))).status).toBe(400);
    });
  });

  // =============================================================================================
  describe('isolation et intégrité', () => {
    it('une entreprise ne voit ni ne relance les notifications d’une autre', async () => {
      const a = await setup();
      const b = await setup();
      jest.spyOn(t.mail, 'send').mockRejectedValue(new Error('panne'));
      await makePrealert(t, a.customer, a.warehouse.id);
      let now = new Date(Date.now() + 2000);
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        await processNotifications(t, a.company.id, now);
        now = minutes(now, 121);
      }
      const failed = (await notifications(a, { status: 'FAILED' }))[0];
      expect(failed).toBeTruthy();
      jest.restoreAllMocks();
      expect((await api(t).get('/v1/admin/notifications').set(bearer(b.token))).body.items).toHaveLength(0);
      expect(errorCode(await api(t).post(`/v1/admin/notifications/${failed.id}/retry`).set(bearer(b.token)))).toBe('NOTIFICATION_NOT_FOUND');
      expect((await api(t).get('/v1/admin/notifications').set(bearer(a.token))).body.items.length).toBeGreaterThan(0);
      // les modèles de A n'affectent pas B
      await putTemplate(a, { eventCode: 'prealert.created', channel: 'EMAIL', locale: 'fr', subject: 'Spécifique A', body: 'A' });
      const listB = await api(t).get('/v1/admin/notification-templates').set(bearer(b.token));
      expect(listB.body.items.every((i: any) => i.source === 'DEFAULT')).toBe(true);
    });

    it('filtres et pagination du journal', async () => {
      const w = await setup();
      await makePrealert(t, w.customer, w.warehouse.id);
      await processNotifications(t, w.company.id);
      const ids = async (q: string) => (await api(t).get(`/v1/admin/notifications${q}`).set(bearer(w.token))).body.items.map((n: any) => n.channel);
      expect((await ids('?channel=EMAIL')).every((c: string) => c === 'EMAIL')).toBe(true);
      expect(await ids('?channel=IN_APP&status=SENT')).toEqual(['IN_APP']);
      expect(await ids('?eventCode=package.received')).toEqual([]);
      const page = await api(t).get('/v1/admin/notifications?limit=1').set(bearer(w.token));
      expect(page.body.nextCursor).toBeTruthy();
      expect((await api(t).get('/v1/admin/notifications?channel=FAX').set(bearer(w.token))).status).toBe(400);
    });

    it('la base : le contenu d’un événement et d’une notification ne se modifie pas', async () => {
      const w = await setup();
      await makePrealert(t, w.customer, w.warehouse.id);
      await processNotifications(t, w.company.id);
      const event = await t.admin.outboxEvent.findFirstOrThrow({ where: { companyId: w.company.id } });
      await expect(t.admin.outboxEvent.update({ where: { id: event.id }, data: { payload: { customerName: 'Autre' } } })).rejects.toThrow(/immuable/);
      const n = (await notifications(w, { channel: 'EMAIL' }))[0];
      await expect(t.admin.notification.update({ where: { id: n.id }, data: { body: 'Texte falsifié' } })).rejects.toThrow(/immuable/);
      await expect(t.admin.notification.update({ where: { id: n.id }, data: { customerId: uuidv7() } })).rejects.toThrow();
    });

    it('sans fuite : l’e-mail ne contient aucun mot de passe, jeton ni identifiant interne', async () => {
      const w = await setup();
      await makePrealert(t, w.customer, w.warehouse.id);
      await processNotifications(t, w.company.id);
      const text = mailsTo(t, w.customer.user.email)[0].text;
      expect(text).not.toMatch(/token|password|mot de passe|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    });
  });
});
