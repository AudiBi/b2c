import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { api, bearer, buildTestApp, makeTenant, makeWarehouse, type TestApp } from './helpers';
import { buildPlan, normalizePhone, type RawDb } from '../../../scripts/import-gestion/mapping';

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'scripts/import-gestion/exemple-export.json');
const NOW = new Date('2026-11-13T12:00:00Z');

describe("Import de l'outil de gestion", () => {
  describe('lecture et rapport (aucune écriture)', () => {
    const db = JSON.parse(require('node:fs').readFileSync(EXAMPLE, 'utf8')) as RawDb;
    const plan = buildPlan(db, NOW);

    it('normalise les téléphones et refuse ceux qui ne sont pas internationaux', () => {
      expect(normalizePhone('+1 (305) 555-0101')).toBe('+13055550101');
      expect(normalizePhone('34-33-33-33')).toBeNull();
      expect(normalizePhone(undefined)).toBeNull();
    });

    it('retient les clients nommés et les colis valides, archive les anciens colis livrés', () => {
      expect(plan.customers.map((c) => c.legacyId)).toEqual([1, 2, 3]);
      expect(plan.packages.map((p) => p.legacyCode)).toEqual(['B2C-261001-0001', 'B2C-261002-0001', 'B2C-261003-0001']);
      expect(plan.skipped.closedTooOld).toBe(1);
      expect(plan.stats.byStatus).toEqual({ DELIVERED: 1, IN_TRANSIT: 1, RECEIVED_AT_WAREHOUSE: 1 });
    });

    it('signale chaque anomalie par type', () => {
      const kinds = plan.issues.map((i) => i.kind).sort();
      expect(kinds).toEqual(['CLIENT_INTROUVABLE', 'CLIENT_SANS_NOM', 'CODE_EN_DOUBLE', 'EMAIL_INVALIDE', 'MESURES_ABSENTES', 'STATUT_INCONNU', 'TELEPHONE_EN_DOUBLE', 'TELEPHONE_INVALIDE', 'TELEPHONE_INVALIDE']);
    });

    it('convertit les mesures (lb → kg, pouces → cm) et calcule les soldes ouverts sans compter les colis livrés', () => {
      const first = plan.packages[0];
      expect(first.weightKg).toBeCloseTo(18.144, 3);
      expect(first.dimsCm).toEqual({ length: 60.96, width: 45.72, height: 40.64 });
      expect(first.balanceDue).toBe(0);
      expect(plan.stats.openBalanceByCustomer).toEqual({ 2: 72, 3: 50 });
    });

    it('avec --estimer-mesures, garde le colis sans mesures en le marquant estimé', () => {
      const estimated = buildPlan(db, NOW, { estimateMissingMeasures: true });
      const drum = estimated.packages.find((p) => p.legacyCode === 'B2C-261006-0001');
      expect(drum?.measuresEstimated).toBe(true);
      expect(estimated.issues.some((i) => i.kind === 'MESURES_ESTIMEES')).toBe(true);
      expect(estimated.stats.openBalanceByCustomer[2]).toBe(292);
    });

    it("garde le client sans e-mail valide sans e-mail et note l'adresse", () => {
      expect(plan.customers[2].email).toBeNull();
      expect(plan.customers[1].note).toContain('Fort Lauderdale');
    });
  });

  describe('import réel', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await buildTestApp();
    });
    afterAll(() => t.close());

    const run = (args: string[], env: Record<string, string> = {}) =>
      execFileSync(process.execPath, [resolve(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'scripts/import-gestion/run.ts', ...args], {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });

    it('écrit clients sans accès et colis avec leur statut, puis refuse un second import', async () => {
      const tenant = await makeTenant(t);
      const warehouse = await makeWarehouse(t, tenant.token);
      const env = { IMPORT_DATABASE_URL: process.env.TEST_DIRECT_URL ?? '' };
      expect(env.IMPORT_DATABASE_URL).not.toBe('');
      const output = run(['--file', EXAMPLE, '--company', tenant.company.slug, '--warehouse', warehouse.reference, '--apply'], env);
      expect(output).toContain('Import terminé : 3 client(s), 3 colis.');

      const customers = await api(t).get('/v1/admin/customers').set(bearer(tenant.token));
      expect(customers.body.items).toHaveLength(3);
      expect(customers.body.items.filter((c: any) => c.hasAccess)).toHaveLength(1);

      const delivered = await api(t).get('/v1/admin/packages').query({ status: 'DELIVERED' }).set(bearer(tenant.token));
      expect(delivered.body.items).toHaveLength(1);
      const transit = await api(t).get('/v1/admin/packages').query({ status: 'IN_TRANSIT' }).set(bearer(tenant.token));
      expect(transit.body.items).toHaveLength(1);

      expect(() => run(['--file', EXAMPLE, '--company', tenant.company.slug, '--warehouse', warehouse.reference, '--apply'], env)).toThrow(/contient déjà des colis/);
    });
  });
});
