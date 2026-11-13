import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../src/App';
import { I18nProvider, catalogs } from '../src/i18n';
import { AppProviders } from '../src/providers';

const fr = catalogs.fr;
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn();
type Handler = object | ((init: RequestInit | undefined, url: URL) => Response | Promise<Response>);

function mockApi(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const handler = handlers[`${init?.method ?? 'GET'} ${url.pathname}`];
    if (handler === undefined) return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    return typeof handler === 'function' ? handler(init, url) : json(200, handler);
  });
}
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([input, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}` === key);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'b2c_admin_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

const W = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';
const C = '5a9d1c2e-7b3f-4c8a-9e1d-6f4b2a8c0d33';
const P = '7c1e9a4b-2d5f-4e8a-b3c6-1a9d7f5e2b44';

describe('comptoir', () => {
  it('crée un client sans e-mail, puis enregistre un colis avec son destinataire', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({
      'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
      'GET /v1/auth/me': {
        id: 'u1', companyId: 'c1', kind: 'STAFF', email: 'agent@example.test', firstName: 'Agent', lastName: 'Test',
        locale: 'fr', emailVerified: true, roles: [], permissions: ['package:receive', 'customer:read', 'customer:create', 'customer:update'],
      },
      'GET /v1/admin/warehouses': { items: [{ id: W, reference: 'MIA1', name: 'Entrepôt de Miami', city: 'Miami', country: 'US' }] },
      'GET /v1/admin/agencies': { items: [] },
      'POST /v1/admin/customers': { id: C, customerCode: 'CL-000001', firstName: 'Marie', lastName: 'Dupont', businessName: null, email: null, phone: null, hasAccess: false },
      'POST /v1/admin/packages/counter': { id: P, trackingNumberDisplay: 'EE-ABCDE-12345-X' },
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/counter']}>
            <AppRoutes />
          </MemoryRouter>
        </AppProviders>
      </I18nProvider>,
    );
    const c = fr.staff.counter;
    await user.click(await screen.findByRole('button', { name: c.newCustomer }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(c.firstName), 'Marie');
    await user.type(screen.getByLabelText(c.lastName), 'Dupont');
    await user.click(screen.getByRole('button', { name: c.createCustomer }));
    await waitFor(() => expect(calls('POST /v1/admin/customers')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/customers')[0])).toEqual({ firstName: 'Marie', lastName: 'Dupont' });
    expect(await screen.findByText('CL-000001')).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(c.noAccess)).length).toBeGreaterThan(0);

    await user.type(await screen.findByLabelText(c.recipientName), 'Jean Pierre');
    await user.click(screen.getByRole('button', { name: c.createPackage }));
    await waitFor(() => expect(calls('POST /v1/admin/packages/counter')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/packages/counter')[0])).toEqual({ warehouseId: W, customerId: C, transportMode: 'AIR', recipientName: 'Jean Pierre' });
    const alert = await screen.findByText(/EE-ABCDE-12345-X/);
    expect(within(alert.parentElement as HTMLElement).getByRole('link')).toBeInTheDocument();
  });
});
