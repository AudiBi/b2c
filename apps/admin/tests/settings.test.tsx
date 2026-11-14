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

const ALL = ['settings:read', 'settings:update', 'warehouse:read', 'warehouse:manage', 'agency:read', 'agency:manage', 'rate:read', 'rate:manage', 'petty_cash:read', 'petty_cash:manage'];

describe('paramètres de l’entreprise (sans script)', () => {
  it('« Valeurs de départ » : crée entrepôts, agence, catégories, grilles, taux et table CONATEL depuis le panel', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({
      ...login(ALL),
      'GET /v1/admin/settings/public-contact': { phones: [] },
      'PUT /v1/admin/settings/public-contact': {},
      'GET /v1/admin/warehouses': { items: [] },
      'POST /v1/admin/warehouses': {},
      'GET /v1/admin/agencies': { items: [] },
      'POST /v1/admin/agencies': {},
      'GET /v1/admin/categories': { items: [] },
      'POST /v1/admin/categories': {},
      'GET /v1/admin/rate-cards': { items: [] },
      'POST /v1/admin/rate-cards': { id: 'g1' },
      'POST /v1/admin/rate-cards/g1/activate': {},
      'GET /v1/admin/settings/fx-rate': { current: null, history: [] },
      'PUT /v1/admin/settings/fx-rate': {},
      'POST /v1/admin/customs-items/defaults': { added: 21, total: 21 },
      'GET /v1/admin/petty-cash': { items: [], balances: [] },
    });
    const user = userEvent.setup();
    mount('/settings');
    const s = fr.staff.settings;
    await user.click(await screen.findByRole('button', { name: s.start.button }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: s.start.confirm }));
    await waitFor(() => expect(calls('POST /v1/admin/customs-items/defaults')).toHaveLength(1), { timeout: 8000 });
    expect(calls('POST /v1/admin/warehouses')).toHaveLength(2);
    expect(calls('POST /v1/admin/agencies')).toHaveLength(1);
    expect(calls('POST /v1/admin/categories')).toHaveLength(2);
    expect(calls('POST /v1/admin/rate-cards')).toHaveLength(2);
    expect(calls('PUT /v1/admin/settings/fx-rate')).toHaveLength(1);
    expect(bodyOf(calls('PUT /v1/admin/settings/fx-rate')[0])).toMatchObject({ htgPerUsd: 135 });
    expect(await screen.findByText(/Terminé : 1\d élément\(s\) créé\(s\)/)).toBeInTheDocument();
  }, 30000);

  it('un entrepôt se crée depuis le panel ; le modèle d’adresse sans {customerCode} est refusé avant tout envoi', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({
      ...login(ALL),
      'GET /v1/admin/settings/public-contact': { phones: [] },
      'GET /v1/admin/warehouses': { items: [] },
      'POST /v1/admin/warehouses': {},
      'GET /v1/admin/agencies': { items: [] },
      'GET /v1/admin/categories': { items: [] },
      'GET /v1/admin/settings/fx-rate': { current: null, history: [] },
      'GET /v1/admin/petty-cash': { items: [], balances: [] },
    });
    const user = userEvent.setup();
    mount('/settings');
    const w = fr.staff.settings.warehouses;
    await user.type(await screen.findByLabelText(new RegExp(w.reference), undefined, { timeout: 5000 }), 'PHL');
    await user.type(screen.getAllByLabelText(fr.staff.settings.name)[0], 'Entrepôt de Philadelphie');
    await user.type(screen.getAllByLabelText(new RegExp(fr.staff.settings.city))[0], 'Philadelphie');
    await user.type(screen.getAllByLabelText(fr.staff.settings.addressLine)[0], '1245 Passmore St');
    const template = screen.getByLabelText(new RegExp(w.template.slice(0, 20)));
    // Sans {customerCode} les colis ne seraient pas identifiables : refusé avant tout envoi
    await user.clear(template);
    await user.type(template, '{{customerName}');
    await user.click(screen.getAllByRole('button', { name: fr.staff.settings.add })[0]);
    expect(calls('POST /v1/admin/warehouses')).toHaveLength(0);

    await user.clear(template);
    await user.type(template, '{{customerName}{Enter}{{customerCode} {{mode}');
    await user.click(screen.getAllByRole('button', { name: fr.staff.settings.add })[0]);
    await waitFor(() => expect(calls('POST /v1/admin/warehouses')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/warehouses')[0])).toMatchObject({ reference: 'PHL', country: 'US', addressTemplate: ['{customerName}', '{customerCode} {mode}'] });
  }, 30000);

  it('l’entrée « Paramètres » n’apparaît que pour qui a le droit de lire les réglages', async () => {
    document.cookie = 'b2c_admin_session=1';
    mockApi({ ...login(['invoice:read']) });
    mount('/');
    const nav = await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav }, { timeout: 5000 });
    expect(nav).not.toHaveTextContent(fr.staff.nav.settings);
  });
});
