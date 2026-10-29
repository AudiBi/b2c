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

const me = (mfa: { enabled: boolean; required: boolean; enrollmentRequired: boolean }, kind: 'STAFF' | 'CUSTOMER' = 'STAFF') => ({
  id: 'u1', companyId: 'c1', kind, email: 'admin@example.test', firstName: 'Admin', lastName: 'Test', locale: 'fr', emailVerified: true, roles: [], permissions: ['audit:read'], mfa,
});
function signedIn(user: object, extra: Record<string, Handler>) {
  document.cookie = 'b2c_admin_session=1';
  mockApi({ 'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' }, 'GET /v1/auth/me': user, 'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null }, ...extra });
}

describe('connexion avec second facteur', () => {
  it('le serveur demande le code : le champ apparaît, il est contrôlé avant l’envoi, puis envoyé avec le mot de passe', async () => {
    let attempt = 0;
    mockApi({
      'POST /v1/auth/login': () => {
        attempt += 1;
        return attempt === 1 ? json(401, { error: { code: 'TOTP_REQUIRED', message: 'x' } }) : json(200, { accessToken: 'jeton' });
      },
      'GET /v1/auth/me': me({ enabled: true, required: true, enrollmentRequired: false }),
      'POST /v1/auth/refresh': json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }),
    });
    const u = userEvent.setup();
    renderAt('/login');
    await u.type(await screen.findByLabelText(fr.auth.fields.email), 'admin@example.test');
    await u.type(screen.getByLabelText(fr.auth.fields.password), 'un-mot-de-passe-solide');
    expect(screen.queryByLabelText(fr.auth.login.totpCode)).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: fr.auth.login.submit }));
    const field = await screen.findByLabelText(fr.auth.login.totpCode);
    expect(bodyOf(calls('POST /v1/auth/login')[0])).toEqual({ companySlug: expect.any(String), email: 'admin@example.test', password: 'un-mot-de-passe-solide' });

    await u.type(field, '12ab');
    await u.click(screen.getByRole('button', { name: fr.auth.login.submit }));
    expect(await screen.findByText(fr.auth.login.totpFormat)).toBeInTheDocument();
    expect(calls('POST /v1/auth/login')).toHaveLength(1);

    await u.clear(field);
    await u.type(field, '123456');
    await u.click(screen.getByRole('button', { name: fr.auth.login.submit }));
    await waitFor(() => expect(calls('POST /v1/auth/login')).toHaveLength(2));
    expect(bodyOf(calls('POST /v1/auth/login')[1])).toMatchObject({ email: 'admin@example.test', totpCode: '123456' });
  });

  it('code de secours : bascule, format contrôlé, envoyé dans son propre champ', async () => {
    let attempt = 0;
    mockApi({
      'POST /v1/auth/login': () => (++attempt === 1 ? json(401, { error: { code: 'TOTP_REQUIRED', message: 'x' } }) : json(401, { error: { code: 'INVALID_TOTP', message: 'x' } })),
      'POST /v1/auth/refresh': json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }),
    });
    const u = userEvent.setup();
    renderAt('/login');
    await u.type(await screen.findByLabelText(fr.auth.fields.email), 'admin@example.test');
    await u.type(screen.getByLabelText(fr.auth.fields.password), 'un-mot-de-passe-solide');
    await u.click(screen.getByRole('button', { name: fr.auth.login.submit }));
    await u.click(await screen.findByRole('button', { name: fr.auth.login.useRecovery }));
    const field = screen.getByLabelText(fr.auth.login.recoveryCode);
    await u.type(field, 'zzz');
    await u.click(screen.getByRole('button', { name: fr.auth.login.submit }));
    expect(await screen.findByText(fr.auth.login.recoveryFormat)).toBeInTheDocument();
    await u.clear(field);
    await u.type(field, 'abcd-2345');
    await u.click(screen.getByRole('button', { name: fr.auth.login.submit }));
    await waitFor(() => expect(calls('POST /v1/auth/login')).toHaveLength(2));
    expect(bodyOf(calls('POST /v1/auth/login')[1])).toMatchObject({ recoveryCode: 'abcd-2345' });
    expect(bodyOf(calls('POST /v1/auth/login')[1]).totpCode).toBeUndefined();
    expect(await screen.findByText(fr.auth.errors.INVALID_TOTP)).toBeInTheDocument();
    expect(screen.getByLabelText(fr.auth.login.recoveryCode)).toBeInTheDocument(); // le champ reste affiché
  });

  it('un compte sans double authentification se connecte sans champ supplémentaire', async () => {
    mockApi({
      'POST /v1/auth/login': { accessToken: 'jeton' },
      'GET /v1/auth/me': me({ enabled: false, required: false, enrollmentRequired: false }, 'CUSTOMER'),
      'POST /v1/auth/refresh': json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }),
    });
    const u = userEvent.setup();
    renderAt('/login');
    await u.type(await screen.findByLabelText(fr.auth.fields.email), 'client@example.test');
    await u.type(screen.getByLabelText(fr.auth.fields.password), 'un-mot-de-passe-solide');
    await u.click(screen.getByRole('button', { name: fr.auth.login.submit }));
    await waitFor(() => expect(calls('POST /v1/auth/login')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/auth/login')[0])).toEqual({ companySlug: expect.any(String), email: 'client@example.test', password: 'un-mot-de-passe-solide' });
  });
});

describe('page Sécurité : double authentification', () => {
  const section = () => screen.findByRole('region', { name: fr.account.security.twoFactor.title }, { timeout: 5000 });

  it('activation : mot de passe, secret affiché, premier code, codes de secours montrés une seule fois', async () => {
    let enabled = false;
    signedIn(me({ enabled: false, required: false, enrollmentRequired: false }), {
      'GET /v1/me/2fa': () => json(200, { enabled, pending: false, required: false, recoveryCodesLeft: enabled ? 10 : 0 }),
      'POST /v1/me/2fa/setup': () => json(200, { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/X:a?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }),
      'POST /v1/me/2fa/enable': () => {
        enabled = true;
        return json(200, { recoveryCodes: ['abcd-2345', 'efgh-6789'] });
      },
    });
    const u = userEvent.setup();
    renderAt('/security');
    const box = within(await section());
    await u.click(await box.findByRole('button', { name: fr.account.security.twoFactor.activate }));
    expect(calls('POST /v1/me/2fa/setup')).toHaveLength(0); // mot de passe manquant
    await u.type(box.getByLabelText(fr.account.security.twoFactor.password), 'un-mot-de-passe-solide');
    await u.click(box.getByRole('button', { name: fr.account.security.twoFactor.activate }));
    expect(await box.findByTestId('twofa-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    expect(bodyOf(calls('POST /v1/me/2fa/setup')[0])).toEqual({ password: 'un-mot-de-passe-solide' });

    await u.type(box.getByLabelText(fr.account.security.twoFactor.code), '12');
    await u.click(box.getByRole('button', { name: fr.account.security.twoFactor.confirm }));
    expect(await box.findByText(fr.account.security.twoFactor.codeFormat)).toBeInTheDocument();
    expect(calls('POST /v1/me/2fa/enable')).toHaveLength(0);
    await u.clear(box.getByLabelText(fr.account.security.twoFactor.code));
    await u.type(box.getByLabelText(fr.account.security.twoFactor.code), '123456');
    await u.click(box.getByRole('button', { name: fr.account.security.twoFactor.confirm }));
    const list = await box.findByTestId('recovery-codes');
    expect(list).toHaveTextContent('abcd-2345');
    expect(bodyOf(calls('POST /v1/me/2fa/enable')[0])).toEqual({ code: '123456' });
    await u.click(box.getByRole('button', { name: fr.account.security.twoFactor.recoverySaved }));
    expect(box.queryByTestId('recovery-codes')).not.toBeInTheDocument();
    expect(await box.findByText(/10 code\(s\) de secours restant/)).toBeInTheDocument();
  });

  it('désactivation : mot de passe et code, format accepté (6 chiffres ou secours)', async () => {
    signedIn(me({ enabled: true, required: false, enrollmentRequired: false }), {
      'GET /v1/me/2fa': { enabled: true, pending: false, required: false, recoveryCodesLeft: 1 },
      'POST /v1/me/2fa/disable': () => json(204),
    });
    const u = userEvent.setup();
    renderAt('/security');
    const box = within(await section());
    expect(await box.findByText(fr.account.security.twoFactor.fewCodes)).toBeInTheDocument();
    await u.click(box.getByRole('button', { name: fr.account.security.twoFactor.disable }));
    await u.type(box.getByLabelText(fr.account.security.twoFactor.password), 'un-mot-de-passe-solide');
    await u.type(box.getByLabelText(fr.account.security.twoFactor.codeAny), 'pas-un-code');
    await u.click(box.getByRole('button', { name: fr.account.security.twoFactor.disable }));
    expect(await box.findByText(fr.account.security.twoFactor.codeFormatAny)).toBeInTheDocument();
    expect(calls('POST /v1/me/2fa/disable')).toHaveLength(0);
    await u.clear(box.getByLabelText(fr.account.security.twoFactor.codeAny));
    await u.type(box.getByLabelText(fr.account.security.twoFactor.codeAny), 'ABCD-2345');
    await u.click(box.getByRole('button', { name: fr.account.security.twoFactor.disable }));
    await waitFor(() => expect(calls('POST /v1/me/2fa/disable')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/me/2fa/disable')[0])).toEqual({ password: 'un-mot-de-passe-solide', recoveryCode: 'abcd-2345' });
  });

  it('obligatoire : aucune désactivation proposée', async () => {
    signedIn(me({ enabled: true, required: true, enrollmentRequired: false }), { 'GET /v1/me/2fa': { enabled: true, pending: false, required: true, recoveryCodesLeft: 8 } });
    renderAt('/security');
    const box = within(await section());
    expect(await box.findByText(fr.account.security.twoFactor.requiredLocked)).toBeInTheDocument();
    expect(box.queryByRole('button', { name: fr.account.security.twoFactor.disable })).not.toBeInTheDocument();
    expect(box.getByRole('button', { name: fr.account.security.twoFactor.regenerate })).toBeInTheDocument();
  });

  it('activation exigée : tout l’espace renvoie vers la page Sécurité avec l’explication', async () => {
    signedIn(me({ enabled: false, required: true, enrollmentRequired: true }), { 'GET /v1/me/2fa': { enabled: false, pending: false, required: true, recoveryCodesLeft: 0 } });
    renderAt('/audit');
    expect(await screen.findByText(fr.account.security.twoFactor.enrollmentRequired, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByTestId('audit-item')).not.toBeInTheDocument();
    expect(calls('GET /v1/audit')).toHaveLength(0);
  });
});

describe('textes', () => {
  it('les codes d’erreur de la double authentification existent dans les trois langues', () => {
    for (const lang of ['fr', 'ht', 'en'] as const) {
      for (const code of ['INVALID_TOTP', 'TOTP_ENROLLMENT_REQUIRED', 'TOTP_ALREADY_ENABLED', 'TOTP_SETUP_REQUIRED', 'TOTP_NOT_ENABLED', 'TOTP_REQUIRED_BY_POLICY']) {
        expect(catalogs[lang].auth.errors[code], `${lang}:${code}`).toBeTruthy();
      }
    }
  });
});
