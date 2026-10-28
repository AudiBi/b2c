import { v7 as uuidv7 } from 'uuid';
import { api, bearer, buildTestApp, login, makeCustomer, makeTenant, makeUser, makeWarehouse, mailsTo, processNotifications, readyPackage, type TestApp } from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Réclamations', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const tenant = await makeTenant(t);
    const w1 = await makeWarehouse(t, tenant.token);
    const customer = await makeCustomer(t, tenant.company);
    const other = await makeCustomer(t, tenant.company);
    const staff = async (roleCode: 'CUSTOMER_SERVICE' | 'BILLING_AGENT' | 'AGENCY_MANAGER', scope?: { type: 'AGENCY'; id: string }) => {
      const user = await makeUser(t, { company: tenant.company, roleCode, scope });
      return { user, token: (await login(t, user)).accessToken };
    };
    const service = await staff('CUSTOMER_SERVICE');
    const service2 = await staff('CUSTOMER_SERVICE');
    const billing = await staff('BILLING_AGENT');
    return { ...tenant, w1, customer, other, staff, service, service2, billing };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const open = (token: string, body: Record<string, unknown> = {}) =>
    api(t).post('/v1/me/claims').set(bearer(token)).send({ category: 'DAMAGED', subject: 'Colis abîmé', message: 'La boîte est écrasée.', ...body });
  const status = (token: string, id: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/claims/${id}/status`).set(bearer(token)).send(body);
  const reply = (token: string, id: string, body: Record<string, unknown>) => api(t).post(`/v1/admin/claims/${id}/messages`).set(bearer(token)).send(body);

  describe('ouverture par le client', () => {
    it('numéro CLM-AAAA-NNNNNN, premier message, état « ouverte » ; un colis du client peut être invoqué', async () => {
      const w = await setup();
      const pkg = await readyPackage(t, w, w.customer, w.w1.id);
      const first = await open(w.customer.token, { packageId: pkg.packageId });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ number: `CLM-${new Date().getUTCFullYear()}-000001`, status: 'OPEN', category: 'DAMAGED', subject: 'Colis abîmé', package: { id: pkg.packageId }, resolution: null });
      expect((await open(w.customer.token)).body.number).toMatch(/-000002$/);
      const detail = await api(t).get(`/v1/me/claims/${first.body.id}`).set(bearer(w.customer.token));
      expect(detail.body.messages).toHaveLength(1);
      expect(detail.body.messages[0]).toMatchObject({ author: 'CUSTOMER', body: 'La boîte est écrasée.' });
      expect(detail.body.assignedTo).toBeUndefined(); // détails internes absents côté client
      expect(await t.admin.auditLog.count({ where: { companyId: w.company.id, action: 'claim.opened' } })).toBe(2);
    });

    it('refuse : colis d’un autre client ou inconnu, catégorie, objet vide, champs inconnus, personnel, anonyme', async () => {
      const w = await setup();
      const foreign = await readyPackage(t, w, w.other, w.w1.id);
      expect((await open(w.customer.token, { packageId: foreign.packageId })).status).toBe(404);
      expect((await open(w.customer.token, { packageId: uuidv7() })).status).toBe(404);
      expect((await open(w.customer.token, { category: 'FRAUD' })).status).toBe(400);
      expect((await open(w.customer.token, { subject: '  ' })).status).toBe(400);
      expect((await open(w.customer.token, { message: '' })).status).toBe(400);
      expect((await open(w.customer.token, { status: 'RESOLVED' })).status).toBe(400);
      expect((await open(w.service.token)).status).toBe(403);
      expect((await api(t).post('/v1/me/claims').send({})).status).toBe(401);
    });
  });

  describe('échanges et isolation', () => {
    it('un client ne voit que ses réclamations, sans les notes internes ; il peut répondre tant qu’elle est ouverte', async () => {
      const w = await setup();
      const claim = (await open(w.customer.token)).body;
      await open(w.other.token, { subject: 'Autre client' });
      const mine = await api(t).get('/v1/me/claims').set(bearer(w.customer.token));
      expect(mine.body.items.map((c: any) => c.id)).toEqual([claim.id]);
      expect((await api(t).get(`/v1/me/claims/${claim.id}`).set(bearer(w.other.token))).status).toBe(404);
      expect((await api(t).post(`/v1/me/claims/${claim.id}/messages`).set(bearer(w.other.token)).send({ body: 'Intrusion' })).status).toBe(404);

      await reply(w.service.token, claim.id, { body: 'Client mécontent, vérifier le colis.', internal: true });
      await reply(w.service.token, claim.id, { body: 'Bonjour, nous regardons cela.' });
      const customerReply = await api(t).post(`/v1/me/claims/${claim.id}/messages`).set(bearer(w.customer.token)).send({ body: 'Merci, voici une photo.' });
      expect(customerReply.status).toBe(201);
      const view = await api(t).get(`/v1/me/claims/${claim.id}`).set(bearer(w.customer.token));
      expect(view.body.messages.map((m: any) => m.body)).toEqual(['La boîte est écrasée.', 'Bonjour, nous regardons cela.', 'Merci, voici une photo.']);
      expect(JSON.stringify(view.body)).not.toMatch(/mécontent|internal/);
      const staffView = await api(t).get(`/v1/admin/claims/${claim.id}`).set(bearer(w.service.token));
      expect(staffView.body.messages).toHaveLength(4);
      expect(staffView.body.messages.filter((m: any) => m.internal)).toHaveLength(1);
    });

    it('autorisations : le service client traite, la facturation et un client n’ont pas accès à la gestion', async () => {
      const w = await setup();
      const claim = (await open(w.customer.token)).body;
      expect((await api(t).get('/v1/admin/claims').set(bearer(w.service.token))).body.items).toHaveLength(1);
      expect((await api(t).get('/v1/admin/claims').set(bearer(w.billing.token))).status).toBe(403);
      expect((await api(t).get('/v1/admin/claims').set(bearer(w.customer.token))).status).toBe(403);
      expect((await reply(w.billing.token, claim.id, { body: 'x' })).status).toBe(403);
      expect((await status(w.customer.token, claim.id, { status: 'RESOLVED', resolution: 'Réglé' })).status).toBe(403);
      expect((await api(t).get('/v1/admin/claims')).status).toBe(401);
    });

    it('responsables affectables : le personnel actif seulement, pour qui traite les réclamations', async () => {
      const w = await setup();
      await t.admin.user.update({ where: { id: w.service2.user.id }, data: { status: 'DISABLED' } });
      const res = await api(t).get('/v1/admin/claims/assignees').set(bearer(w.service.token));
      expect(res.status).toBe(200);
      const ids = res.body.items.map((u: any) => u.id);
      expect(ids).toContain(w.service.user.id);
      expect(ids).not.toContain(w.service2.user.id);
      expect(ids).not.toContain(w.customer.user.id);
      expect((await api(t).get('/v1/admin/claims/assignees').set(bearer(w.billing.token))).status).toBe(403);
      expect((await api(t).get('/v1/admin/claims/assignees').set(bearer(w.customer.token))).status).toBe(403);
    });

    it('une entreprise ne voit ni ne traite les réclamations d’une autre', async () => {
      const a = await setup();
      const b = await setup();
      const claim = (await open(a.customer.token)).body;
      expect((await api(t).get(`/v1/admin/claims/${claim.id}`).set(bearer(b.service.token))).status).toBe(404);
      expect((await status(b.service.token, claim.id, { status: 'IN_PROGRESS' })).status).toBe(404);
      expect((await api(t).get('/v1/admin/claims').set(bearer(b.service.token))).body.items).toHaveLength(0);
      expect((await api(t).post(`/v1/admin/claims/${claim.id}/assign`).set(bearer(b.service.token)).send({ userId: b.service.user.id })).status).toBe(404);
    });
  });

  describe('traitement', () => {
    it('affectation : le premier traitement passe la réclamation « en cours » ; un responsable invalide est refusé', async () => {
      const w = await setup();
      const claim = (await open(w.customer.token)).body;
      const assign = (userId: string | null) => api(t).post(`/v1/admin/claims/${claim.id}/assign`).set(bearer(w.service.token)).send({ userId });
      const ok = await assign(w.service2.user.id);
      expect(ok.body).toMatchObject({ status: 'IN_PROGRESS', assignedTo: { id: w.service2.user.id } });
      expect(errorCode(await assign(w.customer.user.id))).toBe('ASSIGNEE_INVALID');
      expect(errorCode(await assign(uuidv7()))).toBe('ASSIGNEE_INVALID');
      expect((await assign(null)).body.assignedTo).toBeNull();
      const list = await api(t).get(`/v1/admin/claims?assignedTo=${w.service2.user.id}`).set(bearer(w.service.token));
      expect(list.body.items).toHaveLength(0);
      expect((await api(t).get(`/v1/admin/claims?status=IN_PROGRESS&q=${claim.number.toLowerCase()}`).set(bearer(w.service.token))).body.items).toHaveLength(1);
      expect((await api(t).get('/v1/admin/claims?status=NOPE').set(bearer(w.service.token))).status).toBe(400);
    });

    it('clôture : résolution obligatoire, le client est prévenu, il ne peut plus écrire ; la réouverture est possible', async () => {
      const w = await setup();
      const claim = (await open(w.customer.token)).body;
      expect((await status(w.service.token, claim.id, { status: 'RESOLVED' })).status).toBe(400);
      expect((await status(w.service.token, claim.id, { status: 'REJECTED', resolution: '   ' })).status).toBe(400);
      const resolved = await status(w.service.token, claim.id, { status: 'RESOLVED', resolution: 'Remboursement accordé.' });
      expect(resolved.body).toMatchObject({ status: 'RESOLVED', resolution: 'Remboursement accordé.' });
      expect(resolved.body.resolvedAt).toBeTruthy();
      expect(errorCode(await status(w.service.token, claim.id, { status: 'RESOLVED', resolution: 'Encore' }))).toBe('CLAIM_STATUS_UNCHANGED');
      const late = await api(t).post(`/v1/me/claims/${claim.id}/messages`).set(bearer(w.customer.token)).send({ body: 'Encore une chose' });
      expect(late.status).toBe(409);
      expect(errorCode(late)).toBe('CLAIM_CLOSED');
      expect((await api(t).get(`/v1/me/claims/${claim.id}`).set(bearer(w.customer.token))).body).toMatchObject({ status: 'RESOLVED', resolution: 'Remboursement accordé.' });

      const reopened = await status(w.service.token, claim.id, { status: 'IN_PROGRESS' });
      expect(reopened.body).toMatchObject({ status: 'IN_PROGRESS', resolution: null, resolvedAt: null });
      expect((await api(t).post(`/v1/me/claims/${claim.id}/messages`).set(bearer(w.customer.token)).send({ body: 'Merci' })).status).toBe(201);
    });

    it('notifications : une réponse ou un changement d’état prévient le client (portail et e-mail), une note interne jamais', async () => {
      const w = await setup();
      const claim = (await open(w.customer.token)).body;
      await reply(w.service.token, claim.id, { body: 'Note privée', internal: true });
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id, eventCode: 'claim.updated' } })).toBe(0);
      await reply(w.service.token, claim.id, { body: 'Réponse publique' });
      await status(w.service.token, claim.id, { status: 'RESOLVED', resolution: 'Réglé' });
      expect(await t.admin.outboxEvent.count({ where: { companyId: w.company.id, eventCode: 'claim.updated' } })).toBe(2);
      await processNotifications(t, w.company.id);
      const inbox = await api(t).get('/v1/me/notifications').set(bearer(w.customer.token));
      const updates = inbox.body.items.filter((n: any) => n.eventCode === 'claim.updated');
      expect(updates).toHaveLength(2);
      expect(updates[0].subject).toContain(claim.number);
      expect(mailsTo(t, w.customer.user.email).filter((m) => m.subject.includes(claim.number))).toHaveLength(2);
      expect(JSON.stringify(inbox.body)).not.toContain('Note privée');
    });

    it('la base : messages en ajout seul, identité de la réclamation figée, clôture cohérente', async () => {
      const w = await setup();
      const claim = (await open(w.customer.token)).body;
      const message = await t.admin.claimMessage.findFirstOrThrow({ where: { claimId: claim.id } });
      await expect(t.admin.claimMessage.update({ where: { id: message.id }, data: { body: 'réécrit' } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.claimMessage.delete({ where: { id: message.id } })).rejects.toThrow(/ajout seul/);
      await expect(t.admin.claim.update({ where: { id: claim.id }, data: { subject: 'Autre objet' } })).rejects.toThrow(/ne changent pas/);
      await expect(t.admin.claim.update({ where: { id: claim.id }, data: { number: 'CLM-0' } })).rejects.toThrow(/ne changent pas/);
      await expect(t.admin.claim.update({ where: { id: claim.id }, data: { status: 'RESOLVED' } })).rejects.toThrow();
      await expect(t.admin.claim.delete({ where: { id: claim.id } })).rejects.toThrow(/ne se supprime pas/);
    });
  });
});
