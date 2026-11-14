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

function mockApi(handlers: Record<string, object>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const handler = handlers[`${init?.method ?? 'GET'} ${url.pathname}`];
    return handler === undefined ? json(404, { error: { code: 'NOT_FOUND', message: 'x' } }) : json(200, handler);
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

const month = (m: string, over: Record<string, string> = {}) => ({
  month: m, revenue: '0.00', customsPassThrough: '0.00', cost: '0.00', margin: '0.00', expenses: '0.00', net: '0.00',
  byMode: { AIR: { revenue: '0.00', cost: '0.00', margin: '0.00' }, SEA: { revenue: '0.00', cost: '0.00', margin: '0.00' } }, ...over,
});

describe('petite caisse et dépôts', () => {
  it('petite caisse : solde et alerte de solde bas, saisie contrôlée puis envoyée', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({
      ...login(['petty_cash:read', 'petty_cash:manage']),
      'GET /v1/admin/petty-cash': { items: [], balances: [{ currency: 'USD', balance: '137.50', threshold: 200, low: true }] },
      'POST /v1/admin/petty-cash': { id: 'p1' },
    });
    const user = userEvent.setup();
    mount('/petty-cash');
    const c = fr.staff.pettyCash;
    expect(await screen.findByTestId('petty-balance-USD', undefined, { timeout: 5000 })).toHaveTextContent('137,50');
    expect(screen.getByText(new RegExp(c.low))).toBeInTheDocument();
    await user.type(screen.getByLabelText(c.description), 'Taxi livraison');
    await user.type(screen.getByLabelText(c.amount), '12.5');
    await user.click(screen.getByRole('button', { name: c.save }));
    await waitFor(() => expect(calls('POST /v1/admin/petty-cash')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/petty-cash')[0])).toMatchObject({ kind: 'EXPENSE', category: 'TRANSPORT', description: 'Taxi livraison', amount: 12.5, currency: 'USD' });
  });

  it('dépôts : reste à déposer, choix des caisses, envoi avec les quatre derniers caractères du compte', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({
      ...login(['deposit:read', 'deposit:manage']),
      'GET /v1/admin/deposits/to-deposit': { sessions: [{ id: 'cs1', agencyId: null, currency: 'USD', closedAt: '2026-11-12T20:00:00Z', depositable: '50.00' }], totals: [{ currency: 'USD', toDeposit: '50.00' }] },
      'GET /v1/admin/deposits': { items: [] },
      'POST /v1/admin/deposits': { id: 'd1' },
    });
    const user = userEvent.setup();
    mount('/deposits');
    const d = fr.staff.deposits;
    expect(await screen.findByTestId('to-deposit-USD', undefined, { timeout: 5000 })).toHaveTextContent('50,00');
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText(d.bank), 'Sogebank');
    await user.type(screen.getByLabelText(new RegExp(d.last4.replace(/[()]/g, '.'))), '0123');
    await user.type(screen.getByLabelText(d.slip), 'BRD-1001');
    await user.type(screen.getByLabelText(d.amount), '49');
    await user.click(screen.getByRole('button', { name: d.save }));
    await waitFor(() => expect(calls('POST /v1/admin/deposits')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/deposits')[0])).toMatchObject({ sessionIds: ['cs1'], bank: 'Sogebank', accountLast4: '0123', slipRef: 'BRD-1001', depositedAmount: 49 });
  });

  it('la facturation ne voit ni « Petite caisse » ni « Dépôts bancaires »', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({ ...login(['invoice:read', 'payment:read']) });
    mount('/');
    const nav = await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav }, { timeout: 5000 });
    expect(nav).not.toHaveTextContent(fr.staff.nav.pettyCash);
    expect(nav).not.toHaveTextContent(fr.staff.nav.deposits);
  });
});
