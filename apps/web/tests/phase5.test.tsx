import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../src/App';
import { catalogs } from '../src/i18n';
import { AppProviders } from '../src/providers';

const fr = catalogs.fr;
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Handler = object | ((init: RequestInit | undefined, url: URL) => Response | Promise<Response>);
const fetchMock = vi.fn();

/** Simule l'API : « METHODE /chemin » → corps JSON (200) ou fonction. Tout le reste répond 404. */
function mockApi(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = handlers[key];
    if (handler === undefined) return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    return typeof handler === 'function' ? (handler as (i: RequestInit | undefined, u: URL) => Response | Promise<Response>)(init, url) : json(200, handler);
  });
}
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([input, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}` === key);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

function renderAt(url: string) {
  return render(
    <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'b2c_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

const RATES = '/v1/public/companies/demo/rates';
const QUOTE = '/v1/public/companies/demo/quote';
const corridor = {
  transportMode: 'AIR',
  originCountry: 'US',
  destinationCountry: 'HT',
  currency: 'USD',
  weightUnit: 'KG',
  dimensionUnit: 'CM',
  optionalSurcharges: [{ code: 'INSURANCE', name: { fr: 'Assurance', ht: 'Asirans', en: 'Insurance' }, method: 'PERCENT_OF_DECLARED_VALUE', value: '2' }],
};
const quoteResponse = {
  isEstimate: true,
  card: { id: 'c1', name: 'Grille aérienne', version: 3 },
  result: {
    currency: 'USD',
    weightUnit: 'KG',
    actualWeight: '2.300',
    volumetricWeight: null,
    chargeableBeforeRounding: '2.300',
    roundedWeight: '2.500',
    billableWeight: '2.500',
    freight: '10.00',
    lines: [
      { code: 'FREIGHT', kind: 'FREIGHT', label: null, amount: '10.00' },
      { code: 'HANDLING', kind: 'SURCHARGE', label: { fr: 'Manutention', ht: 'Manitansyon', en: 'Handling' }, amount: '1.50' },
    ],
    subtotal: '11.50',
    total: '11.50',
  },
};

describe('calculateur de frais', () => {
  it('sans grille publiée : explication honnête, aucun formulaire, aucun prix', async () => {
    mockApi({ [`GET ${RATES}`]: { corridors: [], categories: [] } });
    renderAt('/fr/calculator');
    expect(await screen.findByText(fr.calculator.noRatesTitle)).toBeInTheDocument();
    expect(screen.getByText(fr.calculator.noRates)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.calculator.form.submit })).not.toBeInTheDocument();
  });

  it('estime les frais : envoie des mesures en nombres, affiche le détail et le total', async () => {
    mockApi({ [`GET ${RATES}`]: { corridors: [corridor], categories: [] }, [`POST ${QUOTE}`]: quoteResponse });
    const user = userEvent.setup();
    renderAt('/fr/calculator');
    await user.type(await screen.findByLabelText(fr.calculator.form.weight), '2,3');
    await user.click(screen.getByRole('button', { name: fr.calculator.form.submit }));

    const result = await screen.findByTestId('quote-result');
    expect(within(result).getByText(fr.calculator.result.badge)).toBeInTheDocument();
    expect(within(result).getByTestId('billable-weight')).toHaveTextContent('2,5 kg');
    expect(within(result).getByTestId('quote-total')).toHaveTextContent(/11,50/);
    expect(within(result).getByText('Manutention')).toBeInTheDocument();
    expect(within(result).getByText(fr.calculator.result.disclaimer)).toBeInTheDocument();
    expect(within(result).getByText(fr.calculator.result.notProvided)).toBeInTheDocument();

    expect(calls(`POST ${QUOTE}`)).toHaveLength(1);
    expect(bodyOf(calls(`POST ${QUOTE}`)[0])).toEqual({
      transportMode: 'AIR',
      originCountry: 'US',
      destinationCountry: 'HT',
      weight: { value: 2.3, unit: 'KG' },
      optionalSurcharges: [],
      quantity: 1,
    });
    // aucun appel authentifié pour un visiteur
    expect(calls('POST /v1/me/quotes')).toHaveLength(0);
  });

  it('transmet dimensions, valeur déclarée et service facultatif choisi', async () => {
    mockApi({ [`GET ${RATES}`]: { corridors: [corridor], categories: [] }, [`POST ${QUOTE}`]: quoteResponse });
    const user = userEvent.setup();
    renderAt('/fr/calculator');
    await user.type(await screen.findByLabelText(fr.calculator.form.weight), '2');
    await user.type(screen.getByLabelText(/Longueur/), '40');
    await user.type(screen.getByLabelText(/Largeur/), '30');
    await user.type(screen.getByLabelText(/Hauteur/), '20');
    await user.type(screen.getByLabelText(/Valeur déclarée/), '100');
    await user.click(screen.getByLabelText('Assurance'));
    await user.click(screen.getByRole('button', { name: fr.calculator.form.submit }));
    await screen.findByTestId('quote-result');
    expect(bodyOf(calls(`POST ${QUOTE}`)[0])).toMatchObject({
      weight: { value: 2, unit: 'KG' },
      dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
      declaredValue: 100,
      optionalSurcharges: ['INSURANCE'],
      quantity: 1,
    });
  });

  it('valide la saisie en français, sans appeler le serveur', async () => {
    mockApi({ [`GET ${RATES}`]: { corridors: [corridor], categories: [] } });
    const user = userEvent.setup();
    renderAt('/fr/calculator');
    const weight = await screen.findByLabelText(fr.calculator.form.weight);

    await user.click(screen.getByRole('button', { name: fr.calculator.form.submit }));
    expect(await screen.findByText(fr.validation.required)).toBeInTheDocument();
    expect(weight).toHaveAttribute('aria-invalid', 'true');

    await user.type(weight, 'abc');
    await user.click(screen.getByRole('button', { name: fr.calculator.form.submit }));
    expect(await screen.findByText(fr.validation.number)).toBeInTheDocument();

    await user.clear(weight);
    await user.type(weight, '2,0005');
    await user.click(screen.getByRole('button', { name: fr.calculator.form.submit }));
    expect(await screen.findByText(fr.validation.weightDecimals)).toBeInTheDocument();

    await user.clear(weight);
    await user.type(weight, '2');
    await user.type(screen.getByLabelText(/Longueur/), '40');
    await user.click(screen.getByRole('button', { name: fr.calculator.form.submit }));
    expect((await screen.findAllByText(fr.validation.required)).length).toBeGreaterThanOrEqual(2); // largeur et hauteur manquantes
    expect(calls(`POST ${QUOTE}`)).toHaveLength(0);
  });

  it('affiche le refus du serveur (aucun tarif) au lieu d’un prix', async () => {
    mockApi({
      [`GET ${RATES}`]: { corridors: [corridor], categories: [] },
      [`POST ${QUOTE}`]: () => json(422, { error: { code: 'TARIFF_UNAVAILABLE', message: 'x' } }),
    });
    const user = userEvent.setup();
    renderAt('/fr/calculator');
    await user.type(await screen.findByLabelText(fr.calculator.form.weight), '99');
    await user.click(screen.getByRole('button', { name: fr.calculator.form.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.auth.errors.TARIFF_UNAVAILABLE);
    expect(screen.queryByTestId('quote-result')).not.toBeInTheDocument();
  });
});

describe('suivi public', () => {
  const tracked = {
    trackingNumber: 'EE-ABCDE-12345-X',
    status: 'ON_HOLD',
    lastUpdate: '2026-03-02T10:00:00.000Z',
    transportMode: 'AIR',
    origin: { country: 'US', city: 'Miami' },
    destination: { country: 'HT', city: null },
    estimatedDelivery: null,
    events: [
      { type: 'PREALERT_CREATED', status: 'PREALERT_CREATED', occurredAt: '2026-03-01T09:00:00.000Z', location: 'Miami', reasonCode: null },
      { type: 'STATUS_CHANGE', status: 'AWAITING_RECEIPT', occurredAt: '2026-03-01T09:00:01.000Z', location: 'Miami', reasonCode: null },
      { type: 'STATUS_CHANGE', status: 'ON_HOLD', occurredAt: '2026-03-02T10:00:00.000Z', location: 'Miami', reasonCode: 'CUSTOMS' },
    ],
  };

  it('cherche le numéro saisi, affiche statut et historique du plus récent au plus ancien', async () => {
    mockApi({ 'GET /v1/public/tracking/EE-ABCDE-12345-X': tracked });
    const user = userEvent.setup();
    renderAt('/fr/tracking');
    await user.type(screen.getByLabelText(fr.tracking.form.label), '  EE-ABCDE-12345-X ');
    await user.click(screen.getByRole('button', { name: fr.tracking.form.submit }));

    const result = await screen.findByTestId('tracking-result');
    expect(within(result).getByRole('heading', { name: 'Colis EE-ABCDE-12345-X' })).toBeInTheDocument();
    expect(within(result).getAllByText(fr.packageStatus.ON_HOLD).length).toBeGreaterThan(0);
    const steps = within(within(result).getByRole('list', { name: fr.tracking.result.historyTitle })).getAllByRole('listitem');
    expect(steps.map((s) => s.querySelector('strong')?.textContent)).toEqual([fr.packageStatus.ON_HOLD, fr.packageStatus.AWAITING_RECEIPT, fr.packageStatus.PREALERT_CREATED]);
    expect(steps[0]).toHaveTextContent(fr.holdReasons.CUSTOMS);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    // pas de date de livraison inventée
    expect(within(result).getByText(fr.tracking.result.noEstimate)).toBeInTheDocument();
  });

  it('un lien avec ?n= lance la recherche tout seul', async () => {
    mockApi({ 'GET /v1/public/tracking/EE-ABCDE-12345-X': tracked });
    renderAt('/fr/tracking?n=EE-ABCDE-12345-X');
    expect(await screen.findByTestId('tracking-result')).toBeInTheDocument();
    expect(screen.getByLabelText(fr.tracking.form.label)).toHaveValue('EE-ABCDE-12345-X');
  });

  it('relancer la recherche du même numéro relit le serveur (le colis a pu changer de statut)', async () => {
    let status = 'AWAITING_RECEIPT';
    mockApi({ 'GET /v1/public/tracking/EE-ABCDE-12345-X': () => json(200, { ...tracked, status, events: [] }) });
    const user = userEvent.setup();
    renderAt('/fr/tracking?n=EE-ABCDE-12345-X');
    const result = await screen.findByTestId('tracking-result');
    expect(within(result).getAllByText(fr.packageStatus.AWAITING_RECEIPT).length).toBeGreaterThan(0);
    status = 'DELIVERED';
    await user.click(screen.getByRole('button', { name: fr.tracking.form.submit }));
    await waitFor(() => expect(within(screen.getByTestId('tracking-result')).getAllByText(fr.packageStatus.DELIVERED).length).toBeGreaterThan(0));
    expect(calls('GET /v1/public/tracking/EE-ABCDE-12345-X')).toHaveLength(2);
  });

  it('numéro inconnu : message neutre, sans résultat', async () => {
    mockApi({ 'GET /v1/public/tracking/INCONNU12345': () => json(404, { error: { code: 'TRACKING_NOT_FOUND', message: 'x' } }) });
    const user = userEvent.setup();
    renderAt('/ht/tracking');
    await user.type(screen.getByLabelText(catalogs.ht.tracking.form.label), 'INCONNU12345');
    await user.click(screen.getByRole('button', { name: catalogs.ht.tracking.form.submit }));
    expect(await screen.findByText(catalogs.ht.tracking.notFound)).toBeInTheDocument();
    expect(screen.queryByTestId('tracking-result')).not.toBeInTheDocument();
  });

  it('trop de demandes : message de limitation', async () => {
    mockApi({ 'GET /v1/public/tracking/ABCDEFGH123': () => json(429, { error: { code: 'RATE_LIMITED', message: 'x' } }) });
    const user = userEvent.setup();
    renderAt('/fr/tracking?n=ABCDEFGH123');
    expect(await screen.findByText(fr.auth.errors.RATE_LIMITED)).toBeInTheDocument();
    void user;
  });
});

describe('espace client : préalertes et colis', () => {
  const customer = {
    id: 'u1', companyId: 'c1', kind: 'CUSTOMER', email: 'marie@example.test', firstName: 'Marie', lastName: 'Jean',
    locale: 'fr', emailVerified: true, roles: [], permissions: [],
  };
  const signedIn = (extra: Record<string, Handler>) => {
    document.cookie = 'b2c_session=1';
    mockApi({
      'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
      'GET /v1/auth/me': customer,
      'GET /v1/me/receiving-addresses': { customerCode: 'EE-000001', warehouses: [{ id: '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11', reference: 'MIA1', name: 'Entrepôt de Miami', country: 'US', city: 'Miami', addresses: [] }] },
      ...extra,
    });
  };
  const prealert = {
    id: 'p1', status: 'OPEN', storeName: 'Boutique Test', orderNumber: null, supplierTracking: '1ZABC123456', transportMode: 'AIR',
    purchaseAmount: '59.9', purchaseCurrency: 'USD', description: 'Chaussures', warehouse: { id: '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11', name: 'Entrepôt de Miami', city: 'Miami', country: 'US' },
    package: { id: 'k1', trackingNumber: 'EEABCDE12345X', status: 'AWAITING_RECEIPT' }, createdAt: '2026-03-01T09:00:00.000Z',
  };

  it('déclare un achat : valide en français, envoie un nombre et affiche le numéro de suivi', async () => {
    let list = { items: [] as unknown[] };
    signedIn({
      'GET /v1/me/prealerts': () => json(200, list),
      'POST /v1/me/prealerts': () => {
        list = { items: [prealert] };
        return json(201, prealert);
      },
      'GET /v1/files': { items: [] },
    });
    const user = userEvent.setup();
    renderAt('/fr/account/prealerts');
    await user.click(await screen.findByRole('button', { name: fr.account.prealerts.add }));

    // champs obligatoires et montant illisible
    await user.type(await screen.findByLabelText(fr.account.prealerts.fields.amount), '59,999');
    await user.click(screen.getByRole('button', { name: fr.common.save }));
    expect(await screen.findByText(fr.validation.moneyDecimals)).toBeInTheDocument();
    expect(screen.getAllByText(fr.validation.required).length).toBeGreaterThanOrEqual(2);
    expect(calls('POST /v1/me/prealerts')).toHaveLength(0);

    await user.type(screen.getByLabelText(new RegExp(`^${fr.account.prealerts.fields.storeName}`)), 'Boutique Test');
    await user.clear(screen.getByLabelText(fr.account.prealerts.fields.amount));
    await user.type(screen.getByLabelText(fr.account.prealerts.fields.amount), '59,90');
    await user.type(screen.getByLabelText(fr.account.prealerts.fields.description), 'Chaussures');
    await user.type(screen.getByLabelText(new RegExp(`^${fr.account.prealerts.fields.supplierTracking}`)), '1ZABC123456');
    await user.click(screen.getByRole('button', { name: fr.common.save }));

    expect(await screen.findByText('Préalerte enregistrée. Numéro de suivi du colis : EEABCDE12345X.')).toBeInTheDocument();
    expect(bodyOf(calls('POST /v1/me/prealerts')[0])).toEqual({
      storeName: 'Boutique Test',
      supplierTracking: '1ZABC123456',
      warehouseId: '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11',
      transportMode: 'AIR',
      purchaseAmount: 59.9,
      purchaseCurrency: 'USD',
      description: 'Chaussures',
    });
    expect(await screen.findByTestId('prealert-tracking')).toHaveTextContent('EEABCDE12345X');
  });

  it('un doublon refusé par le serveur est expliqué', async () => {
    signedIn({
      'GET /v1/me/prealerts': { items: [] },
      'POST /v1/me/prealerts': () => json(409, { error: { code: 'DUPLICATE_PREALERT', message: 'x' } }),
    });
    const user = userEvent.setup();
    renderAt('/fr/account/prealerts');
    await user.click(await screen.findByRole('button', { name: fr.account.prealerts.add }));
    await user.type(await screen.findByLabelText(new RegExp(`^${fr.account.prealerts.fields.storeName}`)), 'Boutique');
    await user.type(screen.getByLabelText(fr.account.prealerts.fields.amount), '10');
    await user.type(screen.getByLabelText(fr.account.prealerts.fields.description), 'Chaussures');
    await user.click(screen.getByRole('button', { name: fr.common.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.auth.errors.DUPLICATE_PREALERT);
  });

  it('annulation en deux temps, uniquement tant que le colis n’est pas arrivé', async () => {
    const received = { ...prealert, id: 'p2', status: 'MATCHED_AUTO', storeName: 'Déjà reçu' };
    signedIn({
      'GET /v1/me/prealerts': { items: [prealert, received] },
      'DELETE /v1/me/prealerts/p1': () => json(204),
      'GET /v1/files': { items: [] },
    });
    const user = userEvent.setup();
    renderAt('/fr/account/prealerts');
    expect(await screen.findByText('Déjà reçu')).toBeInTheDocument();
    // la préalerte reçue n'offre ni modification ni annulation
    expect(screen.getAllByRole('button', { name: new RegExp(`^${fr.account.prealerts.cancel}`) })).toHaveLength(1);
    expect(screen.getAllByText(fr.account.prealerts.lockedNote)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: `${fr.account.prealerts.cancel} : Boutique Test` }));
    expect(calls('DELETE /v1/me/prealerts/p1')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: fr.account.prealerts.confirmCancel }));
    await waitFor(() => expect(calls('DELETE /v1/me/prealerts/p1')).toHaveLength(1));
    expect(await screen.findByText(fr.account.prealerts.cancelled)).toBeInTheDocument();
  });

  it('refuse côté navigateur un fichier trop gros ou d’un type non pris en charge, sans l’envoyer', async () => {
    signedIn({ 'GET /v1/me/prealerts': { items: [prealert] }, 'GET /v1/files': { items: [] } });
    const user = userEvent.setup({ applyAccept: false });
    renderAt('/fr/account/prealerts');
    const input = (await screen.findByTestId('file-input-prealert')) as HTMLInputElement;

    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'gros.pdf', { type: 'application/pdf' });
    await user.upload(input, big);
    expect(await screen.findByText(fr.account.prealerts.invoice.tooBig)).toBeInTheDocument();

    await user.upload(input, new File(['MZ'], 'programme.exe', { type: 'application/x-msdownload' }));
    expect(await screen.findByText(fr.auth.errors.UNSUPPORTED_FILE)).toBeInTheDocument();
    expect(calls('POST /v1/files')).toHaveLength(0);
  });

  it('envoie une facture avec son type MIME et rafraîchit la liste', async () => {
    let files: unknown[] = [];
    signedIn({
      'GET /v1/me/prealerts': { items: [prealert] },
      'GET /v1/files': () => json(200, { items: files }),
      'POST /v1/files': (init, url) => {
        expect(url.searchParams.get('ownerType')).toBe('PREALERT');
        expect(url.searchParams.get('ownerId')).toBe('p1');
        expect(url.searchParams.get('kind')).toBe('INVOICE');
        expect(url.searchParams.get('filename')).toBe('facture.pdf');
        expect(new Headers(init?.headers).get('Content-Type')).toBe('application/pdf');
        files = [{ id: 'f1', kind: 'INVOICE', name: 'facture.pdf', mimeType: 'application/pdf', size: 2048, createdAt: '2026-03-01T09:00:00.000Z' }];
        return json(201, files[0]);
      },
    });
    const user = userEvent.setup();
    renderAt('/fr/account/prealerts');
    const input = await screen.findByTestId('file-input-prealert');
    await user.upload(input, new File(['%PDF-1.4 test'], 'facture.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(fr.account.prealerts.invoice.uploaded)).toBeInTheDocument();
    expect(await screen.findByText(/facture\.pdf/)).toBeInTheDocument();
    expect(calls('POST /v1/files')).toHaveLength(1);
  });

  const pkg = {
    id: 'k1', trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', status: 'REGISTERED_WEIGHED', transportMode: 'AIR',
    supplierTracking: '1ZABC123456', contentDescription: 'Chaussures', origin: { country: 'US', city: 'Miami', warehouse: 'Entrepôt de Miami' },
    destination: { country: 'HT', city: null }, measures: { actualWeightKg: '2', billableWeight: '5', weightUnit: 'KG' },
    fees: { freight: '17.5', extras: '1.5', currency: 'USD', provisional: true }, receivedAt: '2026-03-02T10:00:00.000Z', createdAt: '2026-03-01T09:00:00.000Z',
  };

  it('liste mes colis et filtre par statut', async () => {
    signedIn({
      'GET /v1/me/packages': (_init, url) => json(200, { items: url.searchParams.get('status') === 'DELIVERED' ? [] : [pkg], nextCursor: null }),
    });
    const user = userEvent.setup();
    renderAt('/fr/account/packages');
    const item = await screen.findByTestId('package-item');
    expect(within(item).getByText('EE-ABCDE-12345-X')).toBeInTheDocument();
    expect(within(item).getByText(fr.packageStatus.REGISTERED_WEIGHED)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(new RegExp(`^${fr.account.packages.filter}`)), 'DELIVERED');
    await user.click(screen.getByRole('button', { name: fr.account.packages.apply }));
    expect(await screen.findByText(fr.account.packages.empty)).toBeInTheDocument();
  });

  it('détail d’un colis : mesures, frais provisoires et historique', async () => {
    signedIn({
      'GET /v1/me/packages/k1': {
        ...pkg,
        events: [
          { type: 'STATUS_CHANGE', status: 'AWAITING_RECEIPT', occurredAt: '2026-03-01T09:00:01.000Z', location: 'Miami', reasonCode: null },
          { type: 'STATUS_CHANGE', status: 'REGISTERED_WEIGHED', occurredAt: '2026-03-02T11:00:00.000Z', location: 'Miami', reasonCode: null },
        ],
      },
      'GET /v1/files': { items: [] },
    });
    renderAt('/fr/account/packages/k1');
    expect(await screen.findByTestId('package-tracking')).toHaveTextContent('EE-ABCDE-12345-X');
    expect(screen.getByTestId('package-freight')).toHaveTextContent(/17,50/);
    expect(screen.getByText(fr.account.packages.detail.provisional)).toBeInTheDocument();
    expect(screen.getByText('5 kg')).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem').filter((li) => li.querySelector('strong'));
    expect(steps.map((s) => s.querySelector('strong')?.textContent)).toEqual([fr.packageStatus.REGISTERED_WEIGHED, fr.packageStatus.AWAITING_RECEIPT]);
  });

  it('un colis sans tarif applicable n’affiche aucun montant', async () => {
    signedIn({ 'GET /v1/me/packages/k1': { ...pkg, fees: null, events: [] }, 'GET /v1/files': { items: [] } });
    renderAt('/fr/account/packages/k1');
    expect(await screen.findByText(fr.account.packages.detail.noFees)).toBeInTheDocument();
    expect(screen.queryByTestId('package-freight')).not.toBeInTheDocument();
  });
});
