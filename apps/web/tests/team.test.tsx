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
    const handler = handlers[`${init?.method ?? 'GET'} ${url.pathname}`];
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

const owner = (totp = true) => ({
  id: 'u1', companyId: 'c1', kind: 'CUSTOMER', email: 'chef@example.test', firstName: 'Paul', lastName: 'Chef', locale: 'fr', emailVerified: true, roles: [],
  permissions: ['profile:read_own', 'team:manage_own', 'package:read_own', 'prealert:read_own', 'invoice:read_own', 'notification:read_own', 'claim:read_own'],
  mfa: { enabled: totp, required: false, enrollmentRequired: false },
});
const reader = {
  ...owner(),
  id: 'u2',
  firstName: 'Anne',
  permissions: ['package:read_own', 'invoice:read_own', 'claim:read_own'],
};
function signedIn(user: object, extra: Record<string, Handler> = {}) {
  document.cookie = 'b2c_session=1';
  mockApi({
    'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
    'GET /v1/auth/me': user,
    'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null },
    'GET /v1/me/profile': { id: 'u1', kind: 'CUSTOMER', customer: { id: 'k1', customerCode: 'TT-000001', customerType: 'BUSINESS', notificationPrefs: {} } },
    ...extra,
  });
}

const member = (over: Record<string, unknown> = {}) => ({ userId: 'm1', firstName: 'Anne', lastName: 'Membre', email: 'anne@example.test', status: 'ACTIVE', role: 'READER', lastLoginAt: null, ...over });

describe('espace client : équipe d’un compte professionnel', () => {
  it('le menu d’un membre ne montre que ce que son rôle permet (pas de profil, adresses, équipe)', async () => {
    signedIn(reader);
    renderAt('/fr/account');
    const nav = await screen.findByRole('navigation', { name: fr.a11y.accountNav });
    expect(within(nav).getByText(fr.account.nav.packages)).toBeTruthy();
    expect(within(nav).getByText(fr.account.nav.invoices)).toBeTruthy();
    for (const hidden of [fr.account.nav.profile, fr.account.nav.addresses, fr.account.nav.beneficiaries, fr.account.nav.team, fr.account.nav.prealerts, fr.account.nav.notifications]) {
      expect(within(nav).queryByText(hidden)).toBeNull();
    }
    // aucun appel au profil ni aux notifications, que le membre n’a pas le droit de lire
    expect(calls('GET /v1/me/profile')).toHaveLength(0);
    expect(calls('GET /v1/me/notifications')).toHaveLength(0);
  });

  it('le propriétaire voit l’entrée « Mon équipe » et la liste de ses membres', async () => {
    signedIn(owner(), { 'GET /v1/me/team': { limit: 10, items: [member(), member({ userId: 'm2', firstName: 'Luc', email: 'luc@example.test', role: 'OPERATOR', status: 'PENDING' })] } });
    renderAt('/fr/account/team');
    expect(await screen.findByRole('heading', { name: fr.account.team.title })).toBeTruthy();
    expect(await screen.findByText('anne@example.test')).toBeTruthy();
    expect(screen.getByText('luc@example.test')).toBeTruthy();
    expect(screen.getByText('2 / 10')).toBeTruthy();
  });

  it('invitation : champs contrôlés avant tout envoi, puis rôle et langue envoyés', async () => {
    let created = false;
    signedIn(owner(), {
      'GET /v1/me/team': () => json(200, { limit: 10, items: created ? [member()] : [] }),
      'POST /v1/me/team': () => {
        created = true;
        return json(201, member());
      },
    });
    const u = userEvent.setup();
    renderAt('/fr/account/team');
    await u.click(await screen.findByRole('button', { name: fr.account.team.invite }));
    await u.click(screen.getByRole('button', { name: fr.account.team.sendInvite }));
    expect(calls('POST /v1/me/team')).toHaveLength(0);
    await u.type(screen.getByLabelText(fr.auth.fields.firstName), 'Anne');
    await u.type(screen.getByLabelText(fr.auth.fields.lastName), 'Membre');
    await u.type(screen.getByLabelText(fr.auth.fields.email), 'anne@example.test');
    await u.selectOptions(screen.getByLabelText(fr.account.team.role), 'OPERATOR');
    await u.click(screen.getByRole('button', { name: fr.account.team.sendInvite }));
    await waitFor(() => expect(calls('POST /v1/me/team')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/me/team')[0])).toMatchObject({ email: 'anne@example.test', role: 'OPERATOR', locale: 'fr' });
    expect(await screen.findByText(fr.account.team.invited)).toBeTruthy();
  });

  it('retrait en deux temps ; changement de rôle envoyé tout de suite', async () => {
    signedIn(owner(), {
      'GET /v1/me/team': { limit: 10, items: [member()] },
      'PATCH /v1/me/team/m1': member({ role: 'OPERATOR' }),
      'DELETE /v1/me/team/m1': () => json(204),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/team');
    await screen.findByText('anne@example.test');
    await u.selectOptions(screen.getByLabelText(fr.account.team.role), 'OPERATOR');
    await waitFor(() => expect(calls('PATCH /v1/me/team/m1')).toHaveLength(1));
    expect(bodyOf(calls('PATCH /v1/me/team/m1')[0])).toEqual({ role: 'OPERATOR' });

    await u.click(screen.getByRole('button', { name: new RegExp(fr.account.team.remove) }));
    expect(calls('DELETE /v1/me/team/m1')).toHaveLength(0);
    await u.click(screen.getByRole('button', { name: fr.account.team.confirmRemove }));
    await waitFor(() => expect(calls('DELETE /v1/me/team/m1')).toHaveLength(1));
  });

  it('sans double authentification : avertissement ; refus du serveur expliqué', async () => {
    signedIn(owner(false), {
      'GET /v1/me/team': { limit: 10, items: [] },
      'POST /v1/me/team': () => json(403, { error: { code: 'TOTP_ENROLLMENT_REQUIRED', message: 'x' } }),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/team');
    expect(await screen.findByText(fr.account.team.mfaRequired)).toBeTruthy();
    await u.click(await screen.findByRole('button', { name: fr.account.team.invite }));
    await u.type(screen.getByLabelText(fr.auth.fields.firstName), 'Anne');
    await u.type(screen.getByLabelText(fr.auth.fields.lastName), 'Membre');
    await u.type(screen.getByLabelText(fr.auth.fields.email), 'anne@example.test');
    await u.click(screen.getByRole('button', { name: fr.account.team.sendInvite }));
    expect(await screen.findByText(fr.auth.errors.TOTP_ENROLLMENT_REQUIRED)).toBeTruthy();
  });

  it('un membre qui ouvre l’adresse de la page équipe n’y accède pas et aucun appel n’est fait', async () => {
    signedIn(reader);
    renderAt('/fr/account/team');
    expect(await screen.findByText(fr.account.team.businessOnly)).toBeTruthy();
    expect(calls('GET /v1/me/team')).toHaveLength(0);
  });
});
