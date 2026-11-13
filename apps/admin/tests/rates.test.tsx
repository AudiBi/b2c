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

describe('grilles tarifaires', () => {
  it('liste les tranches avec leur base, puis crée un brouillon avec une tranche à l’unité', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({
      'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
      'GET /v1/auth/me': {
        id: 'u1', companyId: 'c1', kind: 'STAFF', email: 'a@example.test', firstName: 'A', lastName: 'B',
        locale: 'fr', emailVerified: true, roles: [], permissions: ['rate:read', 'rate:manage'],
      },
      'GET /v1/admin/categories': { items: [{ code: 'DRUM', name: { fr: 'Baril' } }] },
      'GET /v1/admin/rate-cards': {
        items: [
          {
            id: 'g1', name: 'Maritime', status: 'ACTIVE', version: 1, transportMode: 'SEA', originCountry: 'US', destinationCountry: 'HT', currency: 'USD',
            weightUnit: 'LB', dimensionUnit: 'IN', volumetricDivisor: '166',
            rules: [{ categoryCode: null, weightFrom: '0', weightTo: null, pricePerUnit: '18', flatFee: '0', minCharge: '0', basis: 'VOLUME', volumetricDivisor: null }],
          },
        ],
      },
      'POST /v1/admin/rate-cards': { id: 'g2' },
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/rates']}>
            <AppRoutes />
          </MemoryRouter>
        </AppProviders>
      </I18nProvider>,
    );
    const r = fr.staff.rates;
    expect(await screen.findByText(/Volume \(pi³\) · 18 USD \/ pi³/, undefined, { timeout: 5000 })).toBeInTheDocument();

    await user.type(screen.getByLabelText(r.name), 'Baril test');
    await user.selectOptions(screen.getByLabelText(r.category), 'DRUM');
    await user.selectOptions(screen.getByLabelText(r.basis), 'UNIT');
    await user.type(screen.getByLabelText(r.price), '220');
    await user.click(screen.getByRole('button', { name: r.create }));
    await waitFor(() => expect(calls('POST /v1/admin/rate-cards')).toHaveLength(1));
    const sent = bodyOf(calls('POST /v1/admin/rate-cards')[0]);
    expect(sent.name).toBe('Baril test');
    expect(sent.rules).toEqual([{ categoryCode: 'DRUM', basis: 'UNIT', weightFrom: 0, pricePerUnit: 220, flatFee: 0, minCharge: 0 }]);
  });
});
