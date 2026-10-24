import {
  api,
  buildTestApp,
  freshIp,
  login,
  makeCompany,
  makeUser,
  strongPassword,
  uniq,
  type TestApp,
} from './helpers';

describe('Limitation de débit et verrouillage', () => {
  let t: TestApp;
  let company: { id: string; slug: string };

  beforeAll(async () => {
    t = await buildTestApp();
    company = await makeCompany(t);
  });
  afterAll(() => t.close());

  const attempt = (email: string, password: string, ip = freshIp()) =>
    api(t).post('/v1/auth/login').set('X-Forwarded-For', ip).send({ companySlug: company.slug, email, password });

  it('verrouille le compte après 5 échecs, même depuis des adresses IP différentes, y compris avec le bon mot de passe', async () => {
    const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
    for (let i = 0; i < 5; i += 1) {
      expect((await attempt(user.email, 'Mauvais-mot-de-passe-1')).status).toBe(401);
    }
    const locked = await attempt(user.email, user.password);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it("applique le même verrouillage à une adresse inexistante (aucune fuite sur l'existence du compte)", async () => {
    const email = `${uniq('fantome')}@test.example`;
    for (let i = 0; i < 5; i += 1) expect((await attempt(email, 'Mauvais-mot-de-passe-1')).status).toBe(401);
    const sixth = await attempt(email, 'Mauvais-mot-de-passe-1');
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('une connexion réussie remet le compteur à zéro', async () => {
    const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
    for (let i = 0; i < 3; i += 1) await attempt(user.email, 'Mauvais-mot-de-passe-1');
    await expect(login(t, user)).resolves.toBeDefined();
    for (let i = 0; i < 3; i += 1) expect((await attempt(user.email, 'Mauvais-mot-de-passe-1')).status).toBe(401);
    await expect(login(t, user)).resolves.toBeDefined();
  });

  it("le verrouillage d'un compte n'affecte pas les autres comptes", async () => {
    const victim = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
    const other = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
    for (let i = 0; i < 5; i += 1) await attempt(victim.email, 'Mauvais-mot-de-passe-1');
    expect((await attempt(victim.email, victim.password)).status).toBe(429);
    await expect(login(t, other)).resolves.toBeDefined();
  });

  it("limite les inscriptions à 10 par heure et par adresse IP, avec l'en-tête Retry-After", async () => {
    const ip = freshIp();
    const body = () => ({
      companySlug: company.slug,
      accountType: 'INDIVIDUAL',
      email: `${uniq('r')}@test.example`,
      password: strongPassword(),
      firstName: 'A',
      lastName: 'B',
      acceptTerms: true,
    });
    for (let i = 0; i < 10; i += 1) {
      expect((await api(t).post('/v1/auth/register').set('X-Forwarded-For', ip).send(body())).status).toBe(202);
    }
    const blocked = await api(t).post('/v1/auth/register').set('X-Forwarded-For', ip).send(body());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Une autre adresse n'est pas touchée
    expect((await api(t).post('/v1/auth/register').set('X-Forwarded-For', freshIp()).send(body())).status).toBe(202);
  });

  describe('Redis indisponible (erreur réseau)', () => {
    let degraded: TestApp;

    beforeAll(async () => {
      degraded = await buildTestApp({ REDIS_URL: 'redis://127.0.0.1:6390/1' });
    });
    afterAll(() => degraded.close());

    it('les routes de connexion échouent « fermé » (503) au lieu de laisser passer sans protection', async () => {
      const user = await makeUser(t, { company, roleCode: 'CUSTOMER_INDIVIDUAL' });
      const res = await api(degraded)
        .post('/v1/auth/login')
        .send({ companySlug: company.slug, email: user.email, password: user.password });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('RATE_LIMITER_UNAVAILABLE');
    });

    it('les routes ordinaires restent disponibles (limiteur global « ouvert ») et la sonde de disponibilité signale la panne', async () => {
      const anonymous = await api(degraded).get('/v1/auth/me');
      expect(anonymous.status).toBe(401);
      expect((await api(degraded).get('/health/live')).status).toBe(200);
      const ready = await api(degraded).get('/health/ready');
      expect(ready.status).toBe(503);
    });
  });
});
