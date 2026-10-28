import { randomBytes } from 'node:crypto';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

export const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? 8035}`;

export const uniqueEmail = () => `e2e-${Date.now()}-${randomBytes(3).toString('hex')}@example.test`;
export const strongPassword = () => `Pw-${randomBytes(9).toString('hex')}`;
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`;

/**
 * Chaque test reçoit une adresse IP fictive distincte (l'API de recette fait confiance à X-Forwarded-For),
 * pour que les limites de débit par IP ne s'accumulent pas entre tests.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'X-Forwarded-For': fakeIp() });
    await use(context);
  },
});
export { expect };

/** Attend un e-mail adressé à `to` dans Mailpit et renvoie le jeton (token=…) de son lien. */
export async function tokenFromMail(request: APIRequestContext, to: string, nth = 1): Promise<{ token: string; text: string; subject: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const search = await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:${to}` } });
    const body = (await search.json()) as { messages?: { ID: string }[] };
    if ((body.messages?.length ?? 0) >= nth) {
      const sorted = [...body.messages!].reverse(); // du plus ancien au plus récent
      const detail = await request.get(`${MAILPIT}/api/v1/message/${sorted[nth - 1].ID}`);
      const message = (await detail.json()) as { Text: string; Subject: string };
      const match = /token=([^\s&]+)/.exec(message.Text);
      if (!match) throw new Error(`Pas de jeton dans le message « ${message.Subject} »`);
      return { token: decodeURIComponent(match[1]), text: message.Text, subject: message.Subject };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Aucun e-mail reçu pour ${to}`);
}

export interface NewCustomer {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/** Inscription par l'interface, puis confirmation de l'adresse par le lien de l'e-mail reçu. */
export async function registerAndVerify(page: Page, request: APIRequestContext, overrides: Partial<NewCustomer> = {}): Promise<NewCustomer> {
  const customer: NewCustomer = { email: uniqueEmail(), password: strongPassword(), firstName: 'Marie', lastName: 'Jean', ...overrides };
  await page.goto('/fr/register');
  await page.getByLabel('Prénom').fill(customer.firstName);
  await page.getByLabel('Nom', { exact: true }).fill(customer.lastName);
  await page.getByLabel('Adresse e-mail').fill(customer.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(customer.password);
  await page.getByLabel(/J’ai lu et j’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByRole('heading', { name: 'Vérifiez votre boîte de réception' })).toBeVisible();

  const mail = await tokenFromMail(request, customer.email);
  await page.goto(`/fr/verify-email?token=${encodeURIComponent(mail.token)}`);
  await expect(page.getByText('Votre adresse e-mail est confirmée.')).toBeVisible();
  return customer;
}

/** Connexion par l'interface. Par défaut on attend l'arrivée dans l'espace client ; { expectSuccess: false } pour un échec attendu. */
export async function loginThroughUi(
  page: Page,
  customer: Pick<NewCustomer, 'email' | 'password'>,
  path = '/fr/login',
  options: { expectSuccess?: boolean } = {},
): Promise<void> {
  await page.goto(path);
  await page.getByLabel('Adresse e-mail').fill(customer.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(customer.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  if (options.expectSuccess !== false) await page.waitForURL(/\/account/);
}

/** Navigation latérale de l'espace client (les cartes du tableau de bord portent les mêmes libellés). */
export const accountNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation de votre espace' });

/** Session d'administration (API) : les opérations du personnel n'ont pas encore d'interface, la recette les fait par l'API. */
export async function adminApi(request: APIRequestContext) {
  const ip = fakeIp();
  const login = await request.post('/v1/auth/login', {
    headers: { 'X-Forwarded-For': ip },
    data: { companySlug: 'e2e', email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
  });
  expect(login.status()).toBe(200);
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': ip };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data?: unknown) => request.post(path, { headers, data }),
    put: (path: string, data?: unknown) => request.put(path, { headers, data }),
  };
}

/** Session d'API d'un client déjà inscrit (les écrans de recette passent par l'interface, la préparation de données par l'API). */
export async function customerApi(request: APIRequestContext, customer: Pick<NewCustomer, 'email' | 'password'>) {
  const ip = fakeIp();
  const login = await request.post('/v1/auth/login', { headers: { 'X-Forwarded-For': ip }, data: { companySlug: 'e2e', email: customer.email, password: customer.password } });
  expect(login.status()).toBe(200);
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': ip };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data?: unknown) => request.post(path, { headers, data }),
  };
}
