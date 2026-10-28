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

const R = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';
const S = '5a9d1c2e-7b3f-4c8a-9e1d-6f4b2a8c0d33';
const P = '7c1e9a4b-2d5f-4e8a-b3c6-1a9d7f5e2b44';
const A = '9e3b5d7a-1c4f-4a6e-8b2d-3f7a1c9e5d55';
const D = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const C = '2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e';
const B = '4e5f6071-8293-4aa5-b6c7-d8e9f0a1b2c3';

const user = (kind: 'CUSTOMER' | 'STAFF', permissions: string[]) => ({
  id: 'u1', companyId: 'c1', kind, email: 'test@example.test', firstName: 'Test', lastName: 'User', locale: 'fr', emailVerified: true, roles: [], permissions,
});
function signedIn(kind: 'CUSTOMER' | 'STAFF', permissions: string[], extra: Record<string, Handler>) {
  document.cookie = 'b2c_session=1';
  mockApi({
    'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
    'GET /v1/auth/me': user(kind, permissions),
    'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null },
    ...extra,
  });
}
const settings = { requireOtp: true, requireIdDocument: true, requirePhoto: false };
const stop = (overrides: Record<string, unknown> = {}) => ({
  id: S, routeId: R, sequence: 1, status: 'PENDING', address: { recipientName: 'Marie Jean', line1: '12 rue des Palmistes', city: 'Pétion-Ville', phone: '+50937000000' },
  instructions: 'Portail bleu', package: { id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', description: 'Chaussures', status: 'OUT_FOR_DELIVERY' },
  customer: { id: C, customerCode: 'EE-000001', name: 'Marie Jean', phone: '+50937000000' }, balanceDue: null, balanceCurrency: null, unbilled: false, beneficiaries: [], ...overrides,
});
const route = (overrides: Record<string, unknown> = {}) => ({
  id: R, reference: 'TOU-2026-000001', status: 'IN_PROGRESS', plannedDate: '2026-11-02', agency: { id: A, name: 'Agence Delmas', city: 'Delmas' }, driver: { id: D, name: 'Jean Livreur' },
  notes: null, startedAt: '2026-11-02T08:00:00Z', completedAt: null, stopCount: 1, ...overrides,
});
const routeDetail = (overrides: Record<string, unknown> = {}, stops = [stop()]) => ({ ...route(overrides), stops, settings });

describe('navigation', () => {
  it('client : « Mes réclamations » ; personnel : chaque entrée selon un droit précis', async () => {
    signedIn('CUSTOMER', ['claim:read_own', 'claim:create_own', 'notification:read_own'], {});
    const first = renderAt('/fr/account');
    const nav = await screen.findByRole('navigation', { name: fr.a11y.accountNav }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: fr.account.nav.claims })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.staff.nav.claims })).not.toBeInTheDocument();
    first.unmount();

    signedIn('STAFF', ['delivery:read', 'claim:read', 'audit:read'], {});
    renderAt('/fr/account');
    const staffNav = await screen.findByRole('navigation', { name: fr.a11y.accountNav }, { timeout: 5000 });
    for (const name of [fr.staff.nav.routes, fr.staff.nav.claims, fr.staff.nav.audit]) expect(within(staffNav).getByRole('link', { name })).toBeInTheDocument();
    for (const name of [fr.staff.nav.myRoutes, fr.account.nav.claims]) expect(within(staffNav).queryByRole('link', { name })).not.toBeInTheDocument();
    // « Tableau de bord » existe aussi côté client : on distingue par l’adresse
    expect(staffNav.querySelector('a[href="/fr/account/staff/dashboard"]')).toBeNull();
  });

  it('le livreur n’a que « Mes tournées »', async () => {
    signedIn('STAFF', ['delivery:read_assigned', 'delivery:confirm'], {});
    renderAt('/fr/account');
    const nav = await screen.findByRole('navigation', { name: fr.a11y.accountNav }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: fr.staff.nav.myRoutes })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.staff.nav.routes })).not.toBeInTheDocument();
  });
});

describe('code de remise du client', () => {
  const pkg = (status: string) => ({
    id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', status, transportMode: 'AIR', supplierTracking: null, contentDescription: null,
    origin: { country: 'US', city: 'Miami', warehouse: 'MIA1' }, destination: { country: 'HT', city: 'Delmas' }, measures: { actualWeightKg: null, billableWeight: null, weightUnit: 'KG' },
    fees: null, pickup: null, receivedAt: null, createdAt: '2026-03-01T10:00:00Z', events: [],
  });

  it('proposé quand le colis est prêt pour retrait : le code s’affiche une fois', async () => {
    signedIn('CUSTOMER', ['package:read_own'], {
      [`GET /v1/me/packages/${P}`]: pkg('READY_FOR_PICKUP'),
      [`POST /v1/me/packages/${P}/handover-code`]: () => json(200, { code: '482913', expiresAt: '2026-11-05T10:00:00Z' }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/packages/${P}`);
    await u.click(await screen.findByRole('button', { name: fr.delivery.customer.code.generate }));
    expect(await screen.findByTestId('handover-code')).toHaveTextContent('482913');
    expect(screen.getByRole('button', { name: fr.delivery.customer.code.regenerate })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: fr.delivery.claims.report })).toHaveAttribute('href', `/fr/account/claims?package=${P}`);
  });

  it('absent quand le colis n’est pas encore en agence', async () => {
    signedIn('CUSTOMER', ['package:read_own'], { [`GET /v1/me/packages/${P}`]: pkg('IN_TRANSIT') });
    renderAt(`/fr/account/packages/${P}`);
    await screen.findByTestId('package-tracking');
    expect(screen.queryByTestId('handover-card')).not.toBeInTheDocument();
  });

  it('un refus du serveur est expliqué', async () => {
    signedIn('CUSTOMER', ['package:read_own'], {
      [`GET /v1/me/packages/${P}`]: pkg('READY_FOR_PICKUP'),
      [`POST /v1/me/packages/${P}/handover-code`]: () => json(429, { error: { code: 'TOO_MANY_CODES', message: 'x' } }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/packages/${P}`);
    await u.click(await screen.findByRole('button', { name: fr.delivery.customer.code.generate }));
    expect(await screen.findByText(fr.auth.errors.TOO_MANY_CODES)).toBeInTheDocument();
  });
});

describe('mes réclamations', () => {
  const claim = (overrides: Record<string, unknown> = {}) => ({
    id: C, number: 'CLM-2026-000001', category: 'DAMAGED', subject: 'Colis abîmé', status: 'OPEN', resolution: null, package: null, openedAt: '2026-03-01T10:00:00Z', resolvedAt: null, updatedAt: '2026-03-01T10:00:00Z', ...overrides,
  });

  it('liste ; ouverture : champs contrôlés avant tout envoi, puis envoi avec le colis choisi', async () => {
    signedIn('CUSTOMER', ['claim:read_own', 'claim:create_own', 'package:read_own'], {
      'GET /v1/me/claims': { items: [claim()], nextCursor: null },
      'GET /v1/me/packages': { items: [{ id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X' }], nextCursor: null },
      'POST /v1/me/claims': () => json(201, claim({ id: B })),
      [`GET /v1/me/claims/${B}`]: { ...claim({ id: B }), messages: [] },
    });
    const u = userEvent.setup();
    renderAt('/fr/account/claims');
    expect(await screen.findByTestId('claim-item')).toHaveTextContent('CLM-2026-000001');
    await u.click(screen.getByRole('button', { name: fr.delivery.claims.new }));
    await u.click(screen.getByRole('button', { name: fr.delivery.claims.submit }));
    expect(await screen.findByText(fr.common.fixErrors)).toBeInTheDocument();
    expect(calls('POST /v1/me/claims')).toHaveLength(0);

    await u.selectOptions(await screen.findByLabelText(/Colis concerné/), P);
    await u.type(screen.getByLabelText(fr.delivery.claims.fields.subject), 'Boîte écrasée');
    await u.type(screen.getByLabelText(fr.delivery.claims.fields.message), 'Le contenu est cassé.');
    await u.click(screen.getByRole('button', { name: fr.delivery.claims.submit }));
    await waitFor(() => expect(calls('POST /v1/me/claims')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/me/claims')[0])).toEqual({ category: 'DAMAGED', subject: 'Boîte écrasée', message: 'Le contenu est cassé.', packageId: P });
  });

  it('détail : réponse envoyée ; une réclamation clôturée n’a plus de formulaire', async () => {
    signedIn('CUSTOMER', ['claim:read_own', 'claim:create_own'], {
      [`GET /v1/me/claims/${C}`]: { ...claim(), messages: [{ id: 'm1', author: 'CUSTOMER', body: 'Mon colis est abîmé.', createdAt: '2026-03-01T10:00:00Z' }, { id: 'm2', author: 'STAFF', body: 'Nous regardons.', createdAt: '2026-03-01T11:00:00Z' }] },
      [`POST /v1/me/claims/${C}/messages`]: () => json(201, {}),
    });
    const u = userEvent.setup();
    const view = renderAt(`/fr/account/claims/${C}`);
    const thread = await screen.findByTestId('claim-messages');
    expect(thread).toHaveTextContent('Nous regardons.');
    expect(thread).toHaveTextContent(fr.delivery.claims.fromStaff);
    await u.click(screen.getByRole('button', { name: fr.delivery.claims.send }));
    expect(calls(`POST /v1/me/claims/${C}/messages`)).toHaveLength(0); // message vide
    await u.type(screen.getByRole('textbox', { name: fr.delivery.claims.reply }), 'Voici une photo.');
    await u.click(screen.getByRole('button', { name: fr.delivery.claims.send }));
    await waitFor(() => expect(calls(`POST /v1/me/claims/${C}/messages`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/me/claims/${C}/messages`)[0])).toEqual({ body: 'Voici une photo.' });
    view.unmount();

    signedIn('CUSTOMER', ['claim:read_own'], { [`GET /v1/me/claims/${C}`]: { ...claim({ status: 'RESOLVED', resolution: 'Remboursé.' }), messages: [] } });
    renderAt(`/fr/account/claims/${C}`);
    expect(await screen.findByText('Remboursé.')).toBeInTheDocument();
    expect(screen.getByText(fr.delivery.claims.closed)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.delivery.claims.send })).not.toBeInTheDocument();
  });
});

describe('tournées (personnel)', () => {
  const perms = ['delivery:read', 'delivery:assign', 'delivery:confirm', 'delivery:override_balance', 'agency:read', 'settings:read', 'settings:update'];

  it('liste et création : livreur et agence choisis, données validées', async () => {
    signedIn('STAFF', perms, {
      'GET /v1/admin/routes': { items: [route({ status: 'PLANNED' })], nextCursor: null },
      'GET /v1/admin/agencies': { items: [{ id: A, code: 'AGE1', name: 'Agence Delmas', city: 'Delmas', country: 'HT' }] },
      'GET /v1/admin/drivers': { items: [{ id: D, name: 'Jean Livreur' }] },
      'GET /v1/admin/settings/delivery': settings,
      'POST /v1/admin/routes': () => json(201, route()),
      [`GET /v1/admin/routes/${R}`]: routeDetail({ status: 'PLANNED' }, []),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/routes');
    expect(await screen.findByTestId('route-item')).toHaveTextContent('TOU-2026-000001');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.routes.new }));
    const date = await screen.findByLabelText(fr.delivery.staff.routes.date);
    await u.clear(date);
    await u.type(date, 'demain');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.routes.create }));
    expect(calls('POST /v1/admin/routes')).toHaveLength(0);
    await u.clear(date);
    await u.type(date, '2026-11-02');
    await waitFor(() => expect(screen.getByLabelText(fr.delivery.staff.routes.driver)).toHaveValue(D));
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.routes.create }));
    await waitFor(() => expect(calls('POST /v1/admin/routes')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/routes')[0])).toEqual({ agencyId: A, driverUserId: D, plannedDate: '2026-11-02' });
  });

  it('règle des preuves : les trois cases sont enregistrées une à une', async () => {
    signedIn('STAFF', perms, {
      'GET /v1/admin/routes': { items: [], nextCursor: null },
      'GET /v1/admin/settings/delivery': settings,
      'PUT /v1/admin/settings/delivery': () => json(200, {}),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/routes');
    await u.click(await screen.findByLabelText(fr.delivery.staff.settings.requirePhoto));
    await waitFor(() => expect(calls('PUT /v1/admin/settings/delivery')).toHaveLength(1));
    expect(bodyOf(calls('PUT /v1/admin/settings/delivery')[0])).toEqual({ requirePhoto: true });
  });

  it('tournée planifiée : départ en une action, retrait d’un arrêt', async () => {
    signedIn('STAFF', perms, {
      [`GET /v1/admin/routes/${R}`]: routeDetail({ status: 'PLANNED' }, [stop({ package: { id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', description: null, status: 'READY_FOR_PICKUP' } })]),
      [`POST /v1/admin/routes/${R}/start`]: () => json(200, route()),
      [`DELETE /v1/admin/routes/${R}/stops/${S}`]: () => json(204),
      [`GET /v1/admin/agencies/${A}/packages`]: { agency: { id: A }, expected: 0, items: [] },
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/routes/${R}`);
    expect(await screen.findByTestId('route-stop')).toHaveTextContent('Portail bleu');
    await u.click(screen.getByRole('button', { name: new RegExp(`^${fr.delivery.staff.routes.removeStop}`) }));
    await waitFor(() => expect(calls(`DELETE /v1/admin/routes/${R}/stops/${S}`)).toHaveLength(1));
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.routes.start }));
    await waitFor(() => expect(calls(`POST /v1/admin/routes/${R}/start`)).toHaveLength(1));
    expect(await screen.findByText(fr.delivery.staff.routes.started)).toBeInTheDocument();
  });

  it('remise sur un arrêt : le code et la pièce sont exigés avant tout envoi, puis envoyés tels quels', async () => {
    signedIn('STAFF', perms, {
      [`GET /v1/admin/routes/${R}`]: routeDetail(),
      [`POST /v1/admin/route-stops/${S}/deliver`]: () => json(200, { delivered: true }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/routes/${R}`);
    const card = await screen.findByTestId('route-stop');
    await u.click(within(card).getByRole('button', { name: new RegExp(`^${fr.delivery.staff.routes.deliver}`) }));
    await u.click(await within(card).findByRole('button', { name: fr.delivery.staff.routes.confirmHandover }));
    expect(await within(card).findByText(fr.common.fixErrors)).toBeInTheDocument();
    expect(calls(`POST /v1/admin/route-stops/${S}/deliver`)).toHaveLength(0);

    await u.type(within(card).getByLabelText(/Quatre derniers caractères/), '4821');
    await u.type(within(card).getByLabelText(/Code de remise du client/), '482913');
    await u.click(within(card).getByRole('button', { name: fr.delivery.staff.routes.confirmHandover }));
    await waitFor(() => expect(calls(`POST /v1/admin/route-stops/${S}/deliver`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/route-stops/${S}/deliver`)[0])).toEqual({ recipientKind: 'CUSTOMER', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', otp: '482913' });
    expect(await screen.findByText(fr.delivery.staff.routes.delivered)).toBeInTheDocument();
  });

  it('un code faux est expliqué ; l’échec de livraison exige un motif de la liste', async () => {
    signedIn('STAFF', perms, {
      [`GET /v1/admin/routes/${R}`]: routeDetail(),
      [`POST /v1/admin/route-stops/${S}/deliver`]: () => json(422, { error: { code: 'OTP_INVALID', message: 'x', details: { remaining: 3 } } }),
      [`POST /v1/admin/route-stops/${S}/fail`]: () => json(200, { failed: true, failedAttempts: 3, returnSuggested: true }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/routes/${R}`);
    const card = await screen.findByTestId('route-stop');
    await u.click(within(card).getByRole('button', { name: new RegExp(`^${fr.delivery.staff.routes.deliver}`) }));
    await u.type(within(card).getByLabelText(/Quatre derniers caractères/), '4821');
    await u.type(within(card).getByLabelText(/Code de remise du client/), '000000');
    await u.click(within(card).getByRole('button', { name: fr.delivery.staff.routes.confirmHandover }));
    expect(await within(card).findByText(fr.auth.errors.OTP_INVALID)).toBeInTheDocument();

    await u.click(within(card).getByRole('button', { name: new RegExp(`^${fr.delivery.staff.routes.failAction}`) }));
    await u.selectOptions(await within(card).findByLabelText(fr.delivery.staff.routes.fail.reason), 'WRONG_ADDRESS');
    await u.click(within(card).getByRole('button', { name: fr.delivery.staff.routes.fail.submit }));
    await waitFor(() => expect(calls(`POST /v1/admin/route-stops/${S}/fail`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/route-stops/${S}/fail`)[0])).toEqual({ reason: 'WRONG_ADDRESS' });
    expect(await screen.findByText(/Échec enregistré \(3 sur 3\)/)).toBeInTheDocument();
  });

  it('solde dû : la remise reste bloquée tant que la dérogation n’est pas cochée et motivée', async () => {
    signedIn('STAFF', perms, {
      [`GET /v1/admin/routes/${R}`]: routeDetail({}, [stop({ balanceDue: '9.50', balanceCurrency: 'USD' })]),
      [`POST /v1/admin/route-stops/${S}/deliver`]: () => json(200, { delivered: true }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/routes/${R}`);
    const card = await screen.findByTestId('route-stop');
    expect(card).toHaveTextContent(/Solde dû : 9,50/);
    await u.click(within(card).getByRole('button', { name: new RegExp(`^${fr.delivery.staff.routes.deliver}`) }));
    const submit = within(card).getByRole('button', { name: fr.delivery.staff.routes.confirmHandover });
    expect(submit).toBeDisabled();
    await u.type(within(card).getByLabelText(/Quatre derniers caractères/), '4821');
    await u.type(within(card).getByLabelText(/Code de remise du client/), '482913');
    await u.click(within(card).getByLabelText(fr.delivery.handover.override));
    expect(submit).toBeEnabled();
    await u.click(submit);
    expect(await within(card).findByText(fr.common.fixErrors)).toBeInTheDocument(); // motif manquant
    await u.type(within(card).getByLabelText(fr.delivery.handover.overrideReason), 'Paiement promis demain');
    await u.click(submit);
    await waitFor(() => expect(calls(`POST /v1/admin/route-stops/${S}/deliver`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/route-stops/${S}/deliver`)[0])).toMatchObject({ overrideBalance: { reason: 'Paiement promis demain' } });
  });

  it('livreur : « mes tournées », sans action de gestion', async () => {
    signedIn('STAFF', ['delivery:read_assigned', 'delivery:confirm'], {
      'GET /v1/admin/my-routes': { items: [route()], nextCursor: null },
      [`GET /v1/admin/my-routes/${R}`]: routeDetail(),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/my-routes');
    expect(await screen.findByRole('heading', { level: 1, name: fr.delivery.staff.routes.mineTitle })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.delivery.staff.routes.new })).not.toBeInTheDocument();
    await u.click(await screen.findByRole('link', { name: new RegExp(`${fr.finance.common.open} : TOU-2026-000001`) }));
    expect(await screen.findByTestId('route-stop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.delivery.staff.routes.start })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.delivery.staff.routes.complete })).not.toBeInTheDocument();
  });
});

describe('remise au comptoir (fiche colis)', () => {
  const perms = ['package:read', 'delivery:read', 'delivery:confirm', 'delivery:override_balance'];
  const detail = (status: string) => ({
    id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', status, previousStatus: null,
    customer: { id: C, customerCode: 'EE-000001', name: 'Marie Jean' }, warehouse: { id: 'w', reference: 'MIA1', name: 'Entrepôt', city: 'Miami' }, originCountry: 'US', originCity: 'Miami',
    destinationCountry: 'HT', destinationCity: null, transportMode: 'AIR', supplierTracking: null, contentDescription: null, declaredValue: null, declaredCurrency: null,
    destinationAgencyId: A, locationId: null, measures: { actualWeightKg: null, billableWeight: null, weightUnit: null }, events: [], holds: [], prealert: null,
  });
  const info = (blocked = false) => ({
    package: { id: P, trackingNumberDisplay: 'EE-ABCDE-12345-X', status: 'READY_FOR_PICKUP' }, customer: { id: C, customerCode: 'EE-000001', name: 'Marie Jean' }, settings,
    beneficiaries: [{ id: B, fullName: 'Jean Baptiste', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821' }],
    balance: { due: blocked ? '9.50' : '0.00', currency: 'USD', unbilled: false, blocked }, failedAttempts: 0,
  });

  it('bénéficiaire autorisé : choisi dans la liste du client, envoyé avec ses preuves', async () => {
    signedIn('STAFF', perms, {
      [`GET /v1/admin/packages/${P}`]: detail('READY_FOR_PICKUP'),
      [`GET /v1/admin/packages/${P}/handover-info`]: info(),
      [`GET /v1/admin/packages/${P}/delivery-attempts`]: { items: [] },
      [`POST /v1/admin/packages/${P}/handover`]: () => json(200, { delivered: true }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/packages/${P}`);
    const panel = await screen.findByRole('region', { name: fr.delivery.handover.title });
    await u.click(await within(panel).findByLabelText(fr.delivery.handover.recipientBeneficiary));
    await u.selectOptions(within(panel).getByLabelText(fr.delivery.handover.beneficiary), B);
    await u.type(within(panel).getByLabelText(/Quatre derniers caractères/), '4821');
    await u.type(within(panel).getByLabelText(/Code de remise du client/), '482913');
    await u.click(within(panel).getByRole('button', { name: fr.delivery.handover.confirm }));
    await waitFor(() => expect(calls(`POST /v1/admin/packages/${P}/handover`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/packages/${P}/handover`)[0])).toEqual({ recipientKind: 'BENEFICIARY', beneficiaryId: B, idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', otp: '482913' });
    expect(await within(panel).findByText(fr.delivery.handover.done)).toBeInTheDocument();
  });

  it('pas de formulaire pour un colis qui n’est pas « prêt pour retrait » ; l’historique des tentatives reste lisible', async () => {
    signedIn('STAFF', perms, {
      [`GET /v1/admin/packages/${P}`]: detail('DELIVERED'),
      [`GET /v1/admin/packages/${P}/delivery-attempts`]: {
        items: [{ id: 'a1', channel: 'AGENCY', outcome: 'SUCCEEDED', failureReason: null, note: null, rescheduleFor: null, recipientName: 'Marie Jean', recipientKind: 'CUSTOMER', idDocumentType: 'NATIONAL_ID', idDocumentLast4: '4821', otpVerified: true, balanceOverridden: true, overrideReason: 'Promis', attemptedAt: '2026-03-02T10:00:00Z' }],
      },
    });
    renderAt(`/fr/account/staff/packages/${P}`);
    const attempts = await screen.findByTestId('attempts');
    expect(attempts).toHaveTextContent('Marie Jean');
    expect(attempts).toHaveTextContent(/dérogation de solde : Promis/);
    expect(screen.queryByRole('button', { name: fr.delivery.handover.confirm })).not.toBeInTheDocument();
  });
});

describe('réclamations (personnel)', () => {
  const item = (overrides: Record<string, unknown> = {}) => ({
    id: C, number: 'CLM-2026-000001', category: 'LOST', subject: 'Colis perdu', status: 'OPEN', resolution: null, package: null, openedAt: '2026-03-01T10:00:00Z', resolvedAt: null, updatedAt: '2026-03-01T10:00:00Z',
    customer: { id: 'c1', customerCode: 'EE-000001', name: 'Marie Jean' }, assignedTo: null, ...overrides,
  });
  const perms = ['claim:read', 'claim:manage'];

  it('liste filtrée par état et recherche', async () => {
    signedIn('STAFF', perms, { 'GET /v1/admin/claims': { items: [item()], nextCursor: null } });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/claims');
    expect(await screen.findByTestId('staff-claim')).toHaveTextContent('EE-000001');
    await u.selectOptions(screen.getByLabelText(fr.delivery.staff.claims.status), 'IN_PROGRESS');
    await u.type(screen.getByLabelText(fr.delivery.staff.claims.search), 'perdu');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.claims.filter }));
    await waitFor(() => {
      const last = fetchMock.mock.calls.at(-1)![0] as string;
      expect(last).toContain('status=IN_PROGRESS');
      expect(last).toContain('q=perdu');
    });
  });

  it('détail : note interne signalée, réponse, résolution obligatoire pour clôturer, affectation', async () => {
    signedIn('STAFF', perms, {
      [`GET /v1/admin/claims/${C}`]: { ...item(), messages: [{ id: 'm1', author: 'CUSTOMER', body: 'Perdu.', createdAt: '2026-03-01T10:00:00Z', internal: false }, { id: 'm2', author: 'STAFF', body: 'Vérifier le lot.', createdAt: '2026-03-01T11:00:00Z', internal: true }] },
      'GET /v1/admin/claims/assignees': { items: [{ id: D, name: 'Agnès Service' }] },
      [`POST /v1/admin/claims/${C}/messages`]: () => json(201, {}),
      [`POST /v1/admin/claims/${C}/status`]: () => json(200, {}),
      [`POST /v1/admin/claims/${C}/assign`]: () => json(200, {}),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/claims/${C}`);
    const thread = await screen.findByTestId('claim-messages');
    expect(within(thread).getByText(fr.delivery.staff.claims.internal)).toBeInTheDocument();

    await u.type(screen.getByLabelText(fr.delivery.staff.claims.message), 'Nous retrouvons votre colis.');
    await u.click(screen.getByLabelText(fr.delivery.staff.claims.internalNote));
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.claims.addNote }));
    await waitFor(() => expect(calls(`POST /v1/admin/claims/${C}/messages`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/claims/${C}/messages`)[0])).toEqual({ body: 'Nous retrouvons votre colis.', internal: true });

    await u.selectOptions(screen.getByLabelText(fr.delivery.staff.claims.newStatus), 'RESOLVED');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.claims.apply }));
    expect(calls(`POST /v1/admin/claims/${C}/status`)).toHaveLength(0); // résolution manquante
    await u.type(screen.getByLabelText(fr.delivery.staff.claims.resolution), 'Colis retrouvé.');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.claims.apply }));
    await waitFor(() => expect(calls(`POST /v1/admin/claims/${C}/status`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/claims/${C}/status`)[0])).toEqual({ status: 'RESOLVED', resolution: 'Colis retrouvé.' });

    await u.selectOptions(await screen.findByLabelText(fr.delivery.staff.claims.assignedTo), D);
    await waitFor(() => expect(calls(`POST /v1/admin/claims/${C}/assign`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/claims/${C}/assign`)[0])).toEqual({ userId: D });
  });
});

describe('tableau de bord', () => {
  const dashboard = (overrides: Record<string, unknown> = {}) => ({
    range: { from: '2026-10-01', to: '2026-10-30' }, generatedAt: '2026-10-30T10:00:00Z',
    customers: { total: 12, newInRange: 3 },
    packages: { receivedInRange: 40, deliveredInRange: 25, inTransit: 7, awaitingPayment: 4, toDeliver: 6, onHold: 1, byStatus: {} },
    shipments: { byMode: [{ mode: 'AIR', count: 5 }] },
    warehouses: [{ id: 'w1', name: 'Entrepôt Miami', city: 'Miami', atWarehouse: 9, receivedInRange: 40 }],
    finance: { collected: [{ currency: 'USD', amount: '1500.00', count: 20 }], refunded: [], invoiced: [{ currency: 'USD', amount: '1800.00', count: 22 }], unpaid: [{ currency: 'USD', amount: '300.00', count: 4 }] },
    incidents: { openHolds: 2, holdsOpenedInRange: 3, claimsByStatus: { OPEN: 1, IN_PROGRESS: 2, RESOLVED: 5, REJECTED: 1 }, claimsOpenInProgress: 3, claimsOpenedInRange: 4 },
    delays: { warehouseReceiptToReady: { count: 30, avgHours: 26.5 }, transport: { count: 0, avgHours: null }, agencyReceiptToDelivered: { count: 25, avgHours: 48 } },
    agencies: [{ id: A, name: 'Agence Delmas', city: 'Delmas', inAgency: 6, deliveredInRange: 25, avgHoursToDeliver: 48 }],
    drivers: [{ id: D, name: 'Jean Livreur', succeeded: 18, failed: 2, successRate: 90 }],
    ...overrides,
  });

  it('affiche les chiffres réels ; une moyenne sans mesure est « Pas de mesure », jamais zéro', async () => {
    signedIn('STAFF', ['report:read'], { 'GET /v1/admin/dashboard': dashboard() });
    renderAt('/fr/account/staff/dashboard');
    expect(await screen.findByTestId('dash-customers')).toHaveTextContent('12');
    expect(screen.getByTestId('dash-received')).toHaveTextContent('40');
    expect(screen.getByTestId('dash-delivered')).toHaveTextContent('25');
    expect(screen.getByTestId('dash-claims-open')).toHaveTextContent('3');
    expect(screen.getByText(/1\s500,00/)).toBeInTheDocument();
    const delays = screen.getByRole('table', { name: fr.delivery.staff.dashboard.delays });
    const transport = within(delays).getByText(/Transport/).closest('tr')!;
    expect(transport).toHaveTextContent(fr.delivery.staff.dashboard.noMeasure);
    expect(within(delays).getByText(/Entrepôt/).closest('tr')).toHaveTextContent(/26,5 h/);
    expect(within(screen.getByRole('table', { name: fr.delivery.staff.dashboard.drivers })).getByText('Jean Livreur')).toBeInTheDocument();
  });

  it('état vide : des phrases honnêtes, pas de faux chiffres', async () => {
    signedIn('STAFF', ['report:read'], {
      'GET /v1/admin/dashboard': dashboard({
        customers: { total: 0, newInRange: 0 }, shipments: { byMode: [] }, warehouses: [], agencies: [], drivers: [],
        finance: { collected: [], refunded: [], invoiced: [], unpaid: [] },
        delays: { warehouseReceiptToReady: { count: 0, avgHours: null }, transport: { count: 0, avgHours: null }, agencyReceiptToDelivered: { count: 0, avgHours: null } },
      }),
    });
    renderAt('/fr/account/staff/dashboard');
    await screen.findByTestId('dashboard');
    expect(screen.getAllByText(fr.delivery.staff.dashboard.none).length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByText(fr.delivery.staff.dashboard.noMeasure).length).toBe(3);
  });

  it('période : contrôlée avant l’appel, transmise telle quelle ensuite', async () => {
    signedIn('STAFF', ['report:read'], { 'GET /v1/admin/dashboard': dashboard() });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/dashboard');
    await screen.findByTestId('dashboard');
    await u.type(screen.getByLabelText(new RegExp(fr.delivery.staff.dashboard.from.replace(/[()]/g, '\\$&'))), '2026-10-10');
    await u.type(screen.getByLabelText(fr.delivery.staff.dashboard.to.replace('Au', 'Au')), '2026-10-01');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.dashboard.apply }));
    expect(await screen.findByText(fr.common.fixErrors)).toBeInTheDocument();
    expect(calls('GET /v1/admin/dashboard')).toHaveLength(1);
    await u.clear(screen.getByLabelText(fr.delivery.staff.dashboard.to));
    await u.type(screen.getByLabelText(fr.delivery.staff.dashboard.to), '2026-10-20');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.dashboard.apply }));
    await waitFor(() => expect(calls('GET /v1/admin/dashboard')).toHaveLength(2));
    expect(String(calls('GET /v1/admin/dashboard')[1][0])).toContain('from=2026-10-10&to=2026-10-20');
  });

  it('droit limité à une agence : explication au lieu de chiffres', async () => {
    signedIn('STAFF', [], { 'GET /v1/admin/dashboard': () => json(403, { error: { code: 'REPORT_SCOPE', message: 'x' } }) });
    renderAt('/fr/account/staff/dashboard');
    expect(await screen.findByText(fr.delivery.staff.dashboard.forbidden)).toBeInTheDocument();
    expect(calls('GET /v1/admin/dashboard')).toHaveLength(0);
  });
});

describe('journal d’audit', () => {
  it('lecture seule : filtre transmis, détails dépliables', async () => {
    signedIn('STAFF', ['audit:read'], {
      'GET /v1/audit': {
        items: [{ id: 'e1', actorUserId: D, actorType: 'USER', action: 'delivery.completed', entityType: 'package', entityId: P, before: null, after: { channel: 'ROUTE' }, createdAt: '2026-03-02T10:00:00Z' }],
        nextCursor: null,
      },
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/audit');
    const item = await screen.findByTestId('audit-item');
    expect(item).toHaveTextContent('delivery.completed');
    await u.click(within(item).getByRole('button', { name: new RegExp(fr.delivery.staff.audit.details) }));
    expect(item).toHaveTextContent('"channel": "ROUTE"');
    await u.type(screen.getByLabelText(new RegExp(`^${fr.delivery.staff.audit.action}`)), 'delivery.');
    await u.click(screen.getByRole('button', { name: fr.delivery.staff.audit.filter }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('action=delivery.'));
  });
});

describe('textes', () => {
  it('chaque code d’erreur de la phase 8 a un message dans les trois langues', () => {
    const codes = [
      'ROUTE_NOT_FOUND', 'STOP_NOT_FOUND', 'ROUTE_NOT_PLANNED', 'ROUTE_HAS_PENDING_STOPS', 'STOP_ALREADY_HANDLED', 'DRIVER_INVALID', 'ALREADY_ON_ROUTE', 'NO_DELIVERY_ADDRESS',
      'BENEFICIARY_INVALID', 'ID_DOCUMENT_REQUIRED', 'ID_MISMATCH', 'OTP_REQUIRED', 'OTP_INVALID', 'OTP_NOT_AVAILABLE', 'OTP_LOCKED', 'PROOF_PHOTO_REQUIRED', 'PROOF_FILE_INVALID',
      'BALANCE_DUE', 'OVERRIDE_NOT_ALLOWED', 'TOO_MANY_CODES', 'CLAIM_NOT_FOUND', 'CLAIM_CLOSED', 'ASSIGNEE_INVALID', 'REPORT_SCOPE',
    ];
    for (const lang of ['fr', 'ht', 'en'] as const) for (const code of codes) expect(catalogs[lang].auth.errors[code], `${lang}:${code}`).toBeTruthy();
  });
});
