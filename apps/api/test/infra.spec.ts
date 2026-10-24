import { createHash } from 'node:crypto';
import { CounterService } from '../src/infra/counter.service';
import { IdempotencyService } from '../src/infra/idempotency.service';
import { buildTestApp, makeCompany, type TestApp } from './helpers';

describe('Compteurs sans trou et idempotence', () => {
  let t: TestApp;
  let counters: CounterService;
  let idempotency: IdempotencyService;
  let company: { id: string; slug: string };
  let other: { id: string; slug: string };

  beforeAll(async () => {
    t = await buildTestApp();
    counters = t.app.get(CounterService);
    idempotency = t.app.get(IdempotencyService);
    company = await makeCompany(t);
    other = await makeCompany(t);
  });
  afterAll(() => t.close());

  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

  describe('CounterService', () => {
    it('30 incréments simultanés produisent exactement les numéros 1 à 30, sans doublon ni trou', async () => {
      const numbers = await Promise.all(
        Array.from({ length: 30 }, () => t.db.run({ companyId: company.id }, (tx) => counters.next(tx, company.id, 'invoice', 2026))),
      );
      expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    });

    it('les compteurs sont indépendants par nom, par année et par entreprise', async () => {
      const next = (companyId: string, name: string, year = 0) =>
        t.db.run({ companyId }, (tx) => counters.next(tx, companyId, name, year));
      expect(await next(company.id, 'receipt', 2026)).toBe(1);
      expect(await next(company.id, 'receipt', 2027)).toBe(1);
      expect(await next(other.id, 'receipt', 2026)).toBe(1);
      expect(await next(company.id, 'receipt', 2026)).toBe(2);
      expect(await next(company.id, 'customer-code')).toBe(1);
    });

    it("une transaction annulée ne consomme pas de numéro (pas de trou)", async () => {
      const before = await t.db.run({ companyId: company.id }, (tx) => counters.next(tx, company.id, 'rollback', 0));
      await expect(
        t.db.run({ companyId: company.id }, async (tx) => {
          await counters.next(tx, company.id, 'rollback', 0);
          throw new Error('échec après réservation du numéro');
        }),
      ).rejects.toThrow('échec');
      const after = await t.db.run({ companyId: company.id }, (tx) => counters.next(tx, company.id, 'rollback', 0));
      expect(after).toBe(before + 1);
    });

    it("l'application ne peut pas écrire un compteur d'une autre entreprise", async () => {
      await expect(
        t.db.run({ companyId: company.id }, (tx) => counters.next(tx, other.id, 'intrus', 0)),
      ).rejects.toThrow();
    });
  });

  describe('IdempotencyService', () => {
    const run = (key: string, body: unknown, operation: () => Promise<any>, companyId = company.id) =>
      t.db.run({ companyId }, (tx) =>
        idempotency.run(tx, { companyId, scope: 'test.operation', key, requestHash: hash(body) }, operation),
      );

    it("rejoue la réponse enregistrée sans réexécuter l'opération", async () => {
      let executions = 0;
      const op = async () => ({ executions: ++executions });
      const first = await run('cle-1', { montant: 10 }, op);
      const second = await run('cle-1', { montant: 10 }, op);
      expect(first).toEqual({ result: { executions: 1 }, replayed: false });
      expect(second).toEqual({ result: { executions: 1 }, replayed: true });
      expect(executions).toBe(1);
    });

    it('refuse la même clé avec un contenu différent (422)', async () => {
      await run('cle-2', { montant: 10 }, async () => ({ ok: true }));
      await expect(run('cle-2', { montant: 999 }, async () => ({ ok: true }))).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    });

    it("10 requêtes simultanées avec la même clé n'exécutent l'opération qu'une fois", async () => {
      let executions = 0;
      const op = async () => ({ numero: ++executions });
      const results = await Promise.all(Array.from({ length: 10 }, () => run('cle-concurrente', { a: 1 }, op)));
      expect(executions).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(new Set(results.map((r) => JSON.stringify(r.result))).size).toBe(1);
    });

    it("si l'opération échoue, la clé n'est pas conservée : le client peut réessayer", async () => {
      let attempts = 0;
      const flaky = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('panne temporaire');
        return { ok: true };
      };
      await expect(run('cle-3', { a: 1 }, flaky)).rejects.toThrow('panne');
      const retry = await run('cle-3', { a: 1 }, flaky);
      expect(retry).toEqual({ result: { ok: true }, replayed: false });
    });

    it('les clés sont propres à chaque entreprise', async () => {
      const a = await run('cle-4', { a: 1 }, async () => ({ de: 'A' }));
      const b = await run('cle-4', { a: 1 }, async () => ({ de: 'B' }), other.id);
      expect(a.result).toEqual({ de: 'A' });
      expect(b.result).toEqual({ de: 'B' });
      expect(b.replayed).toBe(false);
    });
  });
});
