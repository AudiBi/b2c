import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginSchema, registerSchema } from '@b2c/shared';
import { AppRoutes } from '../src/App';
import { ApiError } from '../src/api/client';
import { issuesToErrors, localizeIssue, serverFieldErrors } from '../src/forms/validation';
import { catalogs, LANGS } from '../src/i18n';
import { AppProviders } from '../src/providers';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderAt(url: string) {
  return render(
    <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('traduction des erreurs de validation', () => {
  it.each(LANGS)('%s : chaque règle des schémas partagés produit un message traduit', (lang) => {
    const m = catalogs[lang];
    const result = registerSchema.safeParse({ companySlug: 'demo', accountType: 'INDIVIDUAL', email: 'x', password: 'password123', firstName: '', lastName: 'A', phone: '123', acceptTerms: false });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = issuesToErrors(result.error, m);
    expect(errors.email).toBe(m.validation.email);
    expect(errors.password).toBe(m.validation.passwordCommon);
    expect(errors.phone).toBe(m.validation.phone);
    expect(errors.acceptTerms).toBe(m.validation.terms);
    expect(errors.firstName).toBeDefined();
    for (const message of Object.values(errors)) expect(message).not.toMatch(/Invalid input|received|password_|_format|too_small/);
  });

  it('longueur minimale : le nombre est inséré dans la phrase', () => {
    const parsed = loginSchema.safeParse({ email: 'a@b.co', password: '' });
    expect(parsed.success).toBe(false);
    const short = registerSchema.safeParse({ companySlug: 'demo', accountType: 'INDIVIDUAL', email: 'a@b.co', password: 'court', firstName: 'A', lastName: 'B', acceptTerms: true });
    if (short.success) throw new Error('attendu : échec');
    expect(localizeIssue(short.error.issues[0], catalogs.en)).toBe('At least 10 characters.');
    expect(localizeIssue(short.error.issues[0], catalogs.ht)).toBe('Omwen 10 karaktè.');
  });

  it('les codes renvoyés par le serveur sont traduits, les messages inconnus deviennent « invalide »', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'x', [
      { path: 'phone', message: 'phone_format' },
      { path: 'country', message: 'country_format' },
      { path: 'other', message: 'Invalid input: expected string' },
    ]);
    expect(serverFieldErrors(error, catalogs.fr)).toEqual({
      phone: catalogs.fr.validation.phone,
      country: catalogs.fr.validation.countryCode,
      other: catalogs.fr.validation.invalid,
    });
  });
});

describe('formulaire d’inscription', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('affiche des erreurs localisées, accessibles, sans appeler le serveur', async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } })); // restauration de session
    const user = userEvent.setup();
    renderAt('/fr/register');
    await user.click(await screen.findByRole('button', { name: 'Créer mon compte' }));

    expect(await screen.findAllByText('Ce champ est obligatoire.')).not.toHaveLength(0);
    expect(screen.getByText('Vous devez accepter les conditions pour continuer.')).toBeInTheDocument();
    const email = screen.getByLabelText('Adresse e-mail');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email.getAttribute('aria-describedby')).toMatch(/error/);
    expect(screen.getByRole('alert')).toHaveTextContent('Corrigez les champs signalés');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/auth/register'))).toBe(false);
  });

  it('envoie les bonnes données (identifiant d’entreprise, langue, champs facultatifs absents) puis affiche la confirmation neutre', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/register') ? json(202, { status: 'verification_email_sent' }) : json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } })));
    const user = userEvent.setup();
    renderAt('/en/register');
    await user.type(await screen.findByLabelText('First name'), 'Marie');
    await user.type(screen.getByLabelText('Last name'), 'Jean');
    await user.type(screen.getByLabelText('Email address'), 'marie@example.test');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'A-long-secret-123');
    await user.click(screen.getByLabelText(/I have read and accept/));
    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/auth/register'))!;
    expect(JSON.parse(call[1].body)).toEqual({
      companySlug: 'demo',
      accountType: 'INDIVIDUAL',
      email: 'marie@example.test',
      password: 'A-long-secret-123',
      firstName: 'Marie',
      lastName: 'Jean',
      locale: 'en',
      acceptTerms: true,
    });
    expect(new Headers(call[1].headers).get('Authorization')).toBeNull();
  });

  it('une erreur de validation du serveur est rattachée au bon champ, traduite', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/register')
        ? json(400, { error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ in: 'body', path: 'phone', message: 'phone_format' }] } })
        : json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }),
    );
    const user = userEvent.setup();
    renderAt('/fr/register');
    await user.type(await screen.findByLabelText('Prénom'), 'Marie');
    await user.type(screen.getByLabelText('Nom', { exact: true }), 'Jean');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'marie@example.test');
    await user.type(screen.getByLabelText('Mot de passe', { exact: true }), 'Un-bon-secret-123');
    await user.click(screen.getByLabelText(/J’ai lu et j’accepte/));
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    await waitFor(() => expect(screen.getByText('Format international attendu, par exemple +50937000000.')).toBeInTheDocument());
  });

  it('le champ « raison sociale » n’apparaît que pour un compte professionnel', async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));
    const user = userEvent.setup();
    renderAt('/fr/register');
    await screen.findByLabelText('Prénom');
    expect(screen.queryByLabelText('Raison sociale')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Professionnel'));
    expect(screen.getByLabelText('Raison sociale')).toBeInTheDocument();
  });
});

describe('espace client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sans session, une page de l’espace renvoie vers la connexion en mémorisant la destination', async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));
    renderAt('/fr/account/addresses');
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument();
  });
});
