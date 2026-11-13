/**
 * Mise en place des données réelles de B2C Shipping Express (coordonnées, entrepôts, agence, catégories, grilles, taux, table CONATEL).
 * Passe par l'API réelle, donc toutes les règles s'appliquent ; rejouable : ce qui existe déjà n'est jamais modifié ni dupliqué.
 * Valeurs reprises de l'outil de gestion (à relire avant la mise en service) : aérien 5 $/lb (diviseur 166, 132 pour l'e-conteneur),
 * maritime 18 $/pi³, baril 220 $, taux 135 gourdes pour 1 dollar.
 */

export type Call = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<{ status: number; body: any }>;

export interface SetupOptions {
  /** Date de début de validité des grilles (AAAA-MM-JJ). */
  validFrom: string;
  log?: (line: string) => void;
}

export const CONTACT = {
  email: 'info@b2cxpress.com',
  phones: ['+50934589898', '+50935433535'],
  address: '48, rue Clerveaux, Pétion-Ville, Haïti',
};

export const WAREHOUSES = [
  { reference: 'MIA', name: 'Entrepôt de Miami', country: 'us', city: 'Miami', addressLine: '3060 NW 72nd Ave, Miami, FL 33122', addressTemplate: ['{customerName}', '{customerCode} {mode}', '3060 NW 72nd Ave', 'Miami, FL 33122'] },
  { reference: 'PHL', name: 'Entrepôt de Philadelphie', country: 'us', city: 'Philadelphie', addressLine: '1245 Passmore St, Philadelphia, PA 19111', addressTemplate: ['{customerName}', '{customerCode} {mode}', '1245 Passmore St', 'Philadelphia, PA 19111'] },
];

export const AGENCIES = [{ code: 'PV', name: 'Agence de Pétion-Ville', country: 'ht', city: 'Pétion-Ville', addressLine: '48, rue Clerveaux', phone: '+50934589898' }];

export const CATEGORIES = [
  { code: 'E_CONTAINER', name: { fr: 'E-conteneur', ht: 'E-kontenè', en: 'E-container' } },
  { code: 'DRUM', name: { fr: 'Baril', ht: 'Barik', en: 'Drum' } },
];

export const FX_HTG_PER_USD = 135;

export const cards = (validFrom: string) => [
  {
    name: 'Aérien États-Unis → Haïti',
    transportMode: 'AIR',
    originCountry: 'US',
    destinationCountry: 'HT',
    currency: 'USD',
    weightUnit: 'LB',
    dimensionUnit: 'IN',
    volumetricDivisor: 166,
    minBillableWeight: 0,
    roundingMode: 'NONE',
    roundingStep: 1,
    validFrom,
    rules: [
      { weightFrom: 0, pricePerUnit: 5, basis: 'WEIGHT' },
      { categoryCode: 'E_CONTAINER', weightFrom: 0, pricePerUnit: 5, basis: 'WEIGHT', volumetricDivisor: 132 },
    ],
    surcharges: [],
  },
  {
    name: 'Maritime États-Unis → Haïti',
    transportMode: 'SEA',
    originCountry: 'US',
    destinationCountry: 'HT',
    currency: 'USD',
    weightUnit: 'LB',
    dimensionUnit: 'IN',
    volumetricDivisor: 166,
    minBillableWeight: 0,
    roundingMode: 'NONE',
    roundingStep: 1,
    validFrom,
    rules: [
      { weightFrom: 0, pricePerUnit: 18, basis: 'VOLUME' },
      { categoryCode: 'DRUM', weightFrom: 0, pricePerUnit: 220, basis: 'UNIT' },
    ],
    surcharges: [],
  },
];

export async function runSetup(call: Call, options: SetupOptions): Promise<{ created: string[]; kept: string[] }> {
  const log = options.log ?? (() => undefined);
  const created: string[] = [];
  const kept: string[] = [];
  const ok = (r: { status: number; body: any }, what: string) => {
    if (r.status >= 400) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
    return r.body;
  };
  const done = (what: string, isNew: boolean) => {
    (isNew ? created : kept).push(what);
    log(`  ${isNew ? '+' : '='} ${what}`);
  };

  // Coordonnées publiques : seulement si rien n'est renseigné (jamais d'écrasement)
  const contact = ok(await call('GET', '/v1/admin/settings/public-contact'), 'lecture des coordonnées');
  if (!contact.email && (contact.phones ?? []).length === 0 && !contact.address) {
    ok(await call('PUT', '/v1/admin/settings/public-contact', CONTACT), 'coordonnées');
    done('coordonnées publiques', true);
  } else done('coordonnées publiques', false);

  const warehouses = ok(await call('GET', '/v1/admin/warehouses'), 'entrepôts').items as { reference: string }[];
  for (const w of WAREHOUSES) {
    if (warehouses.some((x) => x.reference === w.reference)) done(`entrepôt ${w.reference}`, false);
    else {
      ok(await call('POST', '/v1/admin/warehouses', w), `entrepôt ${w.reference}`);
      done(`entrepôt ${w.reference}`, true);
    }
  }

  const agencies = ok(await call('GET', '/v1/admin/agencies'), 'agences').items as { code: string }[];
  for (const a of AGENCIES) {
    if (agencies.some((x) => x.code === a.code)) done(`agence ${a.code}`, false);
    else {
      ok(await call('POST', '/v1/admin/agencies', a), `agence ${a.code}`);
      done(`agence ${a.code}`, true);
    }
  }

  const categories = ok(await call('GET', '/v1/admin/categories'), 'catégories').items as { code: string }[];
  for (const c of CATEGORIES) {
    if (categories.some((x) => x.code === c.code)) done(`catégorie ${c.code}`, false);
    else {
      ok(await call('POST', '/v1/admin/categories', c), `catégorie ${c.code}`);
      done(`catégorie ${c.code}`, true);
    }
  }

  // Grilles : une grille active par mode suffit ; si une existe déjà, on n'y touche pas (une nouvelle version se crée à la main)
  const existing = ok(await call('GET', '/v1/admin/rate-cards?status=ACTIVE'), 'grilles').items as { transportMode: string; originCountry: string; destinationCountry: string }[];
  for (const card of cards(options.validFrom)) {
    if (existing.some((c) => c.transportMode === card.transportMode && c.originCountry === card.originCountry && c.destinationCountry === card.destinationCountry)) {
      done(`grille ${card.name}`, false);
      continue;
    }
    const draft = ok(await call('POST', '/v1/admin/rate-cards', card), `grille ${card.name}`);
    ok(await call('POST', `/v1/admin/rate-cards/${draft.id}/activate`), `activation de ${card.name}`);
    done(`grille ${card.name} (active)`, true);
  }

  const fx = ok(await call('GET', '/v1/admin/settings/fx-rate'), 'taux');
  if (fx.current === null) {
    ok(await call('PUT', '/v1/admin/settings/fx-rate', { htgPerUsd: FX_HTG_PER_USD, note: 'Taux initial repris de l’outil de gestion' }), 'taux');
    done(`taux ${FX_HTG_PER_USD} HTG / USD`, true);
  } else done('taux gourdes', false);

  const defaults = ok(await call('POST', '/v1/admin/customs-items/defaults'), 'table CONATEL');
  done(`table CONATEL (${defaults.added} article(s) ajouté(s))`, defaults.added > 0);

  return { created, kept };
}
