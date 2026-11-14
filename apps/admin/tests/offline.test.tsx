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

import { clearFailed, enqueueScan, failedScans, queuedScans, syncQueue } from '../src/lib/offline-scans';

const W = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';

describe('réception hors ligne', () => {
  beforeEach(() => {
    // Seules les clés de la file : la langue choisie reste en place
    localStorage.removeItem('b2c_offline_scans_v1');
    localStorage.removeItem('b2c_offline_scans_failed_v1');
  });

  it('file locale : rejoue dans l’ordre, s’arrête sans connexion, classe un refus du serveur sans le rejouer', async () => {
    enqueueScan({ warehouseId: W, code: 'A' });
    enqueueScan({ warehouseId: W, code: 'B' });
    enqueueScan({ warehouseId: W, code: 'C' });
    const seen: string[] = [];
    const first = await syncQueue(
      async (q) => {
        seen.push(q.code);
        if (q.code === 'B') throw new Error('offline');
      },
      () => 'network',
    );
    expect(first).toEqual({ sent: 1, failed: 0, remaining: 2 });
    expect(queuedScans().map((q) => q.code)).toEqual(['B', 'C']);

    const second = await syncQueue(
      async (q) => {
        if (q.code === 'B') throw new Error('CODE_INCONNU');
      },
      () => 'refused',
    );
    expect(second).toEqual({ sent: 1, failed: 1, remaining: 0 });
    expect(failedScans().map((f) => [f.code, f.error])).toEqual([['B', 'CODE_INCONNU']]);
    clearFailed();
    expect(failedScans()).toEqual([]);
  });

  it('écran de réception : une lecture sans connexion est gardée puis envoyée au retour d’internet', async () => {
    document.cookie = 'b2c_admin_session=1';
    let online = false;
    let posts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const key = `${init?.method ?? 'GET'} ${url.pathname}`;
      if (key === 'POST /v1/admin/scan/receive') {
        if (!online) throw new TypeError('Failed to fetch');
        posts += 1;
        return json(200, { outcome: 'RECEIVED', match: null, package: null });
      }
      const handlers: Record<string, object> = {
        ...login(['package:receive']),
        'GET /v1/admin/warehouses': { items: [{ id: W, reference: 'MIA1', name: 'Entrepôt de Miami', city: 'Miami', country: 'US' }] },
      };
      return handlers[key] === undefined ? json(404, { error: { code: 'NOT_FOUND', message: 'x' } }) : json(200, handlers[key]);
    });
    const user = userEvent.setup();
    mount('/reception');
    const r = fr.staff.reception;
    const field = await screen.findByLabelText(r.code, undefined, { timeout: 5000 });
    await user.type(field, 'EE-ABCDE-12345-X{Enter}');
    expect(await screen.findByTestId('offline-pending')).toHaveTextContent('1 lecture');
    expect(queuedScans()).toHaveLength(1);
    expect(posts).toBe(0);

    online = true;
    await user.click(screen.getByRole('button', { name: r.sync }));
    await waitFor(() => expect(posts).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('offline-pending')).not.toBeInTheDocument());
    expect(queuedScans()).toHaveLength(0);
  }, 20000);
});
