import jwt from 'jsonwebtoken';
import { v7 as uuidv7 } from 'uuid';
import {
  api,
  bearer,
  buildTestApp,
  cookieValue,
  freshIp,
  lastMailTo,
  login,
  makeCompany,
  makeUser,
  mailsTo,
  strongPassword,
  tokenFromMail,
  uniq,
  type TestApp,
} from './helpers';

describe('Authentification', () => {
  let t: TestApp;
  let company: { id: string; slug: string };

  beforeAll(async () => {
    t = await buildTestApp();
    company = await makeCompany(t);
  });
  afterAll(() => t.close());

  const registerBody = (overrides: Record<string, unknown> = {}) => ({
    companySlug: company.slug,
    accountType: 'INDIVIDUAL',
    email: `${uniq('c')}@test.example`,
    password: strongPassword(),
    firstName: 'Marie',
    lastName: 'Jean',
    acceptTerms: true,
    ...overrides,
  });
  const register = (body: Record<string, unknown>, ip = freshIp()) =>
    api(t).post('/v1/auth/register').set('X-Forwarded-For', ip).send(body);

  describe('parcours 1 : un client crée son compte et se connecte', () => {
    it('inscription → e-mail → confirmation → connexion → profil', async () => {
      const body = registerBody({ locale: 'ht' });
      const res = await register(body);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'verification_email_sent' });

      // Le compte existe, en attente, avec le rôle client individuel, et le mot de passe n'est pas stocké en clair
      const stored = await t.admin.user.findFirstOrThrow({
        where: { companyId: company.id, email: body.email as string },
        include: { userRoles: { include: { role: true } } },
      });
      expect(stored.status).toBe('PENDING');
      expect(stored.kind).toBe('CUSTOMER');
      expect(stored.emailVerifiedAt).toBeNull();
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain(body.password as string);
      expect(stored.userRoles.map((r) => r.role.code)).toEqual(['CUSTOMER_INDIVIDUAL']);

      // L'e-mail est en créole (langue choisie) et contient le lien
      const mail = lastMailTo(t, body.email as string);
      expect(mail.subject).toContain('konfime');
      expect(mail.text).toContain('/verify-email?token=');

      // Connexion impossible tant que l'adresse n'est pas confirmée
      const early = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: body.email, password: body.password });
      expect(early.status).toBe(403);
      expect(early.body.error.code).toBe('EMAIL_NOT_VERIFIED');

      const verify = await api(t)
        .post('/v1/auth/verify-email')
        .set('X-Forwarded-For', freshIp())
        .send({ token: tokenFromMail(mail) });
      expect(verify.status).toBe(200);

      const session = await login(t, { slug: company.slug, email: body.email as string, password: body.password as string });
      const me = await api(t).get('/v1/auth/me').set(bearer(session.accessToken));
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ email: body.email, kind: 'CUSTOMER', emailVerified: true, locale: 'ht' });
      expect(me.body.roles.map((r: any) => r.roleCode)).toEqual(['CUSTOMER_INDIVIDUAL']);
      expect(me.body.permissions).toContain('package:read_own');
      expect(me.body.permissions).not.toContain('package:read');
    });

    it('un compte professionnel exige la raison sociale et reçoit le rôle professionnel', async () => {
      const missing = await register(registerBody({ accountType: 'BUSINESS' }));
      expect(missing.status).toBe(400);
      const body = registerBody({ accountType: 'BUSINESS', businessName: 'Ets Jean & Fils' });
      expect((await register(body)).status).toBe(202);
      const stored = await t.admin.user.findFirstOrThrow({
        where: { companyId: company.id, email: body.email as string },
        include: { userRoles: { include: { role: true } } },
      });
      expect(stored.businessName).toBe('Ets Jean & Fils');
      expect(stored.userRoles[0].role.code).toBe('CUSTOMER_BUSINESS');
    });

    it('le jeton de confirmation est à usage unique et expire', async () => {
      const body = registerBody();
      await register(body);
      const token = tokenFromMail(lastMailTo(t, body.email as string));
      const ok = await api(t).post('/v1/auth/verify-email').set('X-Forwarded-For', freshIp()).send({ token });
      expect(ok.status).toBe(200);
      const again = await api(t).post('/v1/auth/verify-email').set('X-Forwarded-For', freshIp()).send({ token });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('INVALID_TOKEN');

      const second = registerBody();
      await register(second);
      const secondToken = tokenFromMail(lastMailTo(t, second.email as string));
      await t.admin.verificationToken.updateMany({
        where: { user: { email: second.email as string } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await api(t).post('/v1/auth/verify-email').set('X-Forwarded-For', freshIp()).send({ token: secondToken });
      expect(expired.status).toBe(400);
    });

    it('refuse un jeton falsifié ou mal formé', async () => {
      const forged = `${company.id}.${'a'.repeat(43)}`;
      for (const token of [forged, 'pas-un-jeton-valide-du-tout', `${uuidv7()}.${'b'.repeat(43)}`]) {
        const res = await api(t).post('/v1/auth/verify-email').set('X-Forwarded-For', freshIp()).send({ token });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('inscriptions : doublons, énumération, validation', () => {
    it('une adresse déjà inscrite reçoit la même réponse et un e-mail d\'information, sans second compte', async () => {
      const body = registerBody();
      const first = await register(body);
      const second = await register({ ...body, password: strongPassword() });
      expect(second.status).toBe(first.status);
      expect(second.body).toEqual(first.body);
      expect(await t.admin.user.count({ where: { companyId: company.id, email: body.email as string } })).toBe(1);
      const mails = mailsTo(t, body.email as string);
      expect(mails).toHaveLength(2);
      expect(mails[1].text).not.toContain('token=');
    });

    it('10 inscriptions simultanées de la même adresse créent un seul compte, sans erreur 500', async () => {
      const body = registerBody();
      const results = await Promise.all(Array.from({ length: 10 }, () => register(body)));
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(202));
      expect(await t.admin.user.count({ where: { companyId: company.id, email: body.email as string } })).toBe(1);
    });

    it('une même adresse peut s\'inscrire dans deux entreprises distinctes', async () => {
      const other = await makeCompany(t);
      const body = registerBody();
      expect((await register(body)).status).toBe(202);
      expect((await register({ ...body, companySlug: other.slug })).status).toBe(202);
      expect(await t.admin.user.count({ where: { email: body.email as string } })).toBe(2);
    });

    it("refuse une entreprise inconnue, suspendue ou l'entreprise plateforme", async () => {
      expect((await register(registerBody({ companySlug: 'nexiste-pas' }))).status).toBe(404);
      expect((await register(registerBody({ companySlug: 'platform' }))).status).toBe(404);
      const suspended = await makeCompany(t, 'SUSPENDED');
      expect((await register(registerBody({ companySlug: suspended.slug }))).status).toBe(404);
    });

    it.each([
      ['mot de passe trop court', { password: 'Court1!' }],
      ['mot de passe courant', { password: 'password123' }],
      ['mot de passe contenant l\'adresse', { email: 'marielouise@test.example', password: 'marielouise-2024!' }],
      ['e-mail invalide', { email: 'pas-un-email' }],
      ['conditions non acceptées', { acceptTerms: false }],
      ['téléphone invalide', { phone: '37 00 00 00' }],
      ['langue inconnue', { locale: 'es' }],
      ['champ inconnu (tentative d\'élévation de droits)', { roles: ['COMPANY_ADMIN'] }],
      ['champ « kind » injecté', { kind: 'STAFF' }],
    ])('refuse : %s', async (_label, override) => {
      const res = await register(registerBody(override));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.requestId).toBeTruthy();
    });

    it('refuse un corps JSON mal formé', async () => {
      const res = await api(t)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .set('Content-Type', 'application/json')
        .send('{"email": ');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('renvoie un nouvel e-mail de confirmation sans révéler si le compte existe', async () => {
      const body = registerBody();
      await register(body);
      const before = mailsTo(t, body.email as string).length;
      const known = await api(t)
        .post('/v1/auth/resend-verification')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: body.email });
      const unknown = await api(t)
        .post('/v1/auth/resend-verification')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: 'inconnu@test.example' });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(unknown.body).toEqual(known.body);
      expect(mailsTo(t, body.email as string)).toHaveLength(before + 1);
      expect(mailsTo(t, 'inconnu@test.example')).toHaveLength(0);
      // L'ancien lien est invalidé par le nouveau
      const oldToken = tokenFromMail(mailsTo(t, body.email as string)[0]);
      const stale = await api(t).post('/v1/auth/verify-email').set('X-Forwarded-For', freshIp()).send({ token: oldToken });
      expect(stale.status).toBe(400);
    });
  });

  describe('connexion', () => {
    it('refuse un mauvais mot de passe et un compte inconnu avec exactement la même réponse', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const wrong = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: user.email, password: 'Mauvais-mot-de-passe-1' });
      const unknown = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: 'fantome@test.example', password: 'Mauvais-mot-de-passe-1' });
      const noCompany = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: 'societe-inexistante', email: user.email, password: user.password });
      for (const res of [wrong, unknown, noCompany]) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
        expect(res.body.error.message).toBe(wrong.body.error.message);
      }
    });

    it("un compte d'une entreprise ne se connecte pas dans une autre", async () => {
      const other = await makeCompany(t);
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const res = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: other.slug, email: user.email, password: user.password });
      expect(res.status).toBe(401);
    });

    it('refuse un compte désactivé, mais seulement après vérification du mot de passe', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL', status: 'DISABLED' });
      const ok = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: user.email, password: user.password });
      expect(ok.status).toBe(403);
      expect(ok.body.error.code).toBe('ACCOUNT_DISABLED');
      const bad = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: user.email, password: 'Faux-mot-de-passe-1' });
      expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it("pose le jeton de renouvellement dans un cookie HttpOnly et ne l'expose pas dans le corps", async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const res = await login(t, user);
      expect(res.body.refreshToken).toBeUndefined();
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.refreshCookie).toMatch(/HttpOnly/i);
      expect(res.refreshCookie).toMatch(/SameSite=Lax/i);
      expect(res.refreshCookie).toMatch(/Path=\/v1\/auth/);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|argon2/);
    });

    it('les clients mobiles reçoivent le jeton de renouvellement dans le corps', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const res = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .set('X-Client-Type', 'mobile')
        .send({ companySlug: company.slug, email: user.email, password: user.password });
      expect(res.status).toBe(200);
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it("l'e-mail est insensible à la casse et aux espaces", async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const res = await api(t)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: `  ${user.email.toUpperCase()} `, password: user.password });
      expect(res.status).toBe(200);
    });
  });

  describe("jeton d'accès", () => {
    it('refuse une requête sans jeton, avec un jeton falsifié, expiré, signé autrement ou sans signature', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const good = await login(t, user);
      const claims = jwt.decode(good.accessToken) as jwt.JwtPayload;
      const secret = process.env.JWT_ACCESS_SECRET!;
      const base = { cid: claims.cid, sid: claims.sid };
      const sign = (key: string, options: jwt.SignOptions = {}) =>
        jwt.sign(base, key, { algorithm: 'HS256', subject: claims.sub!, issuer: 'b2c-api', audience: 'b2c', expiresIn: 600, ...options });

      const variants: Record<string, string> = {
        expiré: sign(secret, { expiresIn: -10 }),
        'mauvaise clé': sign('x'.repeat(40)),
        'mauvais émetteur': sign(secret, { issuer: 'autre' }),
        'mauvaise audience': sign(secret, { audience: 'autre' }),
        'algorithme none': `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: claims.sub, ...base })).toString('base64url')}.`,
        'charge modifiée': (() => {
          const [h, , s] = good.accessToken.split('.');
          return `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: uuidv7() })).toString('base64url')}.${s}`;
        })(),
        'entreprise modifiée': sign(secret, {}).replace(/^(.+?)\.(.+?)\./, (_m, h) =>
          `${h}.${Buffer.from(JSON.stringify({ ...claims, cid: uuidv7() })).toString('base64url')}.`),
      };
      for (const [label, token] of Object.entries(variants)) {
        const res = await api(t).get('/v1/auth/me').set(bearer(token));
        expect({ label, status: res.status }).toEqual({ label, status: 401 });
      }
      expect((await api(t).get('/v1/auth/me')).status).toBe(401);
      expect((await api(t).get('/v1/auth/me').set('Authorization', 'Basic abc')).status).toBe(401);
      expect((await api(t).get('/v1/auth/me').set(bearer(good.accessToken))).status).toBe(200);
    });

    it('un jeton valide pour une session inexistante est refusé', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const token = jwt.sign({ cid: company.id, sid: uuidv7() }, process.env.JWT_ACCESS_SECRET!, {
        algorithm: 'HS256', subject: user.id, issuer: 'b2c-api', audience: 'b2c', expiresIn: 600,
      });
      expect((await api(t).get('/v1/auth/me').set(bearer(token))).status).toBe(401);
    });
  });

  describe('renouvellement et déconnexion', () => {
    it('fait tourner le jeton de renouvellement, et détecte sa réutilisation en révoquant la famille', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const first = await login(t, user);
      const refresh = (cookie: string) =>
        api(t)
          .post('/v1/auth/refresh')
          .set('X-Forwarded-For', freshIp())
          .set('X-CSRF-Protection', '1')
          .set('Cookie', `b2c_refresh=${cookie}`)
          .send({});

      const token1 = cookieValue(first.refreshCookie!);
      const second = await refresh(token1);
      expect(second.status).toBe(200);
      const token2 = cookieValue(([] as string[]).concat(second.headers['set-cookie']).find((c) => c.startsWith('b2c_refresh='))!);
      expect(token2).not.toBe(token1);
      expect((await api(t).get('/v1/auth/me').set(bearer(second.body.accessToken))).status).toBe(200);

      // Rejouer l'ancien jeton : refus, et toute la famille est révoquée (le nouveau jeton ne marche plus)
      const replay = await refresh(token1);
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
      expect((await refresh(token2)).status).toBe(401);
      expect((await api(t).get('/v1/auth/me').set(bearer(second.body.accessToken))).status).toBe(401);

      const audit = await t.admin.auditLog.findMany({ where: { companyId: company.id, action: 'auth.refresh_reuse_detected', entityId: user.id } });
      expect(audit).toHaveLength(1);
    });

    it('deux renouvellements simultanés avec le même jeton : un seul réussit, la famille est révoquée', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const first = await login(t, user);
      const token = cookieValue(first.refreshCookie!);
      const results = await Promise.all(
        [0, 1].map(() =>
          api(t)
            .post('/v1/auth/refresh')
            .set('X-Forwarded-For', freshIp())
            .set('X-CSRF-Protection', '1')
            .set('Cookie', `b2c_refresh=${token}`)
            .send({}),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 401]);
    });

    it("exige l'en-tête anti-CSRF quand le jeton vient du cookie, et refuse les jetons mal formés", async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const first = await login(t, user);
      const noHeader = await api(t)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', `b2c_refresh=${cookieValue(first.refreshCookie!)}`)
        .send({});
      expect(noHeader.status).toBe(403);
      expect(noHeader.body.error.code).toBe('CSRF_HEADER_REQUIRED');
      const garbage = await api(t)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', freshIp())
        .send({ refreshToken: 'x'.repeat(60) });
      expect(garbage.status).toBe(401);
      const none = await api(t).post('/v1/auth/refresh').set('X-Forwarded-For', freshIp()).send({});
      expect(none.status).toBe(401);
    });

    it('la déconnexion révoque immédiatement le jeton d\'accès et le jeton de renouvellement', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const session = await login(t, user);
      const out = await api(t).post('/v1/auth/logout').set(bearer(session.accessToken)).send({});
      expect(out.status).toBe(204);
      expect((await api(t).get('/v1/auth/me').set(bearer(session.accessToken))).status).toBe(401);
      const refresh = await api(t)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', freshIp())
        .set('X-CSRF-Protection', '1')
        .set('Cookie', `b2c_refresh=${cookieValue(session.refreshCookie!)}`)
        .send({});
      expect(refresh.status).toBe(401);
    });

    it('allSessions déconnecte tous les appareils', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const phone = await login(t, user);
      const laptop = await login(t, user);
      expect((await api(t).post('/v1/auth/logout').set(bearer(phone.accessToken)).send({ allSessions: true })).status).toBe(204);
      expect((await api(t).get('/v1/auth/me').set(bearer(laptop.accessToken))).status).toBe(401);
    });

    it('la déconnexion exige d\'être connecté', async () => {
      expect((await api(t).post('/v1/auth/logout').send({})).status).toBe(401);
    });
  });

  describe('mot de passe oublié', () => {
    it('réinitialise le mot de passe, révoque les sessions, et le lien ne sert qu\'une fois', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const session = await login(t, user);

      const asked = await api(t)
        .post('/v1/auth/forgot-password')
        .set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: user.email });
      expect(asked.status).toBe(202);
      const token = tokenFromMail(lastMailTo(t, user.email));

      const newPassword = strongPassword();
      const reset = await api(t).post('/v1/auth/reset-password').set('X-Forwarded-For', freshIp()).send({ token, newPassword });
      expect(reset.status).toBe(200);

      // Anciennes sessions mortes, ancien mot de passe refusé, nouveau accepté
      expect((await api(t).get('/v1/auth/me').set(bearer(session.accessToken))).status).toBe(401);
      const oldLogin = await api(t)
        .post('/v1/auth/login').set('X-Forwarded-For', freshIp())
        .send({ companySlug: company.slug, email: user.email, password: user.password });
      expect(oldLogin.status).toBe(401);
      await expect(login(t, { ...user, password: newPassword })).resolves.toBeDefined();

      const reuse = await api(t).post('/v1/auth/reset-password').set('X-Forwarded-For', freshIp()).send({ token, newPassword: strongPassword() });
      expect(reuse.status).toBe(400);
    });

    it('répond pareil pour un compte inconnu et n\'envoie aucun e-mail', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const known = await api(t).post('/v1/auth/forgot-password').set('X-Forwarded-For', freshIp()).send({ companySlug: company.slug, email: user.email });
      const unknown = await api(t).post('/v1/auth/forgot-password').set('X-Forwarded-For', freshIp()).send({ companySlug: company.slug, email: 'fantome@test.example' });
      const noCompany = await api(t).post('/v1/auth/forgot-password').set('X-Forwarded-For', freshIp()).send({ companySlug: 'inconnue', email: user.email });
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(noCompany.body).toEqual(known.body);
      expect(mailsTo(t, 'fantome@test.example')).toHaveLength(0);
    });

    it('refuse un mot de passe faible, un jeton expiré, et un compte désactivé', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      await api(t).post('/v1/auth/forgot-password').set('X-Forwarded-For', freshIp()).send({ companySlug: company.slug, email: user.email });
      const token = tokenFromMail(lastMailTo(t, user.email));
      const weak = await api(t).post('/v1/auth/reset-password').set('X-Forwarded-For', freshIp()).send({ token, newPassword: 'password123' });
      expect(weak.status).toBe(400);
      // Le mot de passe faible n'a pas consommé le jeton
      await t.admin.verificationToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await api(t).post('/v1/auth/reset-password').set('X-Forwarded-For', freshIp()).send({ token, newPassword: strongPassword() });
      expect(expired.status).toBe(400);

      const disabled = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL', status: 'DISABLED' });
      await api(t).post('/v1/auth/forgot-password').set('X-Forwarded-For', freshIp()).send({ companySlug: company.slug, email: disabled.email });
      expect(mailsTo(t, disabled.email)).toHaveLength(0);
    });

    it("la demande est limitée à 3 e-mails par heure et par adresse", async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      for (let i = 0; i < 6; i += 1) {
        const res = await api(t).post('/v1/auth/forgot-password').set('X-Forwarded-For', freshIp()).send({ companySlug: company.slug, email: user.email });
        expect(res.status).toBe(202);
      }
      expect(mailsTo(t, user.email)).toHaveLength(3);
    });
  });

  describe('isolation et suspension', () => {
    it('un jeton ne donne accès qu\'à son entreprise, quel que soit l\'en-tête envoyé', async () => {
      const other = await makeCompany(t);
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const session = await login(t, user);
      const res = await api(t)
        .get('/v1/auth/me')
        .set(bearer(session.accessToken))
        .set('X-Company-Slug', other.slug)
        .set('X-Company-Id', other.id);
      expect(res.body.companyId).toBe(company.id);
    });

    it('suspendre une entreprise coupe immédiatement les jetons existants et les connexions', async () => {
      const own = await makeCompany(t);
      const user = await makeUser(t, { company: own, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const session = await login(t, user);
      await t.admin.company.update({ where: { id: own.id }, data: { status: 'SUSPENDED' } });
      const me = await api(t).get('/v1/auth/me').set(bearer(session.accessToken));
      expect(me.status).toBe(403);
      expect(me.body.error.code).toBe('COMPANY_SUSPENDED');
      const again = await api(t)
        .post('/v1/auth/login').set('X-Forwarded-For', freshIp())
        .send({ companySlug: own.slug, email: user.email, password: user.password });
      expect(again.status).toBe(403);
    });
  });

  describe("journal d'audit des événements d'authentification", () => {
    it('enregistre inscription, confirmation, connexion, échec et déconnexion avec IP et identifiant de requête', async () => {
      const own = await makeCompany(t);
      const body = registerBody({ companySlug: own.slug });
      const ip = '203.0.113.7';
      await register(body, ip);
      await api(t).post('/v1/auth/verify-email').set('X-Forwarded-For', ip).send({ token: tokenFromMail(lastMailTo(t, body.email as string)) });
      await api(t).post('/v1/auth/login').set('X-Forwarded-For', ip).send({ companySlug: own.slug, email: body.email, password: 'Mauvais-mot-de-passe-1' });
      const session = await login(t, { slug: own.slug, email: body.email as string, password: body.password as string }, ip);
      await api(t).post('/v1/auth/logout').set(bearer(session.accessToken)).send({});

      const rows = await t.admin.auditLog.findMany({ where: { companyId: own.id }, orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.action)).toEqual([
        'auth.registered', 'auth.email_verified', 'auth.login_failed', 'auth.login', 'auth.logout',
      ]);
      expect(rows[0].ip).toBe(ip);
      expect(rows.every((r) => !!r.requestId)).toBe(true);
      // Aucun secret dans le journal
      expect(JSON.stringify(rows)).not.toMatch(/argon2|password|token/i);
    });
  });
});
