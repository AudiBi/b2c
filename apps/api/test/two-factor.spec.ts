import { api, bearer, buildTestApp, login, makeCompany, makeCustomer, makeTenant, makeUser, uniq, type TestApp, type TestUser } from './helpers';
import { base32Decode, hotp, stepAt } from '../src/security/totp';

const errorCode = (res: { body: any }) => res.body?.error?.code;
const codeAt = (secret: string, offsetSteps = 0, now = Date.now()) => hotp(base32Decode(secret), stepAt(now) + offsetSteps);

describe('Double authentification (TOTP)', () => {
  let t: TestApp;
  let strict: TestApp; // même application, double authentification obligatoire pour le personnel
  beforeAll(async () => {
    t = await buildTestApp();
    strict = await buildTestApp({ REQUIRE_STAFF_2FA: 'true' });
  });
  afterAll(async () => {
    await t.close();
    await strict.close();
  });

  async function staffWithToken(app: TestApp = t, roleCode: 'BILLING_AGENT' | 'COMPANY_ADMIN' = 'BILLING_AGENT') {
    const company = await makeCompany(app);
    const user = await makeUser(app, { company, roleCode });
    const session = await login(app, user);
    return { company, user, token: session.accessToken };
  }
  const post = (app: TestApp, path: string, token: string, body: unknown) => api(app).post(path).set(bearer(token)).send(body as object);
  const loginWith = (app: TestApp, user: TestUser, extra: Record<string, unknown> = {}) =>
    api(app).post('/v1/auth/login').send({ companySlug: user.slug, email: user.email, password: user.password, ...extra });

  /** Active la double authentification et renvoie le secret et les codes de secours. */
  async function enrol(app: TestApp, user: TestUser, token: string) {
    const setup = await post(app, '/v1/me/2fa/setup', token, { password: user.password });
    expect(setup.status).toBe(200);
    const enable = await post(app, '/v1/me/2fa/enable', token, { code: codeAt(setup.body.secret) });
    if (enable.status !== 200) throw new Error(JSON.stringify(enable.body));
    return { secret: setup.body.secret as string, recoveryCodes: enable.body.recoveryCodes as string[] };
  }
  /** Simule le passage du temps : le dernier code accepté est reculé de 10 périodes. */
  const rewind = (userId: string) => t.admin.$executeRaw`UPDATE users SET totp_last_step = totp_last_step - 10 WHERE id = ${userId}::uuid`;

  describe('activation', () => {
    it('par défaut : désactivée, ni obligatoire, ni en cours', async () => {
      const { token } = await staffWithToken();
      const status = await api(t).get('/v1/me/2fa').set(bearer(token));
      expect(status.body).toEqual({ enabled: false, pending: false, required: false, recoveryCodesLeft: 0 });
      expect((await api(t).get('/v1/me/2fa')).status).toBe(401);
    });

    it('le secret exige le mot de passe, est chiffré en base et n’est montré qu’à l’activation', async () => {
      const { user, token } = await staffWithToken();
      expect(errorCode(await post(t, '/v1/me/2fa/setup', token, { password: 'mauvais-mot-de-passe' }))).toBe('INVALID_CURRENT_PASSWORD');
      const setup = await post(t, '/v1/me/2fa/setup', token, { password: user.password });
      expect(setup.status).toBe(200);
      expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.body.otpauthUri).toContain(`secret=${setup.body.secret}`);
      const stored = await t.admin.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.totpSecretEnc).toMatch(/^v1\./);
      expect(stored.totpSecretEnc).not.toContain(setup.body.secret);
      expect(stored.totpEnabledAt).toBeNull();
      expect((await api(t).get('/v1/me/2fa').set(bearer(token))).body).toMatchObject({ enabled: false, pending: true });
    });

    it('active avec un code valide : 10 codes de secours uniques, stockés sous forme d’empreinte ; un code faux est refusé', async () => {
      const { user, token } = await staffWithToken();
      const setup = await post(t, '/v1/me/2fa/setup', token, { password: user.password });
      const wrong = codeAt(setup.body.secret) === '000000' ? '111111' : '000000';
      expect(errorCode(await post(t, '/v1/me/2fa/enable', token, { code: wrong }))).toBe('INVALID_TOTP');
      expect((await post(t, '/v1/me/2fa/enable', token, { code: 'abc' })).status).toBe(400);
      const enable = await post(t, '/v1/me/2fa/enable', token, { code: codeAt(setup.body.secret) });
      expect(enable.status).toBe(200);
      const codes: string[] = enable.body.recoveryCodes;
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      const rows = await t.admin.totpRecoveryCode.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(10);
      expect(JSON.stringify(rows)).not.toContain(codes[0]);
      expect((await api(t).get('/v1/me/2fa').set(bearer(token))).body).toMatchObject({ enabled: true, pending: false, recoveryCodesLeft: 10 });
      // déjà active : ni nouvelle activation, ni nouveau secret
      expect(errorCode(await post(t, '/v1/me/2fa/setup', token, { password: user.password }))).toBe('TOTP_ALREADY_ENABLED');
      expect(errorCode(await post(t, '/v1/me/2fa/enable', token, { code: codeAt(setup.body.secret) }))).toBe('TOTP_ALREADY_ENABLED');
    });

    it('activer sans avoir démarré, ou avec trop d’erreurs : refusé', async () => {
      const { user, token } = await staffWithToken();
      expect(errorCode(await post(t, '/v1/me/2fa/enable', token, { code: '123456' }))).toBe('TOTP_SETUP_REQUIRED');
      const setup = await post(t, '/v1/me/2fa/setup', token, { password: user.password });
      const wrong = codeAt(setup.body.secret) === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) expect(errorCode(await post(t, '/v1/me/2fa/enable', token, { code: wrong }))).toBe('INVALID_TOTP');
      const locked = await post(t, '/v1/me/2fa/enable', token, { code: codeAt(setup.body.secret) });
      expect(locked.status).toBe(429);
      expect(errorCode(locked)).toBe('TOO_MANY_ATTEMPTS');
    });

    it('un client peut aussi l’activer pour son propre compte ; elle ne se partage pas entre comptes', async () => {
      const tenant = await makeTenant(t);
      const customer = await makeCustomer(t, tenant.company);
      await enrol(t, customer.user, customer.token);
      const other = await staffWithToken();
      expect((await api(t).get('/v1/me/2fa').set(bearer(other.token))).body.enabled).toBe(false);
    });
  });

  describe('connexion', () => {
    it('mot de passe correct mais pas de code : TOTP_REQUIRED ; un mauvais mot de passe ne révèle rien du second facteur', async () => {
      const { user, token } = await staffWithToken();
      await enrol(t, user, token);
      const res = await loginWith(t, user);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('TOTP_REQUIRED');
      expect(res.body.accessToken).toBeUndefined();
      expect(errorCode(await loginWith(t, { ...user, password: 'mauvais-mot-de-passe-1' }))).toBe('INVALID_CREDENTIALS');
    });

    it('code valide : connexion ; le même code ne sert pas deux fois (rejeu) ; la période voisine est tolérée, pas la suivante', async () => {
      const { user, token } = await staffWithToken();
      const { secret } = await enrol(t, user, token);
      await rewind(user.id);
      const code = codeAt(secret);
      const ok = await loginWith(t, user, { totpCode: code });
      expect(ok.status).toBe(200);
      expect(ok.body.accessToken).toBeTruthy();
      const replay = await loginWith(t, user, { totpCode: code });
      expect(errorCode(replay)).toBe('INVALID_TOTP');
      // un code de la période précédente est plus ancien que le dernier accepté : refusé aussi
      expect(errorCode(await loginWith(t, user, { totpCode: codeAt(secret, -1) }))).toBe('INVALID_TOTP');
      // période suivante (tolérance d’horloge) : acceptée, puis plus rien d’antérieur
      expect((await loginWith(t, user, { totpCode: codeAt(secret, 1) })).status).toBe(200);
      expect(errorCode(await loginWith(t, user, { totpCode: codeAt(secret, 5) }))).toBe('INVALID_TOTP');
    });

    it('deux connexions simultanées avec le même code : une seule réussit', async () => {
      const { user, token } = await staffWithToken();
      const { secret } = await enrol(t, user, token);
      await rewind(user.id);
      const code = codeAt(secret);
      const results = await Promise.all([loginWith(t, user, { totpCode: code }), loginWith(t, user, { totpCode: code }), loginWith(t, user, { totpCode: code })]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('les codes faux comptent comme des échecs de connexion : après 5, le compte est verrouillé même avec le bon code', async () => {
      const { user, token } = await staffWithToken();
      const { secret } = await enrol(t, user, token);
      await rewind(user.id);
      const wrong = codeAt(secret) === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) expect(errorCode(await loginWith(t, user, { totpCode: wrong }))).toBe('INVALID_TOTP');
      const locked = await loginWith(t, user, { totpCode: codeAt(secret) });
      expect(locked.status).toBe(429);
      expect(errorCode(locked)).toBe('ACCOUNT_LOCKED');
    });

    it('codes de secours : usage unique, majuscules tolérées, compte décroissant ; un code et un secours ensemble sont refusés', async () => {
      const { user, token } = await staffWithToken();
      const { secret, recoveryCodes } = await enrol(t, user, token);
      const ok = await loginWith(t, user, { recoveryCode: recoveryCodes[0].toUpperCase() });
      expect(ok.status).toBe(200);
      expect(errorCode(await loginWith(t, user, { recoveryCode: recoveryCodes[0] }))).toBe('INVALID_TOTP');
      expect((await api(t).get('/v1/me/2fa').set(bearer(ok.body.accessToken))).body.recoveryCodesLeft).toBe(9);
      expect(errorCode(await loginWith(t, user, { recoveryCode: 'zzzz-zzzz' }))).toBe('INVALID_TOTP');
      expect((await loginWith(t, user, { recoveryCode: recoveryCodes[1], totpCode: codeAt(secret) })).status).toBe(400);
      expect((await loginWith(t, user, { recoveryCode: 'pas-un-code' })).status).toBe(400);
      expect(await t.admin.auditLog.count({ where: { companyId: user.companyId, action: 'auth.recovery_code_used' } })).toBe(1);
    });

    it('un compte sans double authentification se connecte comme avant ; le code envoyé en trop est ignoré', async () => {
      const { user } = await staffWithToken();
      expect((await loginWith(t, user)).status).toBe(200);
      expect((await loginWith(t, user, { totpCode: '123456' })).status).toBe(200);
    });
  });

  describe('désactivation et codes de secours', () => {
    it('désactiver exige le mot de passe ET un code ; tout est effacé ; la connexion redevient simple', async () => {
      const { user, token } = await staffWithToken();
      const { secret, recoveryCodes } = await enrol(t, user, token);
      await rewind(user.id);
      expect(errorCode(await post(t, '/v1/me/2fa/disable', token, { password: 'mauvais-mot-de-passe-1', totpCode: codeAt(secret) }))).toBe('INVALID_CURRENT_PASSWORD');
      expect(errorCode(await post(t, '/v1/me/2fa/disable', token, { password: user.password, totpCode: codeAt(secret) === '000000' ? '111111' : '000000' }))).toBe('INVALID_TOTP');
      expect((await post(t, '/v1/me/2fa/disable', token, { password: user.password })).status).toBe(400); // aucun code
      const off = await post(t, '/v1/me/2fa/disable', token, { password: user.password, recoveryCode: recoveryCodes[3] });
      expect(off.status).toBe(204);
      const stored = await t.admin.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null });
      expect(await t.admin.totpRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
      expect((await loginWith(t, user)).status).toBe(200);
      expect(errorCode(await post(t, '/v1/me/2fa/disable', token, { password: user.password, totpCode: '123456' }))).toBe('TOTP_NOT_ENABLED');
    });

    it('régénérer les codes de secours : les anciens ne servent plus', async () => {
      const { user, token } = await staffWithToken();
      const { secret, recoveryCodes } = await enrol(t, user, token);
      await rewind(user.id);
      const fresh = await post(t, '/v1/me/2fa/recovery-codes', token, { password: user.password, totpCode: codeAt(secret) });
      expect(fresh.status).toBe(200);
      expect(fresh.body.recoveryCodes).toHaveLength(10);
      expect(fresh.body.recoveryCodes).not.toContain(recoveryCodes[0]);
      expect(errorCode(await loginWith(t, user, { recoveryCode: recoveryCodes[0] }))).toBe('INVALID_TOTP');
      expect((await loginWith(t, user, { recoveryCode: fresh.body.recoveryCodes[0] })).status).toBe(200);
    });
  });

  describe('obligation pour le personnel (REQUIRE_STAFF_2FA)', () => {
    it('sans activation, le personnel ne peut rien faire d’autre que s’activer, lire son profil et se déconnecter', async () => {
      const { user, token } = await staffWithToken(strict, 'COMPANY_ADMIN');
      const blocked = await api(strict).get('/v1/admin/users').set(bearer(token));
      expect(blocked.status).toBe(403);
      expect(errorCode(blocked)).toBe('TOTP_ENROLLMENT_REQUIRED');
      expect(errorCode(await api(strict).get('/v1/admin/shipments').set(bearer(token)))).toBe('TOTP_ENROLLMENT_REQUIRED');
      expect(errorCode(await api(strict).post('/v1/auth/change-password').set(bearer(token)).send({ currentPassword: 'x', newPassword: 'y' }))).toBe('TOTP_ENROLLMENT_REQUIRED');

      const me = await api(strict).get('/v1/auth/me').set(bearer(token));
      expect(me.status).toBe(200);
      expect(me.body.mfa).toEqual({ enabled: false, required: true, enrollmentRequired: true });
      expect((await api(strict).get('/v1/me/2fa').set(bearer(token))).body).toMatchObject({ required: true, enabled: false });

      await enrol(strict, user, token);
      expect((await api(strict).get('/v1/admin/users').set(bearer(token))).status).toBe(200);
      expect((await api(strict).get('/v1/auth/me').set(bearer(token))).body.mfa).toEqual({ enabled: true, required: true, enrollmentRequired: false });
    });

    it('la désactivation est refusée quand la politique l’impose', async () => {
      const { user, token } = await staffWithToken(strict, 'COMPANY_ADMIN');
      const { recoveryCodes } = await enrol(strict, user, token);
      const refused = await post(strict, '/v1/me/2fa/disable', token, { password: user.password, recoveryCode: recoveryCodes[0] });
      expect(refused.status).toBe(409);
      expect(errorCode(refused)).toBe('TOTP_REQUIRED_BY_POLICY');
    });

    it('les clients ne sont pas concernés', async () => {
      const tenant = await makeTenant(strict);
      const customer = await makeCustomer(strict, tenant.company);
      expect((await api(strict).get('/v1/me/profile').set(bearer(customer.token))).status).toBe(200);
      expect((await api(strict).get('/v1/auth/me').set(bearer(customer.token))).body.mfa).toEqual({ enabled: false, required: false, enrollmentRequired: false });
    });

    it('les routes publiques ne sont pas touchées', async () => {
      expect((await api(strict).get('/health/live')).status).toBe(200);
    });
  });

  describe('base de données', () => {
    it('secret présent seulement si la double authentification est active ; codes de secours inaltérables', async () => {
      const { user, token } = await staffWithToken();
      await expect(t.admin.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } })).rejects.toThrow();
      const { recoveryCodes } = await enrol(t, user, token);
      const row = await t.admin.totpRecoveryCode.findFirstOrThrow({ where: { userId: user.id } });
      await expect(t.admin.totpRecoveryCode.update({ where: { id: row.id }, data: { codeHash: 'a'.repeat(64) } })).rejects.toThrow(/ne se modifie pas/);
      await loginWith(t, user, { recoveryCode: recoveryCodes[0] });
      const used = await t.admin.totpRecoveryCode.findMany({ where: { userId: user.id, usedAt: { not: null } } });
      await expect(t.admin.totpRecoveryCode.update({ where: { id: used[0].id }, data: { usedAt: null } })).rejects.toThrow(/ne change plus/);
    });

    it('chaque entreprise ne voit que ses propres codes de secours (isolation)', async () => {
      const a = await staffWithToken();
      const b = await staffWithToken();
      await enrol(t, a.user, a.token);
      const count = await t.db.run({ companyId: b.company.id }, (tx) => tx.totpRecoveryCode.count());
      expect(count).toBe(0);
      expect(uniq('x')).toBeTruthy();
    });
  });
});
