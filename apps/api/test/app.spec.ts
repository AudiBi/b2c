import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { AppException } from '../src/common/errors';
import { loadEnv } from '../src/config/env';
import { redact } from '../src/audit/audit.service';
import { PasswordService } from '../src/security/password.service';
import { TokenService, randomSecret, sha256 } from '../src/security/token.service';
import { ConfigService } from '../src/config/config.module';
import { api, buildTestApp, type TestApp } from './helpers';

describe('Application', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp({ CORS_ORIGINS: 'https://app.example.test' });
  });
  afterAll(() => t.close());

  describe('santé et en-têtes', () => {
    it('/health/live et /health/ready répondent quand PostgreSQL et Redis sont disponibles', async () => {
      expect((await api(t).get('/health/live')).body).toEqual({ status: 'ok' });
      const ready = await api(t).get('/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body.checks).toEqual({ database: true, redis: true });
    });

    it("renvoie un identifiant de requête, conserve celui du client s'il est valide et remplace les valeurs douteuses", async () => {
      const generated = await api(t).get('/health/live');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const kept = await api(t).get('/health/live').set('X-Request-Id', 'client-req-12345');
      expect(kept.headers['x-request-id']).toBe('client-req-12345');
      const replaced = await api(t).get('/health/live').set('X-Request-Id', 'a b<script>');
      expect(replaced.headers['x-request-id']).not.toContain('<');
    });

    it('applique les en-têtes de sécurité et ne révèle pas le framework', async () => {
      const res = await api(t).get('/health/live');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
    });

    it("n'autorise en CORS que les origines configurées", async () => {
      const allowed = await api(t).get('/health/live').set('Origin', 'https://app.example.test');
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.test');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      const denied = await api(t).get('/health/live').set('Origin', 'https://pirate.example');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe("format d'erreur", () => {
    it('une route inconnue renvoie une erreur JSON structurée avec identifiant de requête', async () => {
      const res = await api(t).get('/v1/nexiste-pas');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });

    it('une méthode non prévue est refusée sans exposer de détail interne', async () => {
      const res = await api(t).put('/v1/auth/login').send({});
      expect([404, 405]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|node_modules|stack/);
    });

    it('un corps trop volumineux est refusé (413)', async () => {
      const res = await api(t).post('/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(300_000) });
      expect(res.status).toBe(413);
    });

    it("une erreur interne n'expose ni message ni trace (filtre testé directement)", () => {
      const filter = new AllExceptionsFilter();
      let captured: { status?: number; body?: any } = {};
      const response = {
        setHeader: () => undefined,
        status(code: number) {
          captured.status = code;
          return { json: (body: unknown) => (captured.body = body) };
        },
      };
      const host = {
        switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers: { 'x-request-id': 'rid-1' }, path: '/x' }) }),
      } as any;

      filter.catch(new Error('mot de passe de la base : hunter2 (table users)'), host);
      expect(captured.status).toBe(500);
      expect(captured.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne', requestId: 'rid-1' } });

      filter.catch(new AppException(409, 'X', 'conflit'), host);
      expect(captured.status).toBe(409);
      filter.catch(new HttpException('interdit', 403), host);
      expect(captured.body.error.code).toBe('FORBIDDEN');
      filter.catch(new Prisma.PrismaClientKnownRequestError('boom', { code: 'P2002', clientVersion: 'x' }), host);
      expect(captured.status).toBe(409);
      filter.catch(new Prisma.PrismaClientKnownRequestError('boom', { code: 'P2003', clientVersion: 'x' }), host);
      expect(captured.status).toBe(500);
    });
  });

  describe('configuration', () => {
    const base = {
      DATABASE_URL: 'postgresql://x',
      REDIS_URL: 'redis://x',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
    } as NodeJS.ProcessEnv;

    it("refuse de démarrer avec un secret JWT trop court et liste toutes les erreurs", () => {
      const attempt = () => loadEnv({ ...base, JWT_ACCESS_SECRET: 'court', API_PORT: 'abc' });
      expect(attempt).toThrow(/JWT_ACCESS_SECRET/);
      expect(attempt).toThrow(/API_PORT/);
    });

    it('applique des valeurs par défaut sûres en développement', () => {
      const env = loadEnv(base);
      expect(env).toMatchObject({ NODE_ENV: 'development', COOKIE_SECURE: false, TRUST_PROXY: false, ACCESS_TOKEN_TTL_SECONDS: 900 });
    });

    it('impose des réglages sûrs en production', () => {
      const prod = { ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
      expect(() => loadEnv(prod)).toThrow(/COOKIE_SECURE/);
      expect(() => loadEnv({ ...prod, COOKIE_SECURE: 'true', MAIL_TRANSPORT: 'memory' })).toThrow(/MAIL_TRANSPORT/);
      expect(() => loadEnv({ ...prod, COOKIE_SECURE: 'true', ARGON2_MEMORY_KIB: '4096' })).toThrow(/ARGON2_MEMORY_KIB/);
      expect(() => loadEnv({ ...prod, COOKIE_SECURE: 'true', JWT_ACCESS_SECRET: '__JWT_SECRET__'.padEnd(40, 'x') })).toThrow(/substitution/);
      expect(loadEnv({ ...prod, COOKIE_SECURE: 'true' }).NODE_ENV).toBe('production');
    });
  });
});

describe('Briques de sécurité (tests unitaires)', () => {
  const config = new ConfigService(
    loadEnv({ DATABASE_URL: 'x', REDIS_URL: 'x', JWT_ACCESS_SECRET: 'b'.repeat(40), ARGON2_MEMORY_KIB: '4096' } as NodeJS.ProcessEnv),
  );

  it('PasswordService : argon2id, sel unique, vérification correcte et factice sans exception', async () => {
    const passwords = new PasswordService(config);
    const [a, b] = await Promise.all([passwords.hash('Un-mot-de-passe-solide-1'), passwords.hash('Un-mot-de-passe-solide-1')]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(await passwords.verifyOrDummy(a, 'Un-mot-de-passe-solide-1')).toBe(true);
    expect(await passwords.verifyOrDummy(a, 'autre')).toBe(false);
    expect(await passwords.verifyOrDummy(null, 'peu importe')).toBe(false);
    expect(await passwords.verifyOrDummy('pas-un-hash', 'peu importe')).toBe(false);
  });

  it('TokenService : formats des jetons, comparaison de condensés et refus des formes invalides', () => {
    const tokens = new TokenService(config);
    const company = '00000000-0000-7000-8000-0000000000aa';
    const session = '00000000-0000-7000-8000-0000000000bb';
    const secret = randomSecret();
    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(randomSecret()).not.toBe(secret);

    const refresh = tokens.formatRefresh(company, session, secret);
    expect(tokens.parseRefresh(refresh)).toEqual({ companyId: company, sessionId: session, secret });
    for (const bad of ['', 'a.b.c', `${company}.${session}`, `${company}.${session}.court`, `x.${session}.${secret}`]) {
      expect(tokens.parseRefresh(bad)).toBeNull();
    }
    expect(tokens.parseOneTime(tokens.formatOneTime(company, secret))).toEqual({ companyId: company, secret });
    expect(tokens.parseOneTime(`${company}.court`)).toBeNull();

    expect(tokens.hashesMatch(sha256(secret), secret)).toBe(true);
    expect(tokens.hashesMatch(sha256(secret), `${secret}x`)).toBe(false);
    expect(tokens.hashesMatch('zz', secret)).toBe(false);
  });

  it("redact() masque tout champ pouvant contenir un secret, y compris imbriqué", () => {
    const cleaned = redact({
      email: 'a@b.co',
      password: 'secret',
      nested: { refreshToken: 'abc', ok: 1, list: [{ passwordHash: 'x', name: 'n' }] },
      Authorization: 'Bearer x',
      totpSecret: 'y',
    });
    expect(cleaned).toEqual({
      email: 'a@b.co',
      password: '[masqué]',
      nested: { refreshToken: '[masqué]', ok: 1, list: [{ passwordHash: '[masqué]', name: 'n' }] },
      Authorization: '[masqué]',
      totpSecret: '[masqué]',
    });
    expect(redact(undefined)).toBeUndefined();
  });
});
