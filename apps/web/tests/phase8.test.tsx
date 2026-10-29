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
