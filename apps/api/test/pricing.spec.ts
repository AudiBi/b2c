import { v7 as uuidv7 } from 'uuid';
import {
  activateRateCard,
  api,
  bearer,
  buildTestApp,
  cardBody,
  makeCustomer,
  makeTenant,
  makeUser,
  login,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Grilles tarifaires et calculateur', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  const createCard = (token: string, overrides: Record<string, unknown> = {}) =>
    api(t).post('/v1/admin/rate-cards').set(bearer(token)).send(cardBody(overrides));

  const quote = (slug: string, body: Record<string, unknown>) =>
    api(t).post(`/v1/public/companies/${slug}/quote`).send({ transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 2.3, unit: 'KG' }, ...body });

  describe('administration des grilles', () => {
    it('crée une grille EN BROUILLON, la relit et la liste', async () => {
      const tenant = await makeTenant(t);
      const created = await createCard(tenant.token);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ status: 'DRAFT', version: 1, currency: 'USD', transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT' });
      expect(created.body.rules).toHaveLength(2);
      expect(created.body.surcharges.map((s: any) => s.code).sort()).toEqual(['HANDLING', 'INSURANCE']);

      const got = await api(t).get(`/v1/admin/rate-cards/${created.body.id}`).set(bearer(tenant.token));
      expect(got.status).toBe(200);
      expect(got.body.rules[0]).toMatchObject({ weightFrom: '0', weightTo: '5', pricePerUnit: '4', minCharge: '3' });

      const list = await api(t).get('/v1/admin/rate-cards').set(bearer(tenant.token));
      expect(list.body.items.map((c: any) => c.id)).toEqual([created.body.id]);
      expect((await api(t).get('/v1/admin/rate-cards?status=ACTIVE').set(bearer(tenant.token))).body.items).toHaveLength(0);
    });

    it('refuse les données invalides', async () => {
      const { token } = await makeTenant(t);
      const bad: Record<string, unknown>[] = [
        { rules: [] },
        { volumetricDivisor: 0 },
        { currency: 'GBP' },
        { weightUnit: 'OZ' },
        { originCountry: 'USA' },
        { validTo: '2019-01-01' },
        { validFrom: '01/01/2020' },
        { rules: [{ weightFrom: 5, weightTo: 2, pricePerUnit: 1 }] },
        { rules: [{ weightFrom: 0, pricePerUnit: -1 }] },
        { surcharges: [{ code: 'x', name: { fr: 'a', ht: 'a', en: 'a' }, kind: 'SURCHARGE', method: 'FLAT', value: 1 }] },
        { unknownField: true },
      ];
      for (const override of bad) {
        const res = await createCard(token, override);
        expect([400, 422]).toContain(res.status);
      }
      // codes de suppléments en double
      const dup = { code: 'DUP', name: { fr: 'a', ht: 'a', en: 'a' }, kind: 'SURCHARGE', method: 'FLAT', value: 1 };
      expect((await createCard(token, { surcharges: [dup, dup] })).status).toBe(400);
    });

    it('refuse des combinaisons de suppléments incohérentes', async () => {
      const { token } = await makeTenant(t);
      const name = { fr: 'a', ht: 'a', en: 'a' };
      const cases = [
        { code: 'AA', name, kind: 'SURCHARGE', method: 'PERCENT_OF_SUBTOTAL', value: 5 },
        { code: 'BB', name, kind: 'TAX', method: 'PERCENT_OF_FREIGHT', value: 5 },
        { code: 'CC', name, kind: 'TAX', method: 'FLAT', value: 5, optional: true },
      ];
      for (const surcharge of cases) {
        const res = await createCard(token, { surcharges: [surcharge] });
        expect(res.status).toBe(400);
        expect(errorCode(res)).toBe('INVALID_SURCHARGE');
      }
    });

    it('refuse deux tranches qui se chevauchent pour la même catégorie', async () => {
      const { token } = await makeTenant(t);
      const res = await createCard(token, {
        rules: [
          { weightFrom: 0, weightTo: 5, pricePerUnit: 4 },
          { weightFrom: 4, pricePerUnit: 3 },
        ],
      });
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('RULES_OVERLAP');
    });

    it('refuse une catégorie inconnue dans une tranche', async () => {
      const { token } = await makeTenant(t);
      const res = await createCard(token, { rules: [{ categoryCode: 'NOPE', weightFrom: 0, pricePerUnit: 1 }] });
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('CATEGORY_UNKNOWN');
    });

    it('remplace un brouillon (version +1), le supprime, et répond 404 pour une grille inconnue', async () => {
      const { token } = await makeTenant(t);
      const draft = (await createCard(token)).body;
      const replaced = await api(t)
        .put(`/v1/admin/rate-cards/${draft.id}`)
        .set(bearer(token))
        .send(cardBody({ name: 'Renommée', rules: [{ weightFrom: 0, pricePerUnit: 5 }], surcharges: [] }));
      expect(replaced.status).toBe(200);
      expect(replaced.body).toMatchObject({ name: 'Renommée', version: 2 });
      expect(replaced.body.rules).toHaveLength(1);
      expect(replaced.body.surcharges).toHaveLength(0);

      expect((await api(t).delete(`/v1/admin/rate-cards/${draft.id}`).set(bearer(token))).status).toBe(204);
      expect((await api(t).get(`/v1/admin/rate-cards/${draft.id}`).set(bearer(token))).status).toBe(404);
      expect((await api(t).get(`/v1/admin/rate-cards/${uuidv7()}`).set(bearer(token))).status).toBe(404);
      expect((await api(t).put(`/v1/admin/rate-cards/${uuidv7()}`).set(bearer(token)).send(cardBody())).status).toBe(404);
    });

    it('une grille ACTIVE ne se modifie pas, ne se supprime pas, ne s’active pas deux fois', async () => {
      const { token } = await makeTenant(t);
      const active = await activateRateCard(t, token);
      const put = await api(t).put(`/v1/admin/rate-cards/${active.id}`).set(bearer(token)).send(cardBody({ name: 'Autre' }));
      expect(put.status).toBe(409);
      expect(errorCode(put)).toBe('RATE_CARD_IMMUTABLE');

      const del = await api(t).delete(`/v1/admin/rate-cards/${active.id}`).set(bearer(token));
      expect(del.status).toBe(409);
      expect(errorCode(del)).toBe('RATE_CARD_NOT_DRAFT');

      const again = await api(t).post(`/v1/admin/rate-cards/${active.id}/activate`).set(bearer(token));
      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('RATE_CARD_NOT_DRAFT');
    });

    it('la base refuse elle-même de modifier une grille active ou ses tranches, même contournant l’API', async () => {
      const { token } = await makeTenant(t);
      const active = await activateRateCard(t, token);
      await expect(t.admin.rateCard.update({ where: { id: active.id }, data: { name: 'Piratée' } })).rejects.toThrow(/immuable/);
      await expect(t.admin.rateCard.update({ where: { id: active.id }, data: { status: 'DRAFT' } })).rejects.toThrow(/immuable/);
      await expect(t.admin.rateCard.delete({ where: { id: active.id } })).rejects.toThrow(/brouillon/);
      const rule = await t.admin.rateRule.findFirstOrThrow({ where: { rateCardId: active.id } });
      await expect(t.admin.rateRule.update({ where: { id: rule.id }, data: { pricePerUnit: 0 } })).rejects.toThrow(/immuables/);
      await expect(t.admin.rateRule.delete({ where: { id: rule.id } })).rejects.toThrow(/immuables/);
      const surcharge = await t.admin.rateSurcharge.findFirstOrThrow({ where: { rateCardId: active.id } });
      await expect(t.admin.rateSurcharge.update({ where: { id: surcharge.id }, data: { value: 0 } })).rejects.toThrow(/immuables/);
    });

    it('deux grilles actives ne couvrent pas la même période ; des périodes adjacentes sont acceptées', async () => {
      const { token } = await makeTenant(t);
      const first = await activateRateCard(t, token, { validFrom: '2020-01-01', validTo: '2025-01-01' });
      expect(first.id).toBeDefined();

      const overlapping = (await createCard(token, { validFrom: '2024-06-01' })).body;
      const clash = await api(t).post(`/v1/admin/rate-cards/${overlapping.id}/activate`).set(bearer(token));
      expect(clash.status).toBe(409);
      expect(errorCode(clash)).toBe('RATE_CARD_PERIOD_OVERLAP');

      const next = await activateRateCard(t, token, { validFrom: '2025-01-01' });
      expect(next.id).toBeDefined();

      // un autre mode de transport n'entre pas en conflit
      const sea = await activateRateCard(t, token, { transportMode: 'SEA' });
      expect(sea.id).toBeDefined();
    });

    it('retire une grille (fin de validité aujourd’hui), puis la duplique en brouillon de version suivante', async () => {
      const { token, company } = await makeTenant(t);
      const active = await activateRateCard(t, token);
      expect((await quote(company.slug, {})).status).toBe(200);

      const retired = await api(t).post(`/v1/admin/rate-cards/${active.id}/retire`).set(bearer(token));
      expect(retired.status).toBe(200);
      expect(retired.body.status).toBe('RETIRED');
      expect(retired.body.validTo).toBe(new Date().toISOString().slice(0, 10));
      expect(errorCode(await api(t).post(`/v1/admin/rate-cards/${active.id}/retire`).set(bearer(token)))).toBe('RATE_CARD_NOT_ACTIVE');

      // plus aucun tarif : jamais de prix par défaut
      const afterRetire = await quote(company.slug, {});
      expect(afterRetire.status).toBe(422);
      expect(errorCode(afterRetire)).toBe('TARIFF_UNAVAILABLE');

      const copy = await api(t).post(`/v1/admin/rate-cards/${active.id}/duplicate`).set(bearer(token));
      expect(copy.status).toBe(201);
      expect(copy.body).toMatchObject({ status: 'DRAFT', version: 2, validTo: null });
      expect(copy.body.name).toMatch(/\(copie\)$/);
      expect(copy.body.rules).toEqual(retired.body.rules);
      expect(copy.body.surcharges).toEqual(retired.body.surcharges);
    });

    it('journalise la création, l’activation et le retrait', async () => {
      const { token, company } = await makeTenant(t);
      const active = await activateRateCard(t, token);
      await api(t).post(`/v1/admin/rate-cards/${active.id}/retire`).set(bearer(token));
      const actions = (await t.admin.auditLog.findMany({ where: { companyId: company.id, entityId: active.id } })).map((a) => a.action).sort();
      expect(actions).toEqual(['ratecard.activated', 'ratecard.created', 'ratecard.retired']);
    });
  });

  describe('catégories de marchandises', () => {
    it('crée, modifie, refuse un doublon et liste', async () => {
      const { token } = await makeTenant(t);
      const name = { fr: 'Électronique', ht: 'Elektwonik', en: 'Electronics' };
      const created = await api(t).post('/v1/admin/categories').set(bearer(token)).send({ code: 'elec', name });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'ELEC', restricted: false, active: true });

      const dup = await api(t).post('/v1/admin/categories').set(bearer(token)).send({ code: 'ELEC', name });
      expect(dup.status).toBe(409);
      expect(errorCode(dup)).toBe('CATEGORY_CODE_USED');

      const patched = await api(t).patch(`/v1/admin/categories/${created.body.id}`).set(bearer(token)).send({ restricted: true });
      expect(patched.body.restricted).toBe(true);
      // renommer ne doit pas remettre « restreinte » à faux
      const renamed = await api(t).patch('/v1/admin/categories/' + created.body.id).set(bearer(token)).send({ name: { fr: 'x', ht: 'x', en: 'x' } });
      expect(renamed.body).toMatchObject({ restricted: true, active: true });
      expect((await api(t).patch(`/v1/admin/categories/${uuidv7()}`).set(bearer(token)).send({ restricted: true })).status).toBe(404);
      expect((await api(t).patch(`/v1/admin/categories/${created.body.id}`).set(bearer(token)).send({})).status).toBe(400);

      const list = await api(t).get('/v1/admin/categories').set(bearer(token));
      expect(list.body.items.map((c: any) => c.code)).toEqual(['ELEC']);
    });

    it('une règle propre à une catégorie est appliquée au calcul', async () => {
      const { token, company } = await makeTenant(t);
      await api(t).post('/v1/admin/categories').set(bearer(token)).send({ code: 'ELEC', name: { fr: 'a', ht: 'a', en: 'a' } });
      await activateRateCard(t, token, {
        rules: [
          { weightFrom: 0, pricePerUnit: 4 },
          { categoryCode: 'ELEC', weightFrom: 0, pricePerUnit: 6 },
        ],
        surcharges: [],
      });
      expect((await quote(company.slug, {})).body.result.freight).toBe('10.00');
      expect((await quote(company.slug, { categoryCode: 'ELEC' })).body.result.freight).toBe('15.00');
    });
  });

  describe('contrôle d’accès', () => {
    it('sans connexion : 401 ; client : 403 ; agent de facturation : lecture seule', async () => {
      const { token, company } = await makeTenant(t);
      const active = await activateRateCard(t, token);

      expect((await api(t).get('/v1/admin/rate-cards')).status).toBe(401);
      expect((await api(t).post('/v1/admin/rate-cards').send(cardBody())).status).toBe(401);

      const customer = await makeCustomer(t, company);
      expect((await api(t).get('/v1/admin/rate-cards').set(bearer(customer.token))).status).toBe(403);
      expect((await api(t).post('/v1/admin/rate-cards').set(bearer(customer.token)).send(cardBody())).status).toBe(403);

      const billing = await makeUser(t, { company, roleCode: 'BILLING_AGENT' });
      const billingToken = (await login(t, billing)).accessToken;
      expect((await api(t).get('/v1/admin/rate-cards').set(bearer(billingToken))).status).toBe(200);
      expect((await api(t).post('/v1/admin/rate-cards').set(bearer(billingToken)).send(cardBody())).status).toBe(403);
      expect((await api(t).post(`/v1/admin/rate-cards/${active.id}/retire`).set(bearer(billingToken))).status).toBe(403);
      expect((await api(t).post('/v1/admin/categories').set(bearer(billingToken)).send({ code: 'XX', name: { fr: 'a', ht: 'a', en: 'a' } })).status).toBe(403);
    });

    it('une entreprise ne voit ni ne touche les grilles d’une autre', async () => {
      const a = await makeTenant(t);
      const b = await makeTenant(t);
      const cardA = await activateRateCard(t, a.token);

      expect((await api(t).get(`/v1/admin/rate-cards/${cardA.id}`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).post(`/v1/admin/rate-cards/${cardA.id}/retire`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).post(`/v1/admin/rate-cards/${cardA.id}/duplicate`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).get('/v1/admin/rate-cards').set(bearer(b.token))).body.items).toHaveLength(0);

      // et le calculateur public de B ne connaît pas les tarifs de A
      const res = await quote(b.company.slug, {});
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('TARIFF_UNAVAILABLE');
      expect((await quote(a.company.slug, {})).status).toBe(200);
    });
  });

  describe('calculateur public', () => {
    it('sans aucune grille publiée : liste vide et 422 TARIFF_UNAVAILABLE (aucun prix inventé)', async () => {
      const { company } = await makeTenant(t);
      const options = await api(t).get(`/v1/public/companies/${company.slug}/rates`);
      expect(options.status).toBe(200);
      expect(options.body).toEqual({ corridors: [], categories: [] });
      const res = await quote(company.slug, {});
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('TARIFF_UNAVAILABLE');
    });

    it('publie les trajets, services optionnels et catégories — sans aucun tarif', async () => {
      const { token, company } = await makeTenant(t);
      await api(t).post('/v1/admin/categories').set(bearer(token)).send({ code: 'ELEC', name: { fr: 'a', ht: 'a', en: 'a' } });
      await activateRateCard(t, token);
      await createCard(token, { name: 'brouillon non publié', transportMode: 'SEA' });

      const res = await api(t).get(`/v1/public/companies/${company.slug}/rates`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('max-age=60');
      expect(res.body.corridors).toHaveLength(1);
      expect(res.body.corridors[0]).toMatchObject({ transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', currency: 'USD', weightUnit: 'KG', dimensionUnit: 'CM' });
      expect(res.body.corridors[0].optionalSurcharges.map((s: any) => s.code)).toEqual(['INSURANCE']);
      expect(res.body.categories.map((c: any) => c.code)).toEqual(['ELEC']);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/pricePerUnit|flatFee|minCharge|brouillon/);
    });

    it('un slug inconnu ou une entreprise suspendue répondent 404', async () => {
      expect((await api(t).get('/v1/public/companies/nope-nope/rates')).status).toBe(404);
      expect((await quote('nope-nope', {})).status).toBe(404);
      const suspended = await t.admin.company.create({ data: { name: 'Suspendue', slug: `s${Date.now()}`, status: 'SUSPENDED' } });
      expect((await api(t).get(`/v1/public/companies/${suspended.slug}/rates`)).status).toBe(404);
    });

    it('estime les frais, détaille le calcul et se déclare « estimation »', async () => {
      const { token, company } = await makeTenant(t);
      const card = await activateRateCard(t, token);
      const res = await quote(company.slug, { weight: { value: 2.3, unit: 'KG' } });
      expect(res.status).toBe(200);
      expect(res.body.isEstimate).toBe(true);
      expect(res.body.card).toMatchObject({ id: card.id, version: 1 });
      expect(res.body.result).toMatchObject({ currency: 'USD', billableWeight: '2.500', freight: '10.00', total: '11.50' });
      expect(res.body.result.lines.map((l: any) => l.code)).toEqual(['FREIGHT', 'HANDLING']);
    });

    it('applique le poids volumétrique, les livres, l’assurance sur la valeur déclarée', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token);
      const volumetric = await quote(company.slug, {
        weight: { value: 2, unit: 'KG' },
        dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
      });
      expect(volumetric.body.result).toMatchObject({ volumetricWeight: '4.800', billableWeight: '5.000', freight: '17.50' });

      const pounds = await quote(company.slug, { weight: { value: 10, unit: 'LB' } });
      expect(pounds.body.result).toMatchObject({ actualWeight: '4.536', billableWeight: '5.000' });

      const insured = await quote(company.slug, { declaredValue: 100, optionalSurcharges: ['insurance'] });
      expect(insured.body.result.total).toBe('13.50');
      const noValue = await quote(company.slug, { optionalSurcharges: ['INSURANCE'] });
      expect(noValue.status).toBe(400);
      expect(errorCode(noValue)).toBe('MISSING_DECLARED_VALUE');
      const unknown = await quote(company.slug, { optionalSurcharges: ['HANDLING'] });
      expect(unknown.status).toBe(400);
      expect(errorCode(unknown)).toBe('UNKNOWN_SURCHARGE');
    });

    it('422 pour un trajet ou un mode non tarifé, un poids hors tranches', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token, { rules: [{ weightFrom: 0, weightTo: 5, pricePerUnit: 4 }] });
      for (const body of [{ transportMode: 'SEA' }, { originCountry: 'FR' }, { destinationCountry: 'DO' }, { weight: { value: 9, unit: 'KG' } }]) {
        const res = await quote(company.slug, body);
        expect(res.status).toBe(422);
        expect(errorCode(res)).toBe('TARIFF_UNAVAILABLE');
      }
    });

    it('une grille qui commence dans le futur ou qui a expiré n’est pas utilisée', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token, { validFrom: '2020-01-01', validTo: '2021-01-01' });
      await activateRateCard(t, token, { validFrom: '2999-01-01' });
      expect(errorCode(await quote(company.slug, {}))).toBe('TARIFF_UNAVAILABLE');
      expect((await api(t).get(`/v1/public/companies/${company.slug}/rates`)).body.corridors).toEqual([]);
    });

    it('catégorie inconnue : 400 ; catégorie restreinte : 422', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token);
      await api(t).post('/v1/admin/categories').set(bearer(token)).send({ code: 'BATT', name: { fr: 'a', ht: 'a', en: 'a' }, restricted: true });
      const unknown = await quote(company.slug, { categoryCode: 'NOPE' });
      expect(unknown.status).toBe(400);
      expect(errorCode(unknown)).toBe('CATEGORY_UNKNOWN');
      const restricted = await quote(company.slug, { categoryCode: 'BATT' });
      expect(restricted.status).toBe(422);
      expect(errorCode(restricted)).toBe('CATEGORY_RESTRICTED');
    });

    it('valide les entrées', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token);
      const bad: Record<string, unknown>[] = [
        { weight: { value: 0, unit: 'KG' } },
        { weight: { value: -1, unit: 'KG' } },
        { weight: { value: 1.0001, unit: 'KG' } },
        { weight: { value: 1, unit: 'OZ' } },
        { weight: { value: 1 } },
        { dimensions: { length: 1, width: 1, unit: 'CM' } },
        { dimensions: { length: 0, width: 1, height: 1, unit: 'CM' } },
        { declaredValue: 10.123 },
        { transportMode: 'ROAD' },
        { originCountry: 'usa' },
        { extra: 'x' },
      ];
      for (const body of bad) expect((await quote(company.slug, body)).status).toBe(400);
    });

    it('n’enregistre rien pour un visiteur anonyme', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token);
      await quote(company.slug, {});
      await quote(company.slug, {});
      expect(await t.admin.quote.count({ where: { companyId: company.id } })).toBe(0);
    });

    it('limite le débit des estimations par adresse IP', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token);
      const ip = '203.0.113.77';
      let limited = 0;
      for (let i = 0; i < 65; i += 1) {
        const res = await api(t)
          .post(`/v1/public/companies/${company.slug}/quote`)
          .set('X-Forwarded-For', ip)
          .send({ transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 1, unit: 'KG' } });
        if (res.status === 429) limited += 1;
      }
      expect(limited).toBeGreaterThan(0);
    });
  });

  describe('estimations du client connecté', () => {
    it('enregistre les estimations dans l’historique du client, jamais dans celui d’un autre', async () => {
      const { token, company } = await makeTenant(t);
      await activateRateCard(t, token);
      const mine = await makeCustomer(t, company);
      const other = await makeCustomer(t, company);

      const body = { transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 2.3, unit: 'KG' } };
      const saved = await api(t).post('/v1/me/quotes').set(bearer(mine.token)).send(body);
      expect(saved.status).toBe(201);
      expect(saved.body).toMatchObject({ isEstimate: true });
      expect(saved.body.id).toBeDefined();
      expect(saved.body.result.total).toBe('11.50');

      const history = await api(t).get('/v1/me/quotes').set(bearer(mine.token));
      expect(history.body.items).toHaveLength(1);
      expect(history.body.items[0].id).toBe(saved.body.id);
      expect((await api(t).get('/v1/me/quotes').set(bearer(other.token))).body.items).toHaveLength(0);

      // l'estimation garde la grille et la version utilisées, même si la grille est retirée ensuite
      const row = await t.admin.quote.findUniqueOrThrow({ where: { id: saved.body.id } });
      expect(row.rateCardId).toBe(saved.body.card.id);
    });

    it('sans connexion : 401 ; le personnel : 403 (réservé aux comptes clients)', async () => {
      const { token } = await makeTenant(t);
      const body = { transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 1, unit: 'KG' } };
      expect((await api(t).post('/v1/me/quotes').send(body)).status).toBe(401);
      expect((await api(t).get('/v1/me/quotes')).status).toBe(401);
      const staff = await api(t).post('/v1/me/quotes').set(bearer(token)).send(body);
      expect(staff.status).toBe(403);
      expect(errorCode(staff)).toBe('CUSTOMER_ONLY');
    });

    it('sans grille, le client reçoit 422 et rien n’est enregistré', async () => {
      const { company } = await makeTenant(t);
      const customer = await makeCustomer(t, company);
      const res = await api(t).post('/v1/me/quotes').set(bearer(customer.token)).send({ transportMode: 'AIR', originCountry: 'US', destinationCountry: 'HT', weight: { value: 1, unit: 'KG' } });
      expect(res.status).toBe(422);
      expect(await t.admin.quote.count({ where: { companyId: company.id } })).toBe(0);
    });
  });
});
