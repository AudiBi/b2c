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
  month: m, revenue: '0.00', customsPassThrough: '0.00', cost: '0.00', margin: '0.00', expenses: '0.00', commissions: '0.00', incidents: '0.00', net: '0.00',
  byMode: { AIR: { revenue: '0.00', cost: '0.00', margin: '0.00' }, SEA: { revenue: '0.00', cost: '0.00', margin: '0.00' } }, ...over,
});

describe('profit et dépenses', () => {
  it('affiche le profit du mois et le menu seulement avec les droits comptables', async () => {
    document.cookie = 'b2c_admin_session=1';
    const current = month('2026-11', { revenue: '222.00', cost: '173.00', margin: '49.00', expenses: '10.00', net: '39.00', customsPassThrough: '40.00' });
    mockApi({
      ...login(['report:profit', 'cost:read', 'expense:read']),
      'GET /v1/admin/reports/profit': { currency: 'USD', month: '2026-11', current, items: [month('2026-10'), current], notes: { expensesConvertedFromHtg: true, excludedExpenseCurrencies: [], method: 'Méthode' } },
    });
    mount('/profit');
    const net = await screen.findByTestId('profit-net', undefined, { timeout: 5000 });
    expect(net).toHaveTextContent('39,00');
    expect(screen.getByTestId('profit-current')).toHaveTextContent('222,00');
    expect(screen.getByText(fr.staff.profit.converted)).toBeInTheDocument();
    const nav = await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav });
    expect(nav).toHaveTextContent(fr.staff.nav.profit);
    expect(nav).toHaveTextContent(fr.staff.nav.expenses);
  });

  it('un agent de facturation ne voit ni « Profit » ni « Dépenses » dans le menu', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({ ...login(['invoice:read', 'rate:read']) });
    mount('/');
    const nav = await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav }, { timeout: 5000 });
    expect(nav).not.toHaveTextContent(fr.staff.nav.profit);
    expect(nav).not.toHaveTextContent(fr.staff.nav.expenses);
  });

  it('saisit une dépense : champs contrôlés, puis envoi', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({ ...login(['expense:read', 'expense:manage']), 'GET /v1/admin/expenses': { items: [] }, 'POST /v1/admin/expenses': { id: 'e1' } });
    const user = userEvent.setup();
    mount('/expenses');
    const e = fr.staff.expenses;
    await user.type(await screen.findByLabelText(e.description, undefined, { timeout: 5000 }), 'Loyer agence');
    await user.type(screen.getByLabelText(e.amount), '600');
    await user.click(screen.getByRole('button', { name: e.save }));
    await waitFor(() => expect(calls('POST /v1/admin/expenses')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/expenses')[0])).toMatchObject({ category: 'RENT', description: 'Loyer agence', amount: 600, currency: 'USD' });
  });
});
