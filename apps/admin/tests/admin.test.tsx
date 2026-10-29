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
    <I18nProvider>
      <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[url]}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>
    </I18nProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'b2c_admin_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

const U1 = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';
const U2 = '5a9d1c2e-7b3f-4c8a-9e1d-6f4b2a8c0d33';
const W = '7c1e9a4b-2d5f-4e8a-b3c6-1a9d7f5e2b44';
const UR = '9e3b5d7a-1c4f-4a6e-8b2d-3f7a1c9e5d55';

const me = (kind: 'STAFF' | 'PLATFORM' | 'CUSTOMER', permissions: string[], id = U1) => ({
  id, companyId: 'c1', kind, email: 'moi@example.test', firstName: 'Aud', lastName: 'Bien', locale: 'fr', emailVerified: true, roles: [], permissions,
  mfa: { enabled: true, required: true, enrollmentRequired: false },
});
function signedIn(user: object, extra: Record<string, Handler> = {}) {
  document.cookie = 'b2c_admin_session=1';
  mockApi({ 'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' }, 'GET /v1/auth/me': user, ...extra });
}
const ADMIN = ['user:read', 'user:create', 'user:disable', 'role:read', 'role:assign', 'audit:read', 'report:read', 'package:read'];

const roleItems = [
  { code: 'COMPANY_ADMIN', name: 'Administrateur de l’entreprise', description: 'Tous les droits', isSystem: true, permissions: ['user:read', 'user:create', 'package:read'] },
  { code: 'RECEPTION_AGENT', name: 'Agent de réception', description: 'Réception', isSystem: true, permissions: ['package:receive', 'package:read'] },
  { code: 'WAREHOUSE_MANAGER', name: 'Responsable d’entrepôt', description: 'Entrepôt', isSystem: true, permissions: ['warehouse:read'] },
];
const user = (overrides: Record<string, unknown> = {}) => ({
  id: U2, kind: 'STAFF', email: 'agent@example.test', firstName: 'Marie', lastName: 'Jean', businessName: null, phone: null, locale: 'fr', status: 'ACTIVE', emailVerified: true,
  lastLoginAt: null, createdAt: '2026-10-01T10:00:00Z', roles: [{ userRoleId: UR, roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE', scopeId: W }], ...overrides,
});
const warehouses = { items: [{ id: W, reference: 'MIA1', name: 'Entrepôt de Miami', city: 'Miami', country: 'US' }] };

describe('accès au panel', () => {
  it('sans session : renvoi vers la connexion, qui garde l’écran demandé', async () => {
    mockApi({});
    renderAt('/users');
    expect(await screen.findByRole('heading', { name: fr.admin.login.title })).toBeInTheDocument();
  });

  it('un compte client est refusé : message, et aucun écran du panel', async () => {
    signedIn(me('CUSTOMER', ['package:read_own']));
    renderAt('/');
    expect(await screen.findByText(fr.admin.login.staffOnly)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: fr.admin.topbar.mainNav })).not.toBeInTheDocument();
  });

  it('personnel : l’accueil et le menu suivent les droits ; aucune entrée « Entreprises »', async () => {
    signedIn(me('STAFF', ADMIN));
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav });
    for (const name of [fr.admin.nav.users, fr.admin.nav.roles, fr.staff.nav.audit, fr.staff.nav.dashboard, fr.staff.nav.packages]) expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.admin.nav.companies })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.staff.nav.billing })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bonjour Aud' })).toBeInTheDocument();
  });

  it('plateforme : seulement « Entreprises » et la gestion des accès, aucun écran métier', async () => {
    signedIn(me('PLATFORM', ['company:manage']));
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav });
    expect(within(nav).getByRole('link', { name: fr.admin.nav.companies })).toBeInTheDocument();
    for (const name of [fr.staff.nav.packages, fr.staff.nav.reception, fr.admin.nav.users]) expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
  });

  it('double authentification exigée mais pas activée : tout renvoie vers l’écran Sécurité', async () => {
    signedIn({ ...me('STAFF', ADMIN), mfa: { enabled: false, required: true, enrollmentRequired: true } }, { 'GET /v1/me/2fa': { enabled: false, pending: false, required: true, recoveryCodesLeft: 0 } });
    renderAt('/users');
    expect(await screen.findByText(fr.account.security.twoFactor.enrollmentRequired)).toBeInTheDocument();
    expect(calls('GET /v1/admin/users')).toHaveLength(0);
  });

  it('le choix de langue change l’interface et se souvient', async () => {
    signedIn(me('STAFF', ADMIN));
    renderAt('/');
    await screen.findByRole('navigation', { name: fr.admin.topbar.mainNav });
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(await screen.findByRole('navigation', { name: catalogs.en.admin.topbar.mainNav })).toBeInTheDocument();
    expect(window.localStorage.getItem('b2c.admin.lang')).toBe('en');
  });
});

describe('connexion', () => {
  const fillAndSubmit = async () => {
    await userEvent.type(await screen.findByLabelText(fr.auth.fields.email), 'moi@example.test');
    await userEvent.type(screen.getByLabelText(fr.auth.fields.password, { selector: 'input' }), 'Un-mot-de-passe-solide');
    await userEvent.click(screen.getByRole('button', { name: fr.auth.login.submit }));
  };

  it('personnel : la connexion envoie l’identifiant de l’entreprise du panel', async () => {
    mockApi({ 'POST /v1/auth/login': { accessToken: 'jeton' }, 'GET /v1/auth/me': me('STAFF', ADMIN) });
    renderAt('/login');
    await fillAndSubmit();
    await waitFor(() => expect(calls('POST /v1/auth/login')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/auth/login')[0])).toMatchObject({ companySlug: 'demo', email: 'moi@example.test' });
    expect(await screen.findByRole('heading', { name: 'Bonjour Aud' })).toBeInTheDocument();
  });

  it('équipe plateforme : aucun identifiant d’entreprise n’est envoyé', async () => {
    mockApi({ 'POST /v1/auth/login': { accessToken: 'jeton' }, 'GET /v1/auth/me': me('PLATFORM', ['company:manage']) });
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.login.platformMode }));
    await fillAndSubmit();
    await waitFor(() => expect(calls('POST /v1/auth/login')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/auth/login')[0]).companySlug).toBeUndefined();
  });

  it('un client qui se connecte ici est refusé et sa session refermée', async () => {
    mockApi({
      'POST /v1/auth/login': { accessToken: 'jeton' },
      'GET /v1/auth/me': me('CUSTOMER', []),
      'POST /v1/auth/logout': () => json(204),
    });
    renderAt('/login');
    await fillAndSubmit();
    expect(await screen.findByText(fr.admin.login.staffOnly)).toBeInTheDocument();
    await waitFor(() => expect(calls('POST /v1/auth/logout')).toHaveLength(1));
  });

  it('identifiants refusés : message, pas de champ de code', async () => {
    mockApi({ 'POST /v1/auth/login': () => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }) });
    renderAt('/login');
    await fillAndSubmit();
    expect(await screen.findByText(fr.auth.errors.INVALID_CREDENTIALS)).toBeInTheDocument();
    expect(screen.queryByLabelText(fr.auth.login.totpCode)).not.toBeInTheDocument();
  });
});

describe('utilisateurs', () => {
  const listHandlers = (items = [user()]) => ({
    'GET /v1/admin/users': { items, nextCursor: null },
    'GET /v1/admin/roles': roleItems,
    'GET /v1/admin/warehouses': warehouses,
    'GET /v1/admin/agencies': { items: [] },
  });

  it('liste avec les rôles nommés et l’état ; les filtres partent dans la requête', async () => {
    signedIn(me('STAFF', ADMIN), listHandlers());
    renderAt('/users');
    const row = (await screen.findByText('agent@example.test')).closest('tr')!;
    expect(within(row).getByText('Agent de réception')).toBeInTheDocument();
    expect(within(row).getByText(fr.admin.users.statuses.ACTIVE)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(fr.admin.users.search), 'marie');
    await userEvent.selectOptions(screen.getByLabelText(fr.admin.users.filterStatus), 'DISABLED');
    await userEvent.click(screen.getByRole('button', { name: fr.admin.users.searchBtn }));
    await waitFor(() => expect(calls('GET /v1/admin/users').length).toBeGreaterThan(1));
    const last = new URL(String(fetchMock.mock.calls.filter(([i]) => String(i).includes('/v1/admin/users')).at(-1)![0]), 'http://localhost');
    expect(last.searchParams.get('q')).toBe('marie');
    expect(last.searchParams.get('status')).toBe('DISABLED');
  });

  it('état vide explicite', async () => {
    signedIn(me('STAFF', ADMIN), listHandlers([]));
    renderAt('/users');
    expect(await screen.findByText(fr.admin.users.empty)).toBeInTheDocument();
  });

  it('invitation : champs et rôle contrôlés avant tout envoi, puis envoi avec le rôle et sa portée', async () => {
    signedIn(me('STAFF', ADMIN), { ...listHandlers(), 'POST /v1/admin/users': () => json(201, user({ id: U1, status: 'PENDING' })) });
    renderAt('/users');
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(fr.admin.users.invite) }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.users.send }));
    expect(calls('POST /v1/admin/users')).toHaveLength(0);
    expect(within(dialog).getAllByText(fr.validation.required).length).toBeGreaterThan(0);

    await userEvent.type(within(dialog).getByLabelText(fr.admin.users.firstName), 'Paul');
    await userEvent.type(within(dialog).getByLabelText(fr.admin.users.lastName), 'Pierre');
    await userEvent.type(within(dialog).getByLabelText(fr.admin.users.email), 'paul@example.test');
    await userEvent.selectOptions(within(dialog).getByLabelText(fr.admin.users.role), 'WAREHOUSE_MANAGER');
    // un responsable d'entrepôt s'attribue à un entrepôt : la portée est demandée
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.users.send }));
    expect(calls('POST /v1/admin/users')).toHaveLength(0);
    await userEvent.selectOptions(await within(dialog).findByLabelText(fr.admin.users.scopeTarget), W);
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.users.send }));
    await waitFor(() => expect(calls('POST /v1/admin/users')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/users')[0])).toMatchObject({
      email: 'paul@example.test', firstName: 'Paul', lastName: 'Pierre', locale: 'fr',
      roles: [{ roleCode: 'WAREHOUSE_MANAGER', scopeType: 'WAREHOUSE', scopeId: W }],
    });
    expect(await within(dialog).findByText('Invitation envoyée à paul@example.test.')).toBeInTheDocument();
  });

  it('invitation : les rôles du personnel sont proposés même si le serveur n’en renvoie aucun (catalogue partagé)', async () => {
    signedIn(me('STAFF', ADMIN), { ...listHandlers(), 'GET /v1/admin/roles': [] });
    renderAt('/users');
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(fr.admin.users.invite) }));
    const dialog = await screen.findByRole('dialog');
    const options = within(within(dialog).getByLabelText(fr.admin.users.role)).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Administrateur de l'entreprise", 'Agent de réception', 'Livreur', "Responsable d'entrepôt"]));
    // jamais les rôles des clients ni de la plateforme
    expect(options.join('|')).not.toMatch(/Client|Super administrateur/);
  });

  it('rôles et droits : catalogue partagé affiché quand le serveur n’a aucune ligne de rôle', async () => {
    signedIn(me('STAFF', ADMIN), { 'GET /v1/admin/roles': [] });
    renderAt('/roles');
    expect(await screen.findByRole('heading', { name: 'Livreur' })).toBeInTheDocument();
  });

  it('invitation : une adresse déjà utilisée est expliquée', async () => {
    signedIn(me('STAFF', ADMIN), { ...listHandlers(), 'POST /v1/admin/users': () => json(409, { error: { code: 'EMAIL_ALREADY_USED', message: 'x' } }) });
    renderAt('/users');
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(fr.admin.users.invite) }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(fr.admin.users.firstName), 'Paul');
    await userEvent.type(within(dialog).getByLabelText(fr.admin.users.lastName), 'Pierre');
    await userEvent.type(within(dialog).getByLabelText(fr.admin.users.email), 'agent@example.test');
    await userEvent.selectOptions(within(dialog).getByLabelText(fr.admin.users.role), 'COMPANY_ADMIN');
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.users.send }));
    expect(await within(dialog).findByText(fr.auth.errors.EMAIL_ALREADY_USED)).toBeInTheDocument();
  });

  it('sans le droit « user:create », pas de bouton d’invitation', async () => {
    signedIn(me('STAFF', ['user:read', 'role:read']), listHandlers());
    renderAt('/users');
    await screen.findByText('agent@example.test');
    expect(screen.queryByRole('button', { name: new RegExp(fr.admin.users.invite) })).not.toBeInTheDocument();
  });
});

describe('fiche d’un utilisateur', () => {
  const handlers = (overrides: Record<string, unknown> = {}) => ({
    [`GET /v1/admin/users/${U2}`]: user(overrides),
    'GET /v1/admin/roles': roleItems,
    'GET /v1/admin/warehouses': warehouses,
    'GET /v1/admin/agencies': { items: [] },
  });

  it('affiche le rôle et sa portée nommée', async () => {
    signedIn(me('STAFF', ADMIN), handlers());
    renderAt(`/users/${U2}`);
    expect(await screen.findByText('Agent de réception')).toBeInTheDocument();
    expect(await screen.findByText('Entrepôt de Miami')).toBeInTheDocument();
  });

  it('retire un rôle en deux temps', async () => {
    signedIn(me('STAFF', ADMIN), { ...handlers(), [`DELETE /v1/admin/users/${U2}/roles/${UR}`]: () => json(204) });
    renderAt(`/users/${U2}`);
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.users.detail.remove }));
    expect(calls(`DELETE /v1/admin/users/${U2}/roles/${UR}`)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: fr.admin.users.detail.confirm }));
    await waitFor(() => expect(calls(`DELETE /v1/admin/users/${U2}/roles/${UR}`)).toHaveLength(1));
    expect(await screen.findByText(fr.admin.users.roleRemoved)).toBeInTheDocument();
  });

  it('ajoute un rôle avec sa portée', async () => {
    signedIn(me('STAFF', ADMIN), { ...handlers(), [`POST /v1/admin/users/${U2}/roles`]: () => json(201, user()) });
    renderAt(`/users/${U2}`);
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.users.detail.addRole }));
    const form = (await screen.findByRole('heading', { name: fr.admin.users.detail.addRole, level: 3 })).closest('form')!;
    await userEvent.selectOptions(within(form).getByLabelText(fr.admin.users.role), 'COMPANY_ADMIN');
    await userEvent.click(within(form).getByRole('button', { name: fr.admin.users.detail.add }));
    await waitFor(() => expect(calls(`POST /v1/admin/users/${U2}/roles`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/users/${U2}/roles`)[0])).toEqual({ roleCode: 'COMPANY_ADMIN', scopeType: 'COMPANY' });
  });

  it('un refus du serveur (dernier administrateur) est expliqué', async () => {
    signedIn(me('STAFF', ADMIN), { ...handlers(), [`DELETE /v1/admin/users/${U2}/roles/${UR}`]: () => json(409, { error: { code: 'LAST_ADMINISTRATOR', message: 'x' } }) });
    renderAt(`/users/${U2}`);
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.users.detail.remove }));
    await userEvent.click(screen.getByRole('button', { name: fr.admin.users.detail.confirm }));
    expect(await screen.findByText(fr.auth.errors.LAST_ADMINISTRATOR)).toBeInTheDocument();
  });

  it('désactive en deux temps, puis propose de réactiver', async () => {
    signedIn(me('STAFF', ADMIN), { ...handlers(), [`POST /v1/admin/users/${U2}/disable`]: () => json(200, user({ status: 'DISABLED' })) });
    renderAt(`/users/${U2}`);
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.users.disable }));
    expect(calls(`POST /v1/admin/users/${U2}/disable`)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: fr.admin.users.detail.confirm }));
    await waitFor(() => expect(calls(`POST /v1/admin/users/${U2}/disable`)).toHaveLength(1));
    expect(await screen.findByText(fr.admin.users.disabledDone)).toBeInTheDocument();
  });

  it('sa propre fiche : aucune désactivation proposée', async () => {
    signedIn(me('STAFF', ADMIN, U2), handlers());
    renderAt(`/users/${U2}`);
    await screen.findByText('Agent de réception');
    expect(screen.queryByRole('button', { name: fr.admin.users.disable })).not.toBeInTheDocument();
  });

  it('un compte client : consultation seule, aucun rôle à gérer', async () => {
    signedIn(me('STAFF', ADMIN), handlers({ kind: 'CUSTOMER', roles: [{ userRoleId: UR, roleCode: 'CUSTOMER_INDIVIDUAL', scopeType: 'COMPANY', scopeId: null }] }));
    renderAt(`/users/${U2}`);
    await screen.findByText(fr.admin.users.kinds.CUSTOMER);
    expect(screen.queryByRole('button', { name: fr.admin.users.detail.addRole })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.admin.users.detail.remove })).not.toBeInTheDocument();
  });
});

describe('rôles et droits', () => {
  it('liste les rôles avec leur nombre de droits ; le détail se déplie et se filtre', async () => {
    signedIn(me('STAFF', ADMIN), { 'GET /v1/admin/roles': roleItems });
    renderAt('/roles');
    const card = (await screen.findByRole('heading', { name: 'Agent de réception' })).closest('li')!;
    expect(within(card).getByText('2 droits')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: fr.admin.roles.showPermissions }));
    expect(within(card).getByText('package:receive')).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText(fr.admin.roles.search), 'receive');
    expect(within(card).queryByText('package:read')).not.toBeInTheDocument();
  });
});

describe('entreprises (plateforme)', () => {
  const company = (overrides: Record<string, unknown> = {}) => ({
    id: U2, name: 'Société Test', slug: 'societe-test', status: 'ACTIVE', trackingPrefix: 'ST', customerCodePrefix: 'ST', defaultCurrency: 'USD', defaultLocale: 'fr', paymentPolicy: 'PAY_BEFORE_SHIPMENT', createdAt: '2026-10-01T10:00:00Z', ...overrides,
  });
  const platform = () => me('PLATFORM', ['company:manage']);

  it('liste, puis suspension en deux temps', async () => {
    signedIn(platform(), { 'GET /v1/platform/companies': { items: [company()] }, [`POST /v1/platform/companies/${U2}/suspend`]: () => json(200, company({ status: 'SUSPENDED' })) });
    renderAt('/companies');
    expect(await screen.findByText('societe-test')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: fr.admin.companies.suspend }));
    expect(calls(`POST /v1/platform/companies/${U2}/suspend`)).toHaveLength(0);
    expect(screen.getByText(fr.admin.companies.suspendAsk)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: fr.admin.companies.confirm }));
    await waitFor(() => expect(calls(`POST /v1/platform/companies/${U2}/suspend`)).toHaveLength(1));
    expect(await screen.findByText(fr.admin.companies.suspended)).toBeInTheDocument();
  });

  it('une entreprise suspendue se réactive en un clic', async () => {
    signedIn(platform(), { 'GET /v1/platform/companies': { items: [company({ status: 'SUSPENDED' })] }, [`POST /v1/platform/companies/${U2}/activate`]: () => json(200, company()) });
    renderAt('/companies');
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.companies.activate }));
    await waitFor(() => expect(calls(`POST /v1/platform/companies/${U2}/activate`)).toHaveLength(1));
  });

  it('création : champs contrôlés (préfixe de suivi sans I, L, O, U) avant tout envoi, puis envoi complet', async () => {
    signedIn(platform(), { 'GET /v1/platform/companies': { items: [] }, 'POST /v1/platform/companies': () => json(201, company()) });
    renderAt('/companies');
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(fr.admin.companies.create) }));
    const dialog = await screen.findByRole('dialog');
    const f = fr.admin.companies.fields;
    const type = (label: string, value: string) => userEvent.type(within(dialog).getByLabelText(label), value);
    await type(f.name, 'Ma société');
    await type(f.slug, 'ma-societe');
    await type(f.trackingPrefix, 'UL'); // lettres interdites
    await type(f.customerCodePrefix, 'MS');
    await type(f.adminFirstName, 'Aud');
    await type(f.adminLastName, 'Bien');
    await type(f.adminEmail, 'admin@ma-societe.example');
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.companies.create }));
    expect(calls('POST /v1/platform/companies')).toHaveLength(0);

    await userEvent.clear(within(dialog).getByLabelText(f.trackingPrefix));
    await type(f.trackingPrefix, 'MS');
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.companies.create }));
    await waitFor(() => expect(calls('POST /v1/platform/companies')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/platform/companies')[0])).toMatchObject({
      name: 'Ma société', slug: 'ma-societe', trackingPrefix: 'MS', customerCodePrefix: 'MS', defaultCurrency: 'USD', defaultLocale: 'fr',
      paymentPolicy: 'PAY_BEFORE_SHIPMENT', adminEmail: 'admin@ma-societe.example', adminFirstName: 'Aud', adminLastName: 'Bien',
    });
    expect(await screen.findByText(fr.admin.companies.created)).toBeInTheDocument();
  });

  it('un identifiant déjà pris est expliqué', async () => {
    signedIn(platform(), { 'GET /v1/platform/companies': { items: [] }, 'POST /v1/platform/companies': () => json(409, { error: { code: 'COMPANY_ALREADY_EXISTS', message: 'x' } }) });
    renderAt('/companies');
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(fr.admin.companies.create) }));
    const dialog = await screen.findByRole('dialog');
    const f = fr.admin.companies.fields;
    const type = (label: string, value: string) => userEvent.type(within(dialog).getByLabelText(label), value);
    await type(f.name, 'Ma société');
    await type(f.slug, 'demo');
    await type(f.trackingPrefix, 'MS');
    await type(f.customerCodePrefix, 'MS');
    await type(f.adminFirstName, 'Aud');
    await type(f.adminLastName, 'Bien');
    await type(f.adminEmail, 'admin@ma-societe.example');
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.companies.create }));
    expect(await within(dialog).findByText(fr.auth.errors.COMPANY_ALREADY_EXISTS)).toBeInTheDocument();
  });
});

describe('textes', () => {
  it('chaque code d’erreur de la gestion des accès a un message dans les trois langues', () => {
    for (const code of ['LAST_ADMINISTRATOR', 'PRIVILEGE_ESCALATION', 'EMAIL_ALREADY_USED', 'ROLE_ALREADY_ASSIGNED', 'USER_NOT_FOUND', 'COMPANY_ALREADY_EXISTS', 'PLATFORM_COMPANY_PROTECTED', 'ROLE_NOT_ASSIGNABLE', 'INVALID_SCOPE', 'UNKNOWN_ROLE']) {
      for (const lang of ['fr', 'ht', 'en'] as const) expect(catalogs[lang].auth.errors[code], `${lang}:${code}`).toBeTruthy();
    }
  });

  it('les trois langues ont les mêmes clés pour le panel', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix];
    expect(keys(catalogs.ht.admin)).toEqual(keys(catalogs.fr.admin));
    expect(keys(catalogs.en.admin)).toEqual(keys(catalogs.fr.admin));
  });
});
