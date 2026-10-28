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
  readyPackage,
  weighedPackage,
  type CustomerSession,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;
const today = () => new Date().toISOString().slice(0, 10);
const addressBody = (overrides: Record<string, unknown> = {}) => ({ kind: 'DELIVERY', label: 'Maison', recipientName: 'Marie Jean', line1: '12 rue des Palmistes', city: 'Pétion-Ville', country: 'ht', ...overrides });

describe('Livraison : tournées, remise, code, tentatives', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  async function setup(options: { policy?: 'PAY_BEFORE_SHIPMENT' | 'PAY_BEFORE_RELEASE' } = {}) {
    const tenant = await makeTenant(t);
    if (options.policy) await t.admin.company.update({ where: { id: tenant.company.id }, data: { paymentPolicy: options.policy } });
    const w1 = await makeWarehouse(t, tenant.token, { city: 'Miami' });
    await activateRateCard(t, tenant.token);
    const agency = await makeAgency(t, tenant.token, { name: 'Agence Delmas', city: 'Delmas' });
    const otherAgency = await makeAgency(t, tenant.token, { name: 'Agence Cap', city: 'Cap-Haïtien' });
    const customer = await makeCustomer(t, tenant.company);
    const other = await makeCustomer(t, tenant.company);
    for (const c of [customer, other]) expect((await api(t).post('/v1/me/addresses').set(bearer(c.token)).send(addressBody())).status).toBe(201);
    const staff = async (roleCode: 'AGENCY_MANAGER' | 'DRIVER' | 'CUSTOMER_SERVICE' | 'LOGISTICS_MANAGER', scope?: { type: 'AGENCY'; id: string }) => {
      const user = await makeUser(t, { company: tenant.company, roleCode, scope });
      return { user, token: (await login(t, user)).accessToken };
    };
    const manager = await staff('AGENCY_MANAGER', { type: 'AGENCY', id: agency.id });
    const otherManager = await staff('AGENCY_MANAGER', { type: 'AGENCY', id: otherAgency.id });
    const driver = await staff('DRIVER');
    const driver2 = await staff('DRIVER');
    return { ...tenant, w1, agency, otherAgency, customer, other, staff, manager, otherManager, driver, driver2 };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const createRoute = (token: string, body: Record<string, unknown>) => api(t).post('/v1/admin/routes').set(bearer(token)).send(body);
  const routeBody = (w: World, overrides: Record<string, unknown> = {}) => ({ agencyId: w.agency.id, driverUserId: w.driver.user.id, plannedDate: today(), ...overrides });
  const act = (token: string, routeId: string, action: string) => api(t).post(`/v1/admin/routes/${routeId}/${action}`).set(bearer(token));
  const addStop = (token: string, routeId: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/routes/${routeId}/stops`).set(bearer(token)).send(body);
  const deliver = (token: string, stopId: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/route-stops/${stopId}/deliver`).set(bearer(token)).send(body);
  const fail = (token: string, stopId: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/route-stops/${stopId}/fail`).set(bearer(token)).send(body);
  const handover = (token: string, packageId: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/packages/${packageId}/handover`).set(bearer(token)).send(body);
  const makeCode = async (c: CustomerSession, packageId: string) => {
    const res = await api(t).post(`/v1/me/packages/${packageId}/handover-code`).set(bearer(c.token));
    expect(res.status).toBe(200);
    return res.body.code as string;
  };
  const pkgStatus = async (id: string) => (await t.admin.package.findUniqueOrThrow({ where: { id } })).status;
  const relaxed = (w: World) => api(t).put('/v1/admin/settings/delivery').set(bearer(w.token)).send({ requireOtp: false, requireIdDocument: false, requirePhoto: false });
  const customerBody = (extra: Record<string, unknown> = {}) => ({ recipientKind: 'CUSTOMER', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', ...extra });

  /** Colis arrivé à l'agence puis « prêt pour retrait » par le chemin réel (lot, départ, arrivée, réception, retrait). */
  async function atAgency(w: World, customer: CustomerSession = w.customer, options: { unpaid?: boolean } = {}) {
    let pkg: { packageId: string; trackingNumber: string };
    if (options.unpaid) {
      // facturé et non payé : autorisé à partir à la main (motif), la facture reste due
      const weighed = await weighedPackage(t, w, customer, w.w1.id);
      const customerId = await customerIdOf(t, customer);
      const draft = await api(t).post('/v1/admin/invoices').set(bearer(w.token)).send({ customerId, packageIds: [weighed.packageId] });
      expect(draft.status).toBe(201);
      expect((await api(t).post(`/v1/admin/invoices/${draft.body.id}/issue`).set(bearer(w.token))).status).toBe(200);
      if ((await pkgStatus(weighed.packageId)) === 'AWAITING_PAYMENT') {
        const authorized = await api(t).post(`/v1/admin/packages/${weighed.packageId}/transitions`).set(bearer(w.token)).send({ to: 'READY_TO_SHIP', reason: 'Dérogation commerciale (test)' });
        expect(authorized.status).toBe(200);
      }
      pkg = weighed;
    } else {
      pkg = await readyPackage(t, w, customer, w.w1.id);
    }
    const shipment = await api(t).post('/v1/admin/shipments').set(bearer(w.token)).send({ transportMode: 'AIR', originWarehouseId: w.w1.id, destinationCountry: 'HT', destinationAgencyId: w.agency.id });
    expect(shipment.status).toBe(201);
    expect((await api(t).post(`/v1/admin/shipments/${shipment.body.id}/packages`).set(bearer(w.token)).send({ packageId: pkg.packageId })).status).toBe(200);
    for (const step of ['dispatch', 'arrive']) expect((await api(t).post(`/v1/admin/shipments/${shipment.body.id}/${step}`).set(bearer(w.token)).send({})).status).toBe(200);
    expect((await api(t).post(`/v1/admin/agencies/${w.agency.id}/receive`).set(bearer(w.manager.token)).send({ code: pkg.trackingNumber })).status).toBe(200);
    expect((await api(t).post(`/v1/admin/agencies/${w.agency.id}/packages/${pkg.packageId}/ready-for-pickup`).set(bearer(w.manager.token)).send({})).status).toBe(200);
    return pkg;
  }

  /** Tournée démarrée avec un colis : renvoie la tournée, l'arrêt et le colis. */
  async function startedRoute(w: World, customer: CustomerSession = w.customer, options: { unpaid?: boolean; driver?: { user: { id: string } } } = {}) {
    const pkg = await atAgency(w, customer, options);
    const route = (await createRoute(w.token, routeBody(w, options.driver ? { driverUserId: options.driver.user.id } : {}))).body;
    const stop = await addStop(w.token, route.id, { packageId: pkg.packageId });
    expect(stop.status).toBe(201);
    const started = await act(w.token, route.id, 'start');
    expect(started.status).toBe(200);
    return { pkg, route, stop: stop.body as { id: string } };
  }

  // =============================================================================================
  describe('réglages de la remise', () => {
    it('par défaut : code et pièce exigés, photo non ; une modification partielle garde le reste', async () => {
      const w = await setup();
      expect((await api(t).get('/v1/admin/settings/delivery').set(bearer(w.token))).body).toEqual({ requireOtp: true, requireIdDocument: true, requirePhoto: false });
      const changed = await api(t).put('/v1/admin/settings/delivery').set(bearer(w.token)).send({ requirePhoto: true });
      expect(changed.body).toEqual({ requireOtp: true, requireIdDocument: true, requirePhoto: true });
      expect((await api(t).put('/v1/admin/settings/delivery').set(bearer(w.token)).send({})).status).toBe(400);
      expect((await api(t).put('/v1/admin/settings/delivery').set(bearer(w.customer.token)).send({ requireOtp: false })).status).toBe(403);
      expect(await t.admin.auditLog.count({ where: { companyId: w.company.id, action: 'settings.delivery_updated' } })).toBe(1);
    });
  });

  // =============================================================================================
  describe('tournées', () => {
    it('crée une tournée référencée TOU-AAAA-NNNNNN pour un livreur ; refuse un livreur invalide', async () => {
      const w = await setup();
      const first = await createRoute(w.token, routeBody(w));
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ status: 'PLANNED', plannedDate: today(), stopCount: 0, agency: { id: w.agency.id }, driver: { id: w.driver.user.id } });
      expect(first.body.reference).toBe(`TOU-${new Date().getUTCFullYear()}-000001`);
      expect((await createRoute(w.token, routeBody(w))).body.reference).toMatch(/-000002$/);

      const notDriver = await createRoute(w.token, routeBody(w, { driverUserId: w.manager.user.id }));
      expect(errorCode(notDriver)).toBe('DRIVER_INVALID');
      expect(errorCode(await createRoute(w.token, routeBody(w, { driverUserId: w.customer.user.id })))).toBe('DRIVER_INVALID');
      expect((await createRoute(w.token, routeBody(w, { agencyId: uuidv7() }))).status).toBe(404);
      expect((await createRoute(w.token, routeBody(w, { plannedDate: 'demain' }))).status).toBe(400);
      expect((await createRoute(w.token, routeBody(w, { extra: 1 }))).status).toBe(400);
      await t.admin.user.update({ where: { id: w.driver2.user.id }, data: { status: 'DISABLED' } });
      expect(errorCode(await createRoute(w.token, routeBody(w, { driverUserId: w.driver2.user.id })))).toBe('DRIVER_INVALID');
    });

    it('l’administrateur de l’entreprise peut inviter un livreur (aucune escalade de droits à contourner)', async () => {
      const w = await setup();
      const email = `livreur-${Date.now()}@test.example`;
      const invited = await api(t).post('/v1/admin/users').set(bearer(w.token)).send({ email, firstName: 'Nouveau', lastName: 'Livreur', roles: [{ roleCode: 'DRIVER', scopeType: 'COMPANY' }] });
      expect(invited.status).toBe(201);
    });

    it('droits : seul le responsable de l’agence planifie ; ni le livreur, ni le client, ni une autre agence', async () => {
      const w = await setup();
      expect((await createRoute(w.manager.token, routeBody(w))).status).toBe(201);
      expect((await createRoute(w.otherManager.token, routeBody(w))).status).toBe(403);
      expect((await createRoute(w.driver.token, routeBody(w))).status).toBe(403);
      expect((await createRoute(w.customer.token, routeBody(w))).status).toBe(403);
      expect((await api(t).post('/v1/admin/routes').send(routeBody(w))).status).toBe(401);
    });

    it('ajoute un colis arrivé : adresse figée, client prévenu de la date ; refuse mauvaise agence, colis non prêt, adresse absente, doublon', async () => {
      const w = await setup();
      const route = (await createRoute(w.token, routeBody(w))).body;
      const pkg = await atAgency(w);
      const stop = await addStop(w.token, route.id, { packageId: pkg.packageId, instructions: 'Portail bleu' });
      expect(stop.status).toBe(201);
      expect(stop.body).toMatchObject({ sequence: 1, status: 'PENDING', instructions: 'Portail bleu', address: { line1: '12 rue des Palmistes', city: 'Pétion-Ville' } });
      const events = await t.admin.outboxEvent.findMany({ where: { companyId: w.company.id, eventCode: 'delivery.scheduled' } });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ plannedDate: today() });

      // le client modifie son adresse : l'arrêt garde celle de la planification
      const address = await t.admin.customerAddress.findFirstOrThrow({ where: { customerId: stop.body.customer.id } });
      await t.admin.customerAddress.update({ where: { id: address.id }, data: { line1: 'Adresse changée' } });
      const read = await api(t).get(`/v1/admin/routes/${route.id}`).set(bearer(w.token));
      expect(read.body.stops[0].address.line1).toBe('12 rue des Palmistes');

      const second = (await createRoute(w.token, routeBody(w))).body;
      expect(errorCode(await addStop(w.token, second.id, { packageId: pkg.packageId }))).toBe('ALREADY_ON_ROUTE');
      const notArrived = await readyPackage(t, w, w.customer, w.w1.id);
      expect(errorCode(await addStop(w.token, second.id, { packageId: notArrived.packageId }))).toBe('WRONG_AGENCY');
      expect((await addStop(w.token, second.id, { packageId: uuidv7() })).status).toBe(404);

      // client sans adresse de livraison
      const bare = await makeCustomer(t, w.company);
      const barePkg = await atAgency(w, bare);
      expect(errorCode(await addStop(w.token, second.id, { packageId: barePkg.packageId }))).toBe('NO_DELIVERY_ADDRESS');
    });

    it('départ : les colis passent « en cours de livraison » ; tout ou rien si un colis n’est plus prêt', async () => {
      const w = await setup();
      const a = await atAgency(w);
      const b = await atAgency(w);
      const route = (await createRoute(w.token, routeBody(w))).body;
      expect(errorCode(await act(w.token, route.id, 'start'))).toBe('ROUTE_EMPTY');
      await addStop(w.token, route.id, { packageId: a.packageId });
      await addStop(w.token, route.id, { packageId: b.packageId });
      await api(t).post(`/v1/admin/packages/${b.packageId}/transitions`).set(bearer(w.token)).send({ to: 'ON_HOLD', reason: 'Contrôle', holdReasonCode: 'OTHER' });
      const refused = await act(w.token, route.id, 'start');
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('PACKAGES_NOT_READY');
      expect(await pkgStatus(a.packageId)).toBe('READY_FOR_PICKUP'); // rien n'a bougé
      expect((await api(t).get(`/v1/admin/routes/${route.id}`).set(bearer(w.token))).body.status).toBe('PLANNED');

      const stops = (await api(t).get(`/v1/admin/routes/${route.id}`).set(bearer(w.token))).body.stops;
      expect((await api(t).delete(`/v1/admin/routes/${route.id}/stops/${stops[1].id}`).set(bearer(w.token))).status).toBe(204);
      const started = await act(w.token, route.id, 'start');
      expect(started.body).toMatchObject({ status: 'IN_PROGRESS' });
      expect(await pkgStatus(a.packageId)).toBe('OUT_FOR_DELIVERY');
      expect(errorCode(await act(w.token, route.id, 'start'))).toBe('ROUTE_NOT_PLANNED');
      expect(errorCode(await addStop(w.token, route.id, { packageId: b.packageId }))).toBe('ROUTE_NOT_PLANNED');
    });

    it('une tournée annulée libère ses colis ; elle ne change plus ensuite (base)', async () => {
      const w = await setup();
      const pkg = await atAgency(w);
      const route = (await createRoute(w.token, routeBody(w))).body;
      await addStop(w.token, route.id, { packageId: pkg.packageId });
      expect((await act(w.token, route.id, 'cancel')).body.status).toBe('CANCELLED');
      const again = (await createRoute(w.token, routeBody(w))).body;
      expect((await addStop(w.token, again.id, { packageId: pkg.packageId })).status).toBe(201); // le colis est libre
      await expect(t.admin.route.update({ where: { id: route.id }, data: { notes: 'après annulation' } })).rejects.toThrow(/terminée ou annulée/);
      await expect(t.admin.route.delete({ where: { id: route.id } })).rejects.toThrow(/ne se supprime pas/);
      expect(errorCode(await act(w.token, route.id, 'cancel'))).toBe('ROUTE_NOT_PLANNED');
    });

    it('terminer exige que tous les arrêts soient traités', async () => {
      const w = await setup();
      await relaxed(w);
      const { route, stop } = await startedRoute(w);
      const refused = await act(w.token, route.id, 'complete');
      expect(errorCode(refused)).toBe('ROUTE_HAS_PENDING_STOPS');
      expect(refused.body.error.details.pending).toBe(1);
      expect((await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER' })).status).toBe(200);
      const done = await act(w.token, route.id, 'complete');
      expect(done.body).toMatchObject({ status: 'COMPLETED' });
      expect(done.body.completedAt).toBeTruthy();
      await expect(t.admin.routeStop.update({ where: { id: stop.id }, data: { instructions: 'x' } })).rejects.toThrow(/traité ne change plus/);
    });
  });

  // =============================================================================================
  describe('le livreur ne voit que ses tournées (DEL-04)', () => {
    it('liste et détail réservés à la tournée du livreur ; un autre livreur ou une autre agence reçoit un 404', async () => {
      const w = await setup();
      await startedRoute(w, w.customer, { driver: w.driver });
      const second = await startedRoute(w, w.other, { driver: w.driver2 });
      const mine = await api(t).get('/v1/admin/my-routes').set(bearer(w.driver.token));
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.items[0].driver.id).toBe(w.driver.user.id);
      expect((await api(t).get(`/v1/admin/my-routes/${second.route.id}`).set(bearer(w.driver.token))).status).toBe(404);
      const detail = await api(t).get(`/v1/admin/my-routes/${mine.body.items[0].id}`).set(bearer(w.driver.token));
      expect(detail.status).toBe(200);
      expect(detail.body.stops[0]).toMatchObject({ address: { line1: '12 rue des Palmistes' }, customer: { customerCode: w.customer.customerCode } });
      expect(detail.body.stops[0].balanceDue).toBeNull(); // pas d'argent pour le livreur

      // pas d'accès aux listes de gestion, ni aux tournées d'autrui par les routes de gestion
      expect((await api(t).get('/v1/admin/routes').set(bearer(w.driver.token))).status).toBe(403);
      expect((await api(t).get(`/v1/admin/routes/${second.route.id}`).set(bearer(w.driver.token))).status).toBe(403);
      // responsable de l'agence : voit toutes les tournées de SON agence, pas celles d'une autre
      expect((await api(t).get('/v1/admin/routes').set(bearer(w.manager.token))).body.items).toHaveLength(2);
      expect((await api(t).get('/v1/admin/routes').set(bearer(w.otherManager.token))).body.items).toHaveLength(0);
      expect((await api(t).get(`/v1/admin/routes/${second.route.id}`).set(bearer(w.otherManager.token))).status).toBe(404);
      // le client n'a aucune de ces routes
      expect((await api(t).get('/v1/admin/my-routes').set(bearer(w.customer.token))).status).toBe(403);
    });

    it('un livreur ne confirme ni n’échoue l’arrêt d’un autre livreur, ni la remise au comptoir', async () => {
      const w = await setup();
      await relaxed(w);
      const { stop, pkg } = await startedRoute(w, w.customer, { driver: w.driver });
      expect((await deliver(w.driver2.token, stop.id, { recipientKind: 'CUSTOMER' })).status).toBe(404);
      expect((await fail(w.driver2.token, stop.id, { reason: 'ABSENT' })).status).toBe(404);
      expect((await deliver(w.otherManager.token, stop.id, { recipientKind: 'CUSTOMER' })).status).toBe(404);
      expect((await handover(w.driver.token, pkg.packageId, { recipientKind: 'CUSTOMER' })).status).toBe(404);
      expect(await pkgStatus(pkg.packageId)).toBe('OUT_FOR_DELIVERY');
      expect((await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER' })).status).toBe(200);
    });
  });

  // =============================================================================================
  describe('code de remise', () => {
    it('le client génère un code à 6 chiffres, montré une fois ; un nouveau code annule le précédent ; seule l’empreinte est conservée', async () => {
      const w = await setup();
      const pkg = await atAgency(w);
      const first = await api(t).post(`/v1/me/packages/${pkg.packageId}/handover-code`).set(bearer(w.customer.token));
      expect(first.body.code).toMatch(/^\d{6}$/);
      expect(new Date(first.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);
      const stored = await t.admin.handoverCode.findMany({ where: { packageId: pkg.packageId } });
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(first.body.code);
      expect(stored[0].codeHash).toMatch(/^[0-9a-f]{64}$/);

      await makeCode(w.customer, pkg.packageId);
      const all = await t.admin.handoverCode.findMany({ where: { packageId: pkg.packageId }, orderBy: { createdAt: 'asc' } });
      expect(all.map((c) => c.revokedAt !== null)).toEqual([true, false]);
      await expect(t.admin.handoverCode.update({ where: { id: all[1].id }, data: { codeHash: 'a'.repeat(64) } })).rejects.toThrow(/ne se modifie pas/);
      await expect(t.admin.handoverCode.delete({ where: { id: all[1].id } })).rejects.toThrow(/ne se supprime pas/);
    });

    it('colis d’un autre client, colis pas encore en agence, personnel, anonyme : refusés ; 5 codes par heure', async () => {
      const w = await setup();
      const pkg = await atAgency(w);
      expect((await api(t).post(`/v1/me/packages/${pkg.packageId}/handover-code`).set(bearer(w.other.token))).status).toBe(404);
      expect((await api(t).post(`/v1/me/packages/${pkg.packageId}/handover-code`).set(bearer(w.manager.token))).status).toBe(403);
      expect((await api(t).post(`/v1/me/packages/${pkg.packageId}/handover-code`)).status).toBe(401);
      const early = await readyPackage(t, w, w.customer, w.w1.id);
      const refused = await api(t).post(`/v1/me/packages/${early.packageId}/handover-code`).set(bearer(w.customer.token));
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('INVALID_STATE');
      for (let i = 0; i < 5; i += 1) await makeCode(w.customer, pkg.packageId);
      const sixth = await api(t).post(`/v1/me/packages/${pkg.packageId}/handover-code`).set(bearer(w.customer.token));
      expect(sixth.status).toBe(429);
      expect(errorCode(sixth)).toBe('TOO_MANY_CODES');
    });
  });

  // =============================================================================================
  describe('remise par le livreur', () => {
    it('exige le code et la pièce ; un code faux est compté, 5 erreurs verrouillent, un nouveau code débloque', async () => {
      const w = await setup();
      const { stop, pkg } = await startedRoute(w, w.customer, { driver: w.driver });
      const noOtp = await deliver(w.driver.token, stop.id, customerBody());
      expect(errorCode(noOtp)).toBe('OTP_REQUIRED');
      expect(errorCode(await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER', otp: '123456' }))).toBe('ID_DOCUMENT_REQUIRED');
      expect(errorCode(await deliver(w.driver.token, stop.id, customerBody({ otp: '123456' })))).toBe('OTP_NOT_AVAILABLE'); // le client n'a pas encore de code
      expect((await deliver(w.driver.token, stop.id, customerBody({ otp: '12ab56' }))).status).toBe(400);

      const code = await makeCode(w.customer, pkg.packageId);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 1; i <= 4; i += 1) {
        const res = await deliver(w.driver.token, stop.id, customerBody({ otp: wrong }));
        expect(res.status).toBe(422);
        expect(errorCode(res)).toBe('OTP_INVALID');
        expect(res.body.error.details.remaining).toBe(5 - i);
      }
      expect(errorCode(await deliver(w.driver.token, stop.id, customerBody({ otp: wrong })))).toBe('OTP_INVALID'); // 5e erreur : verrouillé
      // même le bon code est refusé : il faut un nouveau code
      expect(errorCode(await deliver(w.driver.token, stop.id, customerBody({ otp: code })))).toBe('OTP_NOT_AVAILABLE');
      const fresh = await makeCode(w.customer, pkg.packageId);
      expect((await deliver(w.driver.token, stop.id, customerBody({ otp: fresh }))).status).toBe(200);
      expect(await pkgStatus(pkg.packageId)).toBe('DELIVERED');
    });

    it('remise réussie : statut, arrêt, tentative avec les 4 derniers caractères de la pièce, code consommé, client notifié, historique public sobre', async () => {
      const w = await setup();
      const { stop, pkg, route } = await startedRoute(w, w.customer, { driver: w.driver });
      const code = await makeCode(w.customer, pkg.packageId);
      const res = await deliver(w.driver.token, stop.id, customerBody({ otp: code, recipientName: 'Marie Jean' }));
      expect(res.status).toBe(200);
      expect(await pkgStatus(pkg.packageId)).toBe('DELIVERED');
      expect((await t.admin.routeStop.findUniqueOrThrow({ where: { id: stop.id } })).status).toBe('DELIVERED');
      const attempt = await t.admin.deliveryAttempt.findFirstOrThrow({ where: { packageId: pkg.packageId } });
      expect(attempt).toMatchObject({ channel: 'ROUTE', outcome: 'SUCCEEDED', recipientKind: 'CUSTOMER', recipientName: 'Marie Jean', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', otpVerified: true, balanceOverridden: false, actorUserId: w.driver.user.id });
      expect((await t.admin.handoverCode.findFirstOrThrow({ where: { packageId: pkg.packageId } })).usedAt).not.toBeNull();
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id, eventCode: 'package.delivered' } })).toBe(1);

      const pub = await api(t).get(`/v1/public/tracking/${pkg.trackingNumber}`);
      const last = pub.body.events[pub.body.events.length - 1];
      expect(last).toMatchObject({ status: 'DELIVERED', location: 'Delmas' });
      expect(JSON.stringify(pub.body)).not.toMatch(/Marie Jean|4821|NATIONAL_ID/);

      expect(errorCode(await deliver(w.driver.token, stop.id, customerBody({ otp: code })))).toBe('STOP_ALREADY_HANDLED');
      expect(errorCode(await act(w.token, route.id, 'start'))).toBe('ROUTE_NOT_PLANNED');
      // un colis remis ne se remet pas, et un code consommé ne sert plus
      expect((await api(t).post(`/v1/me/packages/${pkg.packageId}/handover-code`).set(bearer(w.customer.token))).status).toBe(409);
    });

    it('bénéficiaire : doit être inscrit, actif et dans ses dates ; la pièce doit correspondre', async () => {
      const w = await setup();
      await api(t).put('/v1/admin/settings/delivery').set(bearer(w.token)).send({ requireOtp: false });
      const { stop } = await startedRoute(w, w.customer, { driver: w.driver });
      const mk = async (overrides: Record<string, unknown> = {}) =>
        (await api(t).post('/v1/me/beneficiaries').set(bearer(w.customer.token)).send({ fullName: 'Jean Baptiste', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', validFrom: '2026-01-01', validTo: '2026-12-31', ...overrides })).body.id as string;
      const good = await mk();
      const expired = await mk({ validFrom: '2025-01-01', validTo: '2025-02-01' });
      const revoked = await mk();
      await api(t).delete(`/v1/me/beneficiaries/${revoked}`).set(bearer(w.customer.token));
      const foreign = (await api(t).post('/v1/me/beneficiaries').set(bearer(w.other.token)).send({ fullName: 'Autre', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '9999' })).body.id as string;

      expect((await deliver(w.driver.token, stop.id, { recipientKind: 'BENEFICIARY', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821' })).status).toBe(400); // beneficiaryId manquant
      expect((await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER', beneficiaryId: good })).status).toBe(400);
      for (const id of [expired, revoked, foreign, uuidv7()]) {
        const res = await deliver(w.driver.token, stop.id, { recipientKind: 'BENEFICIARY', beneficiaryId: id, idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821' });
        expect(errorCode(res)).toBe('BENEFICIARY_INVALID');
      }
      const mismatch = await deliver(w.driver.token, stop.id, { recipientKind: 'BENEFICIARY', beneficiaryId: good, idDocumentType: 'NATIONAL_ID', idDocumentLast4: '0000' });
      expect(errorCode(mismatch)).toBe('ID_MISMATCH');
      const ok = await deliver(w.driver.token, stop.id, { recipientKind: 'BENEFICIARY', beneficiaryId: good, idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821' });
      expect(ok.status).toBe(200);
      expect(await t.admin.deliveryAttempt.findFirstOrThrow({ where: { beneficiaryId: good } })).toMatchObject({ recipientKind: 'BENEFICIARY', recipientName: 'Jean Baptiste' });
    });

    it('photo de preuve : exigée si la règle le demande, et doit être une photo jointe à CE colis', async () => {
      const w = await setup();
      await api(t).put('/v1/admin/settings/delivery').set(bearer(w.token)).send({ requireOtp: false, requireIdDocument: false, requirePhoto: true });
      const { stop, pkg } = await startedRoute(w, w.customer, { driver: w.driver });
      expect(errorCode(await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER' }))).toBe('PROOF_PHOTO_REQUIRED');
      const file = (ownerId: string, kind: 'PHOTO' | 'INVOICE') =>
        t.admin.fileObject.create({ data: { companyId: w.company.id, ownerType: 'PACKAGE', ownerId, kind, storageKey: `companies/${w.company.id}/${uuidv7()}`, originalName: 'preuve.jpg', mimeType: 'image/jpeg', sizeBytes: 10, sha256: 'a'.repeat(64) } });
      const elsewhere = await atAgency(w, w.other);
      for (const bad of [await file(elsewhere.packageId, 'PHOTO'), await file(pkg.packageId, 'INVOICE')]) {
        expect(errorCode(await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER', proofFileId: bad.id }))).toBe('PROOF_FILE_INVALID');
      }
      expect(errorCode(await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER', proofFileId: uuidv7() }))).toBe('PROOF_FILE_INVALID');
      const good = await file(pkg.packageId, 'PHOTO');
      expect((await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER', proofFileId: good.id })).status).toBe(200);
      expect((await t.admin.deliveryAttempt.findFirstOrThrow({ where: { packageId: pkg.packageId } })).proofFileId).toBe(good.id);
    });
  });

  // =============================================================================================
  describe('solde dû (DEL-05)', () => {
    it('facture impayée : la remise est refusée avec le montant ; le livreur ne peut pas déroger', async () => {
      const w = await setup();
      await relaxed(w);
      const { stop, pkg } = await startedRoute(w, w.customer, { driver: w.driver, unpaid: true });
      const refused = await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER' });
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('BALANCE_DUE');
      expect(refused.body.error.details).toMatchObject({ due: '9.50', currency: 'USD', unbilled: false });
      expect(await pkgStatus(pkg.packageId)).toBe('OUT_FOR_DELIVERY');
      const override = await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER', overrideBalance: { reason: 'Client de confiance' } });
      expect(errorCode(override)).toBe('OVERRIDE_NOT_ALLOWED');
      expect(override.status).toBe(403);
      expect(await pkgStatus(pkg.packageId)).toBe('OUT_FOR_DELIVERY');
    });

    it('dérogation par le responsable de l’agence : motif obligatoire, tracée dans la tentative et le journal', async () => {
      const w = await setup();
      await relaxed(w);
      const { stop, pkg } = await startedRoute(w, w.customer, { driver: w.driver, unpaid: true });
      expect((await deliver(w.manager.token, stop.id, { recipientKind: 'CUSTOMER', overrideBalance: {} })).status).toBe(400);
      const ok = await deliver(w.manager.token, stop.id, { recipientKind: 'CUSTOMER', overrideBalance: { reason: 'Paiement promis demain' } });
      expect(ok.status).toBe(200);
      expect(await pkgStatus(pkg.packageId)).toBe('DELIVERED');
      expect(await t.admin.deliveryAttempt.findFirstOrThrow({ where: { packageId: pkg.packageId } })).toMatchObject({ balanceOverridden: true, overrideReason: 'Paiement promis demain', actorUserId: w.manager.user.id });
      const audit = await t.admin.auditLog.findFirstOrThrow({ where: { companyId: w.company.id, action: 'delivery.completed_with_override', entityId: pkg.packageId } });
      expect(audit.after).toMatchObject({ balanceOverridden: true, overrideReason: 'Paiement promis demain' });
    });

    it('paiement à la remise : un colis jamais facturé est bloqué ; une fois la facture payée, plus de blocage', async () => {
      const w = await setup({ policy: 'PAY_BEFORE_RELEASE' });
      await relaxed(w);
      const unbilled = await startedRoute(w, w.customer, { driver: w.driver });
      const refused = await deliver(w.driver.token, unbilled.stop.id, { recipientKind: 'CUSTOMER' });
      expect(errorCode(refused)).toBe('BALANCE_DUE');
      expect(refused.body.error.details.unbilled).toBe(true);

      // facture émise puis payée en espèces : la remise passe sans dérogation
      const w2 = await setup({ policy: 'PAY_BEFORE_RELEASE' });
      await relaxed(w2);
      const paid = await startedRoute(w2, w2.customer, { driver: w2.driver, unpaid: true });
      expect(errorCode(await deliver(w2.driver.token, paid.stop.id, { recipientKind: 'CUSTOMER' }))).toBe('BALANCE_DUE');
      const invoice = await t.admin.invoicePackage.findFirstOrThrow({ where: { packageId: paid.pkg.packageId }, include: { invoice: true } });
      expect((await api(t).post('/v1/admin/cash-sessions').set(bearer(w2.token)).send({})).status).toBe(201);
      expect((await api(t).post('/v1/admin/payments/cash').set(bearer(w2.token)).send({ invoiceId: invoice.invoiceId, amount: 9.5 })).status).toBe(201);
      expect((await deliver(w2.driver.token, paid.stop.id, { recipientKind: 'CUSTOMER' })).status).toBe(200);
    });
  });

  // =============================================================================================
  describe('remise au comptoir de l’agence', () => {
    it('colis « prêt pour retrait » : code et pièce vérifiés, solde contrôlé ; hors périmètre = 404', async () => {
      const w = await setup();
      const pkg = await atAgency(w);
      expect((await handover(w.otherManager.token, pkg.packageId, customerBody({ otp: '123456' }))).status).toBe(404);
      expect((await handover(w.customer.token, pkg.packageId, customerBody())).status).toBe(403);
      expect((await handover(w.manager.token, pkg.packageId, customerBody())).status).toBe(422);
      const code = await makeCode(w.customer, pkg.packageId);
      expect((await handover(w.manager.token, pkg.packageId, customerBody({ otp: code }))).status).toBe(200);
      expect(await pkgStatus(pkg.packageId)).toBe('DELIVERED');
      expect(await t.admin.deliveryAttempt.findFirstOrThrow({ where: { packageId: pkg.packageId } })).toMatchObject({ channel: 'AGENCY', outcome: 'SUCCEEDED' });
      // déjà remis : plus rien à faire
      expect(errorCode(await handover(w.manager.token, pkg.packageId, customerBody({ otp: code })))).toBe('INVALID_STATE');
    });

    it('un colis en cours de livraison ne se remet pas au comptoir ; l’historique des tentatives est lisible par l’agence', async () => {
      const w = await setup();
      await relaxed(w);
      const { pkg, stop } = await startedRoute(w, w.customer, { driver: w.driver });
      expect(errorCode(await handover(w.manager.token, pkg.packageId, { recipientKind: 'CUSTOMER' }))).toBe('INVALID_STATE');
      await fail(w.driver.token, stop.id, { reason: 'ABSENT' });
      const list = await api(t).get(`/v1/admin/packages/${pkg.packageId}/delivery-attempts`).set(bearer(w.manager.token));
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ outcome: 'FAILED', failureReason: 'ABSENT', channel: 'ROUTE' });
      expect((await api(t).get(`/v1/admin/packages/${pkg.packageId}/delivery-attempts`).set(bearer(w.otherManager.token))).status).toBe(404);
      expect((await api(t).get(`/v1/admin/packages/${pkg.packageId}/delivery-attempts`).set(bearer(w.driver.token))).status).toBe(403);
    });
  });

  // =============================================================================================
  describe('livraison non aboutie', () => {
    it('le colis revient « prêt pour retrait », le client reçoit UN message adapté, la reprogrammation est notée', async () => {
      const w = await setup();
      await relaxed(w);
      const { pkg, stop } = await startedRoute(w, w.customer, { driver: w.driver });
      const before = await t.admin.outboxEvent.count({ where: { companyId: w.company.id, eventCode: 'package.available_at_agency' } });
      const res = await fail(w.driver.token, stop.id, { reason: 'ABSENT', note: 'Personne à la maison', rescheduleFor: '2026-12-01' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ failed: true, failedAttempts: 1, returnSuggested: false });
      expect(await pkgStatus(pkg.packageId)).toBe('READY_FOR_PICKUP');
      expect((await t.admin.routeStop.findUniqueOrThrow({ where: { id: stop.id } })).status).toBe('FAILED');
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id, eventCode: 'delivery.failed' } })).toBe(1);
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id, eventCode: 'package.available_at_agency' } })).toBe(before); // pas de message en double
      expect(await t.admin.deliveryAttempt.findFirstOrThrow({ where: { packageId: pkg.packageId } })).toMatchObject({ outcome: 'FAILED', failureReason: 'ABSENT', note: 'Personne à la maison' });
      // la note interne n'apparaît pas dans le suivi public
      const pub = await api(t).get(`/v1/public/tracking/${pkg.trackingNumber}`);
      expect(JSON.stringify(pub.body)).not.toContain('Personne à la maison');
      expect(errorCode(await fail(w.driver.token, stop.id, { reason: 'ABSENT' }))).toBe('STOP_ALREADY_HANDLED');
      expect((await fail(w.driver.token, uuidv7(), { reason: 'ABSENT' })).status).toBe(404);
      expect((await fail(w.manager.token, stop.id, { reason: 'VOLEUR' })).status).toBe(400);
    });

    it('au troisième échec, le retour du colis est proposé ; l’échec compte sur toutes les tournées', async () => {
      const w = await setup();
      await relaxed(w);
      const pkg = await atAgency(w);
      let last: any;
      for (let i = 1; i <= 3; i += 1) {
        const route = (await createRoute(w.token, routeBody(w))).body;
        const stop = (await addStop(w.token, route.id, { packageId: pkg.packageId })).body;
        await act(w.token, route.id, 'start');
        last = await fail(w.driver.token, stop.id, { reason: 'NO_ACCESS' });
        expect(last.body.failedAttempts).toBe(i);
        await act(w.token, route.id, 'complete');
      }
      expect(last.body.returnSuggested).toBe(true);
    });
  });

  // =============================================================================================
  describe('aides à l’écran', () => {
    it('livreurs affectables : seulement les livreurs actifs, pour qui peut planifier', async () => {
      const w = await setup();
      await t.admin.user.update({ where: { id: w.driver2.user.id }, data: { status: 'DISABLED' } });
      const res = await api(t).get('/v1/admin/drivers').set(bearer(w.manager.token));
      expect(res.status).toBe(200);
      expect(res.body.items.map((d: any) => d.id)).toEqual([w.driver.user.id]);
      expect(res.body.items[0].name).toBeTruthy();
      expect((await api(t).get('/v1/admin/drivers').set(bearer(w.driver.token))).status).toBe(403);
      expect((await api(t).get('/v1/admin/drivers').set(bearer(w.customer.token))).status).toBe(403);
    });

    it('détail de tournée : règle des preuves, bénéficiaires valables par arrêt, devise du solde', async () => {
      const w = await setup();
      const good = (await api(t).post('/v1/me/beneficiaries').set(bearer(w.customer.token)).send({ fullName: 'Jean Baptiste', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', validFrom: '2026-01-01', validTo: '2026-12-31' })).body.id;
      await api(t).post('/v1/me/beneficiaries').set(bearer(w.customer.token)).send({ fullName: 'Périmé', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '1111', validFrom: '2025-01-01', validTo: '2025-02-01' });
      const { route } = await startedRoute(w, w.customer, { driver: w.driver, unpaid: true });
      const asDriver = await api(t).get(`/v1/admin/my-routes/${route.id}`).set(bearer(w.driver.token));
      expect(asDriver.body.settings).toEqual({ requireOtp: true, requireIdDocument: true, requirePhoto: false });
      expect(asDriver.body.stops[0].beneficiaries).toEqual([{ id: good, fullName: 'Jean Baptiste', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821' }]);
      expect(asDriver.body.stops[0].balanceDue).toBeNull();
      const asManager = await api(t).get(`/v1/admin/routes/${route.id}`).set(bearer(w.manager.token));
      expect(asManager.body.stops[0]).toMatchObject({ balanceDue: '9.50', balanceCurrency: 'USD', unbilled: false });
    });

    it('fiche de remise : preuves, bénéficiaires, solde et échecs précédents, pour les responsables de l’agence seulement', async () => {
      const w = await setup();
      const pkg = await atAgency(w, w.customer, { unpaid: true });
      await api(t).post('/v1/me/beneficiaries').set(bearer(w.customer.token)).send({ fullName: 'Jean Baptiste', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', validFrom: '2026-01-01', validTo: '2026-12-31' });
      const info = await api(t).get(`/v1/admin/packages/${pkg.packageId}/handover-info`).set(bearer(w.manager.token));
      expect(info.status).toBe(200);
      expect(info.body).toMatchObject({
        customer: { customerCode: w.customer.customerCode },
        settings: { requireOtp: true },
        balance: { due: '9.50', currency: 'USD', unbilled: false, blocked: true },
        failedAttempts: 0,
      });
      expect(info.body.beneficiaries).toHaveLength(1);
      expect((await api(t).get(`/v1/admin/packages/${pkg.packageId}/handover-info`).set(bearer(w.otherManager.token))).status).toBe(404);
      expect((await api(t).get(`/v1/admin/packages/${pkg.packageId}/handover-info`).set(bearer(w.driver.token))).status).toBe(404);
      expect((await api(t).get(`/v1/admin/packages/${pkg.packageId}/handover-info`).set(bearer(w.customer.token))).status).toBe(403);
    });
  });

  // =============================================================================================
  describe('intégrité et isolation', () => {
    it('la base : une tentative et un code utilisé ne se réécrivent pas ; preuves cohérentes', async () => {
      const w = await setup();
      await relaxed(w);
      const { stop, pkg } = await startedRoute(w, w.customer, { driver: w.driver });
      await deliver(w.driver.token, stop.id, { recipientKind: 'CUSTOMER' });
      const attempt = await t.admin.deliveryAttempt.findFirstOrThrow({ where: { packageId: pkg.packageId } });
      await expect(t.admin.deliveryAttempt.update({ where: { id: attempt.id }, data: { recipientName: 'Autre' } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.deliveryAttempt.delete({ where: { id: attempt.id } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.deliveryAttempt.create({ data: { companyId: w.company.id, packageId: pkg.packageId, channel: 'AGENCY', outcome: 'SUCCEEDED' } })).rejects.toThrow();
      await expect(t.admin.deliveryAttempt.create({ data: { companyId: w.company.id, packageId: pkg.packageId, channel: 'AGENCY', outcome: 'FAILED' } })).rejects.toThrow();
      await expect(
        t.admin.deliveryAttempt.create({ data: { companyId: w.company.id, packageId: pkg.packageId, channel: 'AGENCY', outcome: 'SUCCEEDED', recipientKind: 'CUSTOMER', recipientName: 'X', balanceOverridden: true } }),
      ).rejects.toThrow();
    });

    it('une entreprise ne voit ni ne touche les tournées, arrêts et codes d’une autre', async () => {
      const a = await setup();
      const b = await setup();
      await relaxed(a);
      const { route, stop, pkg } = await startedRoute(a, a.customer, { driver: a.driver });
      expect((await api(t).get(`/v1/admin/routes/${route.id}`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).get('/v1/admin/routes').set(bearer(b.token))).body.items).toHaveLength(0);
      expect((await act(b.token, route.id, 'cancel')).status).toBe(404);
      expect((await deliver(b.token, stop.id, { recipientKind: 'CUSTOMER' })).status).toBe(404);
      expect((await handover(b.token, pkg.packageId, { recipientKind: 'CUSTOMER' })).status).toBe(404);
      expect((await api(t).post(`/v1/me/packages/${pkg.packageId}/handover-code`).set(bearer(b.customer.token))).status).toBe(404);
      expect((await createRoute(b.token, routeBody(b, { agencyId: a.agency.id }))).status).toBe(404);
      expect((await createRoute(b.token, routeBody(b, { driverUserId: a.driver.user.id }))).status).toBe(422);
    });
  });
});
