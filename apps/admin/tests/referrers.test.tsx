import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

function mockApi(handlers: Record<string, object | (() => Response)>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const handler = handlers[`${init?.method ?? 'GET'} ${url.pathname}`];
    if (handler === undefined) return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    return typeof handler === 'function' ? handler() : json(200, handler);
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

const login = (permissions: string[]) => ({
  'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
  'GET /v1/auth/me': { id: 'u1', companyId: 'c1', kind: 'STAFF', email: 'a@example.test', firstName: 'A', lastName: 'B', locale: 'fr', emailVerified: true, roles: [], permissions },
});

function mount(path: string) {
  render(
    <I18nProvider>
      <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>
    </I18nProvider>,
  );
}

describe('référents', () => {
  it('relevé du mois puis paiement de la commission, une seule fois', async () => {
    document.cookie = 'b2c_admin_session=1';
    let paid = false;
    mockApi({
      ...login(['referrer:read', 'referrer:manage']),
      'GET /v1/admin/referrers': { items: [{ id: 'r1', name: 'Paul Henry', phone: null, email: null, rate: '10.00', active: true, customers: 3 }] },
      'GET /v1/admin/referrers/r1/statement': () =>
        json(200, { currency: 'USD', month: '2026-11', customers: 3, newCustomers: 1, packages: 1, revenue: '150.00', cost: '117.00', profit: '33.00', commission: '3.30', payout: paid ? { amount: '3.30', paidOn: '2026-11-13', note: null } : null }),
      'POST /v1/admin/referrers/r1/payouts': () => {
        paid = true;
        return json(201, { month: '2026-11', amount: '3.30', currency: 'USD', paidOn: '2026-11-13' });
      },
    });
    const user = userEvent.setup();
    mount('/referrers');
    const r = fr.staff.referrers;
    await user.click(await screen.findByRole('button', { name: r.statement }, { timeout: 5000 }));
    expect(await screen.findByTestId('commission')).toHaveTextContent('3,30');
    await user.click(screen.getByRole('button', { name: r.pay }));
    await waitFor(() => expect(calls('POST /v1/admin/referrers/r1/payouts')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/referrers/r1/payouts')[0])).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
    expect(await screen.findByText(/Commission payée/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: r.pay })).not.toBeInTheDocument();
  }, 20000);

  it('les référents n’apparaissent pas dans le menu de la facturation', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({ ...login(['invoice:read']) });
    mount('/');
    const nav = await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav }, { timeout: 5000 });
    expect(nav).not.toHaveTextContent(fr.staff.nav.referrers);
  });
});
