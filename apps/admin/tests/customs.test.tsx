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


describe('table CONATEL', () => {
  it("table vide : l'administrateur charge la table de départ, puis la liste s'affiche", async () => {
    document.cookie = 'b2c_admin_session=1';
    let loaded = false;
    mockApi({
      'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
      'GET /v1/auth/me': {
        id: 'u1', companyId: 'c1', kind: 'STAFF', email: 'a@example.test', firstName: 'A', lastName: 'B',
        locale: 'fr', emailVerified: true, roles: [], permissions: ['rate:read', 'rate:manage'],
      },
      'GET /v1/admin/customs-items': () => json(200, { items: loaded ? [{ id: 'i1', name: 'IPAD', size: '', kind: 'FIXED', normalPrice: '40.00', vipPrice: '40.00', rate: null, requiresAuthorization: false, active: true }] : [] }),
      'POST /v1/admin/customs-items/defaults': () => {
        loaded = true;
        return json(200, { added: 21, total: 21 });
      },
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/customs']}>
            <AppRoutes />
          </MemoryRouter>
        </AppProviders>
      </I18nProvider>,
    );
    const c = fr.staff.customs;
    await user.click(await screen.findByRole('button', { name: c.loadDefaults }, { timeout: 5000 }));
    expect(await screen.findByText('IPAD')).toBeInTheDocument();
    expect(screen.getByText(/40.00 \$ \/ VIP 40.00 \$/)).toBeInTheDocument();
    await waitFor(() => expect(calls('POST /v1/admin/customs-items/defaults')).toHaveLength(1));
  });
});
