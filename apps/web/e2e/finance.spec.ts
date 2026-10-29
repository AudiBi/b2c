import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';
import { accountNav, adminApi, adminLogin, adminNav, adminUrl, expect, loginThroughUi, MAILPIT, registerAndVerify, test, type NewCustomer } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ipHeader = () => ({ 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` });

async function customerApi(request: APIRequestContext, customer: Pick<NewCustomer, 'email' | 'password'>) {
  const ip = ipHeader();
  const login = await request.post('/v1/auth/login', { headers: ip, data: { companySlug: 'e2e', email: customer.email, password: customer.password } });
  expect(login.status()).toBe(200);
  const { accessToken } = await login.json();
  const headers = { ...ip, Authorization: `Bearer ${accessToken}` };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data?: unknown) => request.post(path, { headers, data }),
  };
}

/** Achat déclaré par le client, reçu et pesé par l'entrepôt (API) : prêt à être facturé. */
async function weighedPackage(request: APIRequestContext, customer: NewCustomer, warehouseId: string) {
  const me = await customerApi(request, customer);
  const supplier = `FIN${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const created = await me.post('/v1/me/prealerts', { storeName: 'Boutique finance', supplierTracking: supplier, warehouseId, transportMode: 'AIR', purchaseAmount: 80, purchaseCurrency: 'USD', description: 'Colis de recette finance' });
  expect(created.status(), await created.text()).toBe(201);
  const body = await created.json();
  const admin = await adminApi(request);
  expect((await admin.post('/v1/admin/packages/receive', { warehouseId, expectedPackageId: body.package.id })).status()).toBe(200);
  const weighed = await admin.post(`/v1/admin/packages/${body.package.id}/register`, { weight: { value: 2, unit: 'KG' }, dimensions: { length: 30, width: 20, height: 10, unit: 'CM' } });
  expect(weighed.status()).toBe(200);
  const profile = await (await me.get('/v1/me/profile')).json();
  return { packageId: body.package.id as string, tracking: body.package.trackingNumber as string, customerId: profile.customer.id as string, customerCode: profile.customer.customerCode as string };
}

const staffLogin = (page: Page) => adminLogin(page);

test.describe('finance : de la facture au paiement validé, avec les messages envoyés', () => {
  test('facture, déclaration de virement, validation, notifications et e-mail ; encaissement en espèces', async ({ page, request, browser }) => {
    const customer = await registerAndVerify(page, request);
    const admin = await adminApi(request);
    const warehouses = await (await admin.get('/v1/admin/warehouses')).json();
    const warehouse = warehouses.items.find((w: { reference: string }) => w.reference === 'MIA1');
    const first = await weighedPackage(request, customer, warehouse.id);

    // --- 1. Le personnel crée un brouillon à partir des colis pesés du client, puis l'émet -----------
    const staff = await (await browser.newContext()).newPage();
    await staffLogin(staff);
    await adminNav(staff).getByRole('link', { name: 'Factures', exact: true }).click();
    await expect(staff.getByRole('heading', { level: 1, name: 'Factures' })).toBeVisible();
    await staff.getByRole('button', { name: 'Nouvelle facture' }).click();
    await staff.getByLabel('Client (code, nom ou e-mail)').fill(first.customerCode);
    await staff.getByRole('button', { name: 'Chercher', exact: true }).click();
    await staff.getByRole('checkbox', { name: /^EE-/ }).check();
    const axeForm = await new AxeBuilder({ page: staff }).withTags(WCAG).analyze();
    expect(axeForm.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' ')}`)).toEqual([]);
    await staff.getByRole('button', { name: 'Créer le brouillon' }).click();
    await expect(staff.getByText('Brouillon').first()).toBeVisible();
    // le fret et la manutention viennent de la grille de recette (jamais saisis)
    await expect(staff.getByRole('table', { name: 'Détail' })).toContainText('Fret');
    await expect(staff.getByRole('table', { name: 'Détail' })).toContainText('Manutention');
    await staff.getByRole('button', { name: 'Émettre la facture' }).click();
    await expect(staff.getByText('Facture émise.')).toBeVisible();
    await expect(staff.getByText(/INV-\d{4}-\d{6}/).first()).toBeVisible();
    const invoiceNumber = (await staff.getByRole('heading', { level: 1 }).innerText()).match(/INV-\d{4}-\d{6}/)![0];

    // --- 2. Le client voit la facture et déclare son virement ---------------------------------------
    await loginThroughUi(page, customer);
    await accountNav(page).getByRole('link', { name: 'Mes factures', exact: true }).click();
    const item = page.getByTestId('invoice-item').filter({ hasText: invoiceNumber });
    await expect(item).toContainText('À payer');
    const axeList = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeList.violations.map((v) => v.id)).toEqual([]);
    await item.getByRole('link', { name: /Ouvrir/ }).click();
    await expect(page.getByTestId('invoice-balance')).toBeVisible();
    // pas de paiement par carte en ligne : le texte le dit honnêtement
    await expect(page.getByText('Le paiement par carte en ligne n’est pas disponible.')).toBeVisible();
    await page.getByLabel('Référence du paiement').fill('ab');
    await page.getByRole('button', { name: 'Déclarer mon paiement' }).click();
    await expect(page.getByText('Corrigez les champs signalés puis réessayez.')).toBeVisible();
    await page.getByLabel('Référence du paiement').fill(`VIR-${Date.now()}`);
    await page.getByRole('button', { name: 'Déclarer mon paiement' }).click();
    await expect(page.getByText('Paiement déclaré : il sera validé après vérification.')).toBeVisible();
    await expect(page.getByTestId('payment-item')).toContainText('En attente de validation');
    const axeDetail = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeDetail.violations.map((v) => v.id)).toEqual([]);

    // --- 3. Le personnel valide le paiement dans la file de rapprochement ----------------------------
    await adminNav(staff).getByRole('link', { name: 'Paiements', exact: true }).click();
    await expect(staff.getByRole('heading', { level: 1, name: 'Paiements et caisse' })).toBeVisible();
    const queued = staff.getByTestId('queue-payment').filter({ hasText: invoiceNumber });
    await expect(queued).toBeVisible();
    const axePayments = await new AxeBuilder({ page: staff }).withTags(WCAG).analyze();
    expect(axePayments.violations.map((v) => v.id)).toEqual([]);
    await queued.getByRole('button', { name: /^Valider/ }).click();
    await expect(staff.getByText('Paiement validé.')).toBeVisible();

    // la facture est réglée, le colis libéré
    await page.reload();
    await expect(page.getByText('Payée').first()).toBeVisible();
    await expect(page.getByTestId('invoice-balance')).toContainText('0,00');
    await expect(page.getByRole('button', { name: /^Reçu \(PDF\) RCT-/ })).toBeVisible();
    const me = await customerApi(request, customer);
    const pkg = await (await me.get(`/v1/me/packages/${first.packageId}`)).json();
    expect(pkg.status).toBe('READY_TO_SHIP');

    // --- 4. Notifications : le personnel lance le traitement, le client les lit ---------------------
    await adminNav(staff).getByRole('link', { name: 'Notifications', exact: true }).click();
    await staff.getByRole('button', { name: 'Lancer le traitement maintenant' }).click();
    await expect(staff.getByText(/Traitement terminé/)).toBeVisible();
    await expect(staff.getByTestId('log-item').filter({ hasText: 'Paiement reçu' }).first()).toBeVisible();
    const axeLog = await new AxeBuilder({ page: staff }).withTags(WCAG).analyze();
    expect(axeLog.violations.map((v) => v.id)).toEqual([]);

    await accountNav(page).getByRole('link', { name: /^Notifications/ }).click();
    await expect(page.getByTestId('notification-item').filter({ hasText: invoiceNumber }).first()).toBeVisible();
    await expect(page.getByTestId('notification-item').filter({ hasText: 'Paiement reçu' }).first()).toBeVisible();
    const axeInbox = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeInbox.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('button', { name: 'Tout marquer comme lu' }).click();
    await expect(page.getByText('Aucune non lue')).toBeVisible();

    // l'e-mail est réellement parti (Mailpit) avec le numéro de reçu
    await expect
      .poll(async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:${customer.email} subject:"Paiement reçu"` } });
        return ((await search.json()) as { messages?: unknown[] }).messages?.length ?? 0;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);

    // --- 5. Encaissement en espèces d'un second colis : caisse ouverte d'abord ----------------------
    // état de départ déterministe : aucune caisse ouverte (la base de recette survit d'une exécution à l'autre)
    const sessions = await (await admin.get('/v1/admin/cash-sessions')).json();
    for (const session of sessions.items.filter((x: { closedAt: string | null }) => !x.closedAt)) {
      expect((await admin.post(`/v1/admin/cash-sessions/${session.id}/close`, { countedAmount: 0 })).status()).toBe(200);
    }
    const second = await weighedPackage(request, customer, warehouse.id);
    const draft = await admin.post('/v1/admin/invoices', { customerId: second.customerId, packageIds: [second.packageId] });
    expect(draft.status()).toBe(201);
    const draftBody = await draft.json();
    expect((await admin.post(`/v1/admin/invoices/${draftBody.id}/issue`)).status()).toBe(200);

    await staff.goto(adminUrl(`/billing/${draftBody.id}`));
    await staff.getByRole('button', { name: 'Encaisser', exact: true }).click();
    await expect(staff.getByText('Ouvrez d’abord une caisse.')).toBeVisible();
    await adminNav(staff).getByRole('link', { name: 'Paiements', exact: true }).click();
    const open = staff.getByRole('form', { name: 'Ouvrir une caisse' });
    await open.getByRole('button', { name: 'Ouvrir une caisse' }).click();
    await expect(staff.getByText('Caisse ouverte.')).toBeVisible();
    await staff.goto(adminUrl(`/billing/${draftBody.id}`));
    await staff.getByRole('button', { name: 'Encaisser', exact: true }).click();
    await expect(staff.getByText(/Paiement enregistré, reçu RCT-/)).toBeVisible();
    await expect(staff.getByText('Payée').first()).toBeVisible();
    const axeInvoice = await new AxeBuilder({ page: staff }).withTags(WCAG).analyze();
    expect(axeInvoice.violations.map((v) => v.id)).toEqual([]);
  });
});
