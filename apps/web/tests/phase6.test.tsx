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

const W = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';
const A = '5a9d1c2e-7b3f-4c8a-9e1d-6f4b2a8c0d33';
const P = '7c1e9a4b-2d5f-4e8a-b3c6-1a9d7f5e2b44';
const S = '9e3b5d7a-1c4f-4a6e-8b2d-3f7a1c9e5d55';

const staffUser = (permissions: string[]) => ({
  id: 'u1', companyId: 'c1', kind: 'STAFF', email: 'agent@example.test', firstName: 'Agent', lastName: 'Test',
  locale: 'fr', emailVerified: true, roles: [], permissions,
});
function signedIn(permissions: string[], extra: Record<string, Handler>) {
  document.cookie = 'b2c_session=1';
  mockApi({
    'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
    'GET /v1/auth/me': staffUser(permissions),
    ...extra,
  });
}
const warehouse = { id: W, reference: 'MIA1', name: 'Entrepôt de Miami', city: 'Miami', country: 'US' };
const pkg = (overrides: Record<string, unknown> = {}) => ({
  id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', status: 'RECEIVED_AT_WAREHOUSE', previousStatus: null,
  customer: { id: 'c', customerCode: 'EE-000001', name: 'Marie Jean' }, warehouse, originCountry: 'US', originCity: 'Miami',
  destinationCountry: 'HT', destinationCity: null, transportMode: 'AIR', supplierTracking: '1ZABC', contentDescription: 'Chaussures',
  declaredValue: null, declaredCurrency: null, destinationAgencyId: null, locationId: null,
  measures: { actualWeightKg: null, billableWeight: null, weightUnit: null }, ...overrides,
});
const detail = (overrides: Record<string, unknown> = {}) => ({ ...pkg(overrides), events: [], holds: [], prealert: null });

describe('point de retrait et agences publiques', () => {
  const pickup = { name: 'Agence Delmas', kind: 'AGENCY', city: 'Delmas', country: 'HT', addressLine: '1 rue de Test', phone: '+50937000000', hours: 'Lun-Ven 8h-17h', ready: true };

  it('suivi public : montre le point de retrait seulement quand le colis y est', async () => {
    mockApi({
      'GET /v1/public/tracking/EE-ABCDE-12345-X': {
        trackingNumber: 'EE-ABCDE-12345-X', status: 'READY_FOR_PICKUP', lastUpdate: '2026-10-27T10:00:00.000Z', transportMode: 'AIR',
        origin: { country: 'US', city: 'Miami' }, destination: { country: 'HT', city: null }, estimatedDelivery: null, pickup, events: [],
      },
    });
    renderAt('/fr/tracking?n=EE-ABCDE-12345-X');
    const box = await screen.findByTestId('tracking-pickup');
    expect(box).toHaveTextContent(fr.tracking.result.pickupReady);
    expect(box).toHaveTextContent('Agence Delmas');
    expect(box).toHaveTextContent('Lun-Ven 8h-17h');
  });

  it('colis du client : carte du point de retrait', async () => {
    document.cookie = 'b2c_session=1';
    mockApi({
      'POST /v1/auth/refresh': { accessToken: 'jeton' },
      'GET /v1/auth/me': { ...staffUser([]), kind: 'CUSTOMER' },
      [`GET /v1/me/packages/${P}`]: {
        id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', status: 'READY_FOR_PICKUP', transportMode: 'AIR', supplierTracking: null,
        contentDescription: null, origin: { country: 'US', city: 'Miami', warehouse: 'Miami' }, destination: { country: 'HT', city: null },
        measures: { actualWeightKg: null, billableWeight: null, weightUnit: 'KG' }, fees: null, pickup, receivedAt: null, createdAt: '2026-10-27T10:00:00.000Z', events: [],
      },
      'GET /v1/files': { items: [] },
    });
    renderAt(`/fr/account/packages/${P}`);
    const card = await screen.findByTestId('pickup-card');
    expect(card).toHaveTextContent(fr.account.packages.detail.pickupReady);
    expect(card).toHaveTextContent('1 rue de Test, Delmas');
  });

  it('page Entrepôts et agences : liste les agences publiées, ou dit honnêtement qu’il n’y en a pas', async () => {
    mockApi({
      'GET /v1/public/companies/demo/warehouses': { items: [] },
      'GET /v1/public/companies/demo/agencies': { items: [{ name: 'Agence Delmas', kind: 'AGENCY', country: 'HT', city: 'Delmas', addressLine: '1 rue de Test', phone: '+50937000000', hours: 'Lun-Ven 8h-17h' }] },
    });
    const first = renderAt('/fr/locations');
    expect(await screen.findByRole('heading', { name: 'Agence Delmas' })).toBeInTheDocument();
    expect(screen.getByText('Lun-Ven 8h-17h')).toBeInTheDocument();
    expect(screen.queryByText(fr.locations.agenciesEmpty)).not.toBeInTheDocument();
    first.unmount();

    mockApi({ 'GET /v1/public/companies/demo/warehouses': { items: [] }, 'GET /v1/public/companies/demo/agencies': { items: [] } });
    renderAt('/fr/locations');
    expect(await screen.findByText(fr.locations.agenciesEmpty)).toBeInTheDocument();
  });
});
