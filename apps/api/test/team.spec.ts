import {
  activateRateCard,
  api,
  bearer,
  buildTestApp,
  lastMailTo,
  login,
  makeTenant,
  makeUser,
  makeWarehouse,
  prealertBody,
  strongPassword,
  tokenFromMail,
  uniq,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Équipe d’un compte professionnel (moindre privilège)', () => {
  let t: TestApp;
  let strict: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
    strict = await buildTestApp({ REQUIRE_STAFF_2FA: 'true' });
  });
  afterAll(async () => {
    await t.close();
    await strict.close();
  });

  /** Entreprise prête (entrepôt, grille) et un client PROFESSIONNEL propriétaire, inscrit par l'API. */
  async function setup() {
    const tenant = await makeTenant(t);
    const warehouse = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token);
    const owner = await signup(tenant.company, 'BUSINESS');
    return { ...tenant, warehouse, owner };
  }

  async function signup(company: { slug: string }, accountType: 'BUSINESS' | 'INDIVIDUAL') {
    const email = `${uniq('o')}@test.example`;
    const password = strongPassword();
    const res = await api(t)
      .post('/v1/auth/register')
      .send({ companySlug: company.slug, accountType, email, password, firstName: 'Paul', lastName: 'Chef', acceptTerms: true, ...(accountType === 'BUSINESS' ? { businessName: 'Ets Chef' } : {}) });
    expect(res.status).toBe(202);
    await api(t).post('/v1/auth/verify-email').send({ token: tokenFromMail(lastMailTo(t, email)) });
    const user = { slug: company.slug, email, password };
    return { ...user, token: (await login(t, user)).accessToken };
  }

  const invite = (token: string, body: Record<string, unknown>) => api(t).post('/v1/me/team').set(bearer(token)).send(body);
  const memberBody = (role: 'READER' | 'OPERATOR' = 'READER') => ({ email: `${uniq('m')}@test.example`, firstName: 'Anne', lastName: 'Membre', role });

  /** Invite, active par le lien reçu, puis connecte le membre. */
  async function addMember(w: { owner: { token: string; slug: string } }, role: 'READER' | 'OPERATOR') {
    const body = memberBody(role);
    const res = await invite(w.owner.token, body);
    expect(res.status).toBe(201);
    const mail = lastMailTo(t, body.email);
    expect(mail.text).toContain('/accept-invite?token=');
    const password = strongPassword();
    const activated = await api(t).post('/v1/auth/reset-password').send({ token: tokenFromMail(mail), newPassword: password });
    expect(activated.status).toBe(200);
    const session = await login(t, { slug: w.owner.slug, email: body.email, password });
    return { userId: res.body.userId as string, email: body.email, password, token: session.accessToken };
  }

  it('le propriétaire invite un lecteur : lien de 72 h envoyé, rôle COMPANY limité, audit enregistré', async () => {
    const w = await setup();
    const body = memberBody('READER');
    const res = await invite(w.owner.token, body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: body.email, role: 'READER', status: 'PENDING' });
    const roles = await t.admin.userRole.findMany({ where: { userId: res.body.userId }, include: { role: true } });
    expect(roles.map((r) => r.role.code)).toEqual(['TEAM_READER']);
    const token = await t.admin.verificationToken.findFirstOrThrow({ where: { userId: res.body.userId, purpose: 'INVITE' } });
    const hours = (token.expiresAt.getTime() - token.createdAt.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(72, 0);
    const audit = await t.admin.auditLog.findMany({ where: { companyId: w.company.id, action: 'team.member_invited' } });
    expect(audit).toHaveLength(1);
    const list = await api(t).get('/v1/me/team').set(bearer(w.owner.token));
    expect(list.body).toMatchObject({ limit: 10 });
    expect(list.body.items).toHaveLength(1);
  });

  it('un membre n’a jamais de profil client propre et n’est que dans une seule équipe', async () => {
    const w = await setup();
    const m = await addMember(w, 'READER');
    expect(await t.admin.customer.count({ where: { userId: m.userId } })).toBe(0);
    const other = await signup(w.company, 'BUSINESS');
    const again = await invite(other.token, { email: m.email, firstName: 'Anne', lastName: 'Membre', role: 'READER' });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('EMAIL_ALREADY_USED');
  });

  it('le lecteur voit colis, factures et réclamations du compte ; il ne peut rien déclarer ni payer', async () => {
    const w = await setup();
    const reader = await addMember(w, 'READER');
    const pre = await api(t).post('/v1/me/prealerts').set(bearer(w.owner.token)).send(prealertBody(w.warehouse.id));
    expect(pre.status).toBe(201);

    const packages = await api(t).get('/v1/me/packages').set(bearer(reader.token));
    expect(packages.status).toBe(200);
    expect(JSON.stringify(packages.body)).toContain(pre.body.package.id);
    expect((await api(t).get('/v1/me/invoices').set(bearer(reader.token))).status).toBe(200);
    expect((await api(t).get('/v1/me/claims').set(bearer(reader.token))).status).toBe(200);

    expect((await api(t).post('/v1/me/prealerts').set(bearer(reader.token)).send(prealertBody(w.warehouse.id))).status).toBe(403);
    expect((await api(t).post('/v1/me/claims').set(bearer(reader.token)).send({ category: 'OTHER', subject: 'Question', message: 'Bonjour' })).status).toBe(403);
    expect((await api(t).get('/v1/me/payments').set(bearer(reader.token))).status).toBe(403);
  });

  it('l’opérateur déclare des achats et ouvre des réclamations, mais ne voit pas les factures', async () => {
    const w = await setup();
    const operator = await addMember(w, 'OPERATOR');
    const pre = await api(t).post('/v1/me/prealerts').set(bearer(operator.token)).send(prealertBody(w.warehouse.id));
    expect(pre.status).toBe(201);
    // la préalerte appartient au COMPTE du propriétaire : il la voit aussi
    const mine = await api(t).get('/v1/me/packages').set(bearer(w.owner.token));
    expect(JSON.stringify(mine.body)).toContain(pre.body.package.id);
    const claim = await api(t).post('/v1/me/claims').set(bearer(operator.token)).send({ category: 'OTHER', subject: 'Question', message: 'Bonjour' });
    expect(claim.status).toBe(201);
    expect((await api(t).get('/v1/me/invoices').set(bearer(operator.token))).status).toBe(403);
  });

  it('un membre n’accède ni au profil, aux adresses, au code de remise, ni à l’équipe', async () => {
    const w = await setup();
    const m = await addMember(w, 'OPERATOR');
    for (const path of ['/v1/me/profile', '/v1/me/addresses', '/v1/me/beneficiaries', '/v1/me/team']) {
      expect((await api(t).get(path).set(bearer(m.token))).status).toBe(403);
    }
    expect((await invite(m.token, memberBody())).status).toBe(403);
    expect((await api(t).patch(`/v1/me/team/${m.userId}`).set(bearer(m.token)).send({ role: 'READER' })).status).toBe(403);
    expect((await api(t).delete(`/v1/me/team/${m.userId}`).set(bearer(m.token))).status).toBe(403);
  });

  it('un membre ne voit pas les colis d’un autre compte', async () => {
    const w = await setup();
    const reader = await addMember(w, 'READER');
    const stranger = await signup(w.company, 'BUSINESS');
    const pre = await api(t).post('/v1/me/prealerts').set(bearer(stranger.token)).send(prealertBody(w.warehouse.id));
    expect(pre.status).toBe(201);
    const list = await api(t).get('/v1/me/packages').set(bearer(reader.token));
    expect(JSON.stringify(list.body)).not.toContain(pre.body.package.id);
    expect((await api(t).get(`/v1/me/packages/${pre.body.package.id}`).set(bearer(reader.token))).status).toBe(404);
  });

  it('seul un compte PROFESSIONNEL gère une équipe', async () => {
    const w = await setup();
    const individual = await signup(w.company, 'INDIVIDUAL');
    expect((await api(t).get('/v1/me/team').set(bearer(individual.token))).status).toBe(403);
    expect((await invite(individual.token, memberBody())).status).toBe(403);
  });

  it('changement de rôle immédiat : le lecteur devenu opérateur perd les factures sans se reconnecter', async () => {
    const w = await setup();
    const m = await addMember(w, 'READER');
    expect((await api(t).get('/v1/me/invoices').set(bearer(m.token))).status).toBe(200);
    const changed = await api(t).patch(`/v1/me/team/${m.userId}`).set(bearer(w.owner.token)).send({ role: 'OPERATOR' });
    expect(changed.status).toBe(200);
    expect(changed.body.role).toBe('OPERATOR');
    expect((await api(t).get('/v1/me/invoices').set(bearer(m.token))).status).toBe(403);
    expect(await t.admin.auditLog.count({ where: { companyId: w.company.id, action: 'team.member_role_changed' } })).toBe(1);
  });

  it('retrait immédiat : accès coupé, sessions fermées, compte désactivé, audit ; réinvitation possible', async () => {
    const w = await setup();
    const m = await addMember(w, 'READER');
    expect((await api(t).get('/v1/me/packages').set(bearer(m.token))).status).toBe(200);
    expect((await api(t).delete(`/v1/me/team/${m.userId}`).set(bearer(w.owner.token))).status).toBe(204);
    expect((await api(t).get('/v1/me/packages').set(bearer(m.token))).status).toBe(401);
    expect((await t.admin.user.findUniqueOrThrow({ where: { id: m.userId } })).status).toBe('DISABLED');
    expect(await t.admin.session.count({ where: { userId: m.userId, revokedAt: null } })).toBe(0);
    expect(await t.admin.auditLog.count({ where: { companyId: w.company.id, action: 'team.member_removed' } })).toBe(1);
    const relogin = await api(t).post('/v1/auth/login').send({ companySlug: w.owner.slug, email: m.email, password: m.password });
    expect(relogin.status).toBeGreaterThanOrEqual(400);
    // un ancien membre retiré peut être réinvité
    const again = await invite(w.owner.token, { email: m.email, firstName: 'Anne', lastName: 'Membre', role: 'OPERATOR' });
    expect(again.status).toBe(201);
    expect(again.body.userId).toBe(m.userId);
  });

  it('un membre d’une autre équipe est présenté comme introuvable (modification et retrait)', async () => {
    const w = await setup();
    const other = await signup(w.company, 'BUSINESS');
    const foreign = await addMember({ owner: other }, 'READER');
    expect((await api(t).patch(`/v1/me/team/${foreign.userId}`).set(bearer(w.owner.token)).send({ role: 'OPERATOR' })).status).toBe(404);
    expect((await api(t).delete(`/v1/me/team/${foreign.userId}`).set(bearer(w.owner.token))).status).toBe(404);
  });

  it('au plus 10 membres, même en rafale', async () => {
    const w = await setup();
    const results = await Promise.all(Array.from({ length: 12 }, () => invite(w.owner.token, memberBody())));
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409).every((r) => errorCode(r) === 'TEAM_FULL')).toBe(true);
  });

  it('validation : rôle hors lecteur/opérateur, champ inconnu, adresse invalide', async () => {
    const w = await setup();
    for (const bad of [
      { ...memberBody(), role: 'ADMIN' },
      { ...memberBody(), roles: ['COMPANY_ADMIN'] },
      { ...memberBody(), email: 'pas-une-adresse' },
    ]) {
      expect((await invite(w.owner.token, bad)).status).toBe(400);
    }
  });

  it('double authentification : exigée du propriétaire pour inviter un membre', async () => {
    const tenant = await makeTenant(strict);
    const owner = await makeUser(strict, { company: tenant.company, roleCode: 'CUSTOMER_BUSINESS' });
    const token = (await login(strict, owner)).accessToken;
    await strict.admin.customer.create({ data: { companyId: tenant.company.id, userId: owner.id, customerCode: `TT-${Math.floor(Math.random() * 900000 + 100000)}`, customerType: 'BUSINESS' } });
    const res = await api(strict).post('/v1/me/team').set(bearer(token)).send(memberBody());
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('TOTP_ENROLLMENT_REQUIRED');
    expect(await strict.admin.customerMember.count({ where: { companyId: tenant.company.id } })).toBe(0);
  });
});
