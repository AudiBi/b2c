import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { accountNav, adminApi, adminLogin, adminNav, adminUrl, customerApi, expect, loginThroughUi, registerAndVerify, strongPassword, test, tokenFromMail, uniqueEmail, type NewCustomer } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
type Admin = Awaited<ReturnType<typeof adminApi>>;

async function expectNoViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' ')}`)).toEqual([]);
}

/** Colis du client arrivé et « prêt pour retrait » dans l'agence de recette, par le chemin réel (API). */
async function readyAtAgency(request: APIRequestContext, admin: Admin, customer: NewCustomer, ids: { warehouseId: string; agencyId: string }) {
  const me = await customerApi(request, customer);
  const supplier = `DEL${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const created = await me.post('/v1/me/prealerts', { storeName: 'Boutique livraison', supplierTracking: supplier, warehouseId: ids.warehouseId, transportMode: 'AIR', purchaseAmount: 60, purchaseCurrency: 'USD', description: 'Colis de recette livraison' });
  expect(created.status(), await created.text()).toBe(201);
  const body = await created.json();
  const id = body.package.id as string;
  expect((await admin.post('/v1/admin/packages/receive', { warehouseId: ids.warehouseId, expectedPackageId: id })).status()).toBe(200);
  expect((await admin.post(`/v1/admin/packages/${id}/register`, { weight: { value: 2, unit: 'KG' }, dimensions: { length: 30, width: 20, height: 10, unit: 'CM' } })).status()).toBe(200);
  expect((await admin.post(`/v1/admin/packages/${id}/transitions`, { to: 'READY_TO_SHIP', reason: 'Prépayé (recette)' })).status()).toBe(200);
  const shipment = await admin.post('/v1/admin/shipments', { transportMode: 'AIR', originWarehouseId: ids.warehouseId, destinationCountry: 'HT', destinationAgencyId: ids.agencyId });
  expect(shipment.status()).toBe(201);
  const shipmentId = (await shipment.json()).id as string;
  expect((await admin.post(`/v1/admin/shipments/${shipmentId}/packages`, { packageId: id })).status()).toBe(200);
  for (const step of ['dispatch', 'arrive']) expect((await admin.post(`/v1/admin/shipments/${shipmentId}/${step}`, {})).status()).toBe(200);
  expect((await admin.post(`/v1/admin/agencies/${ids.agencyId}/receive`, { code: body.package.trackingNumber })).status()).toBe(200);
  expect((await admin.post(`/v1/admin/agencies/${ids.agencyId}/packages/${id}/ready-for-pickup`, {})).status()).toBe(200);
  const display = (await (await me.get(`/v1/me/packages/${id}`)).json()).trackingNumberDisplay as string;
  return { id, display };
}

async function staffPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await adminLogin(page);
  return page;
}

/** Le client génère son code depuis la fiche du colis (interface) et le lit à l'écran. */
async function customerCode(page: Page, packageId: string): Promise<string> {
  await page.goto(`/fr/account/packages/${packageId}`);
  await page.getByRole('button', { name: /^(Obtenir mon code|Générer un nouveau code)$/ }).click();
  const code = (await page.getByTestId('handover-code').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

test.describe('livraison : remise au comptoir, tournée du livreur, réclamation, tableau de bord', () => {
  test('code du client → remise à l’agence ; tournée → remise et échec par le livreur ; réclamation ; tableau de bord et audit', async ({ page, request, browser }) => {
    const customer = await registerAndVerify(page, request);
    const admin = await adminApi(request);
    const warehouses = await (await admin.get('/v1/admin/warehouses')).json();
    const warehouse = warehouses.items.find((w: { reference: string }) => w.reference === 'MIA1');
    const agencies = await (await admin.get('/v1/admin/agencies')).json();
    const agency = agencies.items.find((a: { code: string }) => a.code === 'AGE1');
    const ids = { warehouseId: warehouse.id as string, agencyId: agency.id as string };

    // état de départ déterministe : règle de preuves par défaut (la base de recette survit d'une exécution à l'autre)
    expect((await admin.put('/v1/admin/settings/delivery', { requireOtp: true, requireIdDocument: true, requirePhoto: false })).status()).toBe(200);
    const me = await customerApi(request, customer);
    expect((await me.post('/v1/me/addresses', { kind: 'DELIVERY', label: 'Maison', recipientName: 'Marie Jean', line1: '12 rue des Palmistes', city: 'Pétion-Ville', country: 'ht', phone: '+50937000001' })).status()).toBe(201);

    const counter = await readyAtAgency(request, admin, customer, ids);
    const delivery = await readyAtAgency(request, admin, customer, ids);
    const missed = await readyAtAgency(request, admin, customer, ids);

    // --- 1. Le client voit son code, le personnel remet au comptoir (code faux refusé d'abord) ----------------
    await loginThroughUi(page, customer);
    const code = await customerCode(page, counter.id);
    await expectNoViolations(page);

    const staff = await staffPage(browser);
    await staff.goto(adminUrl(`/packages/${counter.id}`));
    const panel = staff.getByRole('region', { name: 'Remise au client' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Confirmer la remise' }).click();
    await expect(panel.getByText('Corrigez les champs signalés puis réessayez.')).toBeVisible();
    await panel.getByLabel(/Quatre derniers caractères/).fill('4821');
    await panel.getByLabel(/Code de remise du client/).fill(code === '000000' ? '111111' : '000000');
    await panel.getByRole('button', { name: 'Confirmer la remise' }).click();
    await expect(panel.getByText('Code de remise incorrect.')).toBeVisible();
    await expectNoViolations(staff);
    await panel.getByLabel(/Code de remise du client/).fill(code);
    await panel.getByRole('button', { name: 'Confirmer la remise' }).click();
    await expect(panel.getByText('Colis remis.')).toBeVisible();
    await expect(staff.getByText('Remis').first()).toBeVisible();
    await expect(panel.getByTestId('attempts')).toContainText('code vérifié');
    // le code est consommé : le colis étant remis, le client n'en obtient plus
    await page.goto(`/fr/account/packages/${counter.id}`);
    await expect(page.getByTestId('handover-card')).toHaveCount(0);

    // --- 2. Un livreur invité (rôle « Livreur ») ne voit que ses tournées ---------------------------------------
    const driver = { email: uniqueEmail(), password: strongPassword() };
    const invited = await admin.post('/v1/admin/users', { email: driver.email, firstName: 'Livreur', lastName: `E2E${Date.now()}`, roles: [{ roleCode: 'DRIVER', scopeType: 'COMPANY' }] });
    expect(invited.status(), await invited.text()).toBe(201);
    const driverName = (await invited.json()) as { firstName: string; lastName: string };
    const mail = await tokenFromMail(request, driver.email);
    const reset = await request.post('/v1/auth/reset-password', { data: { token: mail.token, newPassword: driver.password } });
    expect(reset.status()).toBe(200);

    // --- 3. Le personnel planifie la tournée : 2 colis, départ ------------------------------------------------------
    await adminNav(staff).getByRole('link', { name: 'Tournées', exact: true }).click();
    await staff.getByRole('button', { name: 'Nouvelle tournée' }).click();
    await staff.getByLabel('Livreur', { exact: true }).selectOption({ label: `${driverName.firstName} ${driverName.lastName}` });
    await staff.getByLabel('Agence', { exact: true }).selectOption({ label: 'Agence de recette (Delmas)' });
    await staff.getByRole('button', { name: 'Créer la tournée' }).click();
    await expect(staff.getByRole('heading', { level: 1 })).toContainText('TOU-');
    for (const pkg of [delivery, missed]) {
      const select = staff.getByLabel('Colis', { exact: true });
      const option = select.locator('option', { hasText: pkg.display });
      await select.selectOption({ value: (await option.getAttribute('value')) as string });
      await staff.getByRole('button', { name: 'Ajouter à la tournée' }).click();
      await expect(staff.getByText('Arrêt ajouté : le client est prévenu.')).toBeVisible();
    }
    await expect(staff.getByTestId('route-stop')).toHaveCount(2);
    await expectNoViolations(staff);
    await staff.getByRole('button', { name: 'Faire partir la tournée' }).click();
    await expect(staff.getByText('Tournée partie : les colis sont en cours de livraison.')).toBeVisible();

    // --- 4. Le livreur : sa tournée seulement, remise avec le code du client, un échec -----------------------------
    const driverPage = await (await browser.newContext()).newPage();
    await adminLogin(driverPage, driver);
    const driverNav = adminNav(driverPage);
    await expect(driverNav.getByRole('link', { name: 'Mes tournées', exact: true })).toBeVisible();
    await expect(driverNav.getByRole('link', { name: 'Tournées', exact: true })).toHaveCount(0);
    await expect(driverNav.getByRole('link', { name: 'Accueil' })).toBeVisible();
    expect(await driverNav.locator('a[href="/dashboard"]').count()).toBe(0);
    await driverNav.getByRole('link', { name: 'Mes tournées', exact: true }).click();
    await expect(driverPage.getByTestId('route-item')).toHaveCount(1);
    await driverPage.getByRole('link', { name: /^Ouvrir : TOU-/ }).click();
    await expect(driverPage.getByTestId('route-stop')).toHaveCount(2);
    await expect(driverPage.getByText('12 rue des Palmistes').first()).toBeVisible();
    await expect(driverPage.getByRole('button', { name: 'Faire partir la tournée' })).toHaveCount(0);
    await expectNoViolations(driverPage);

    const deliveryCode = await customerCode(page, delivery.id);
    await driverPage.getByRole('button', { name: `Remettre : ${delivery.display}` }).click();
    const stop = driverPage.getByTestId('route-stop').filter({ hasText: delivery.display });
    await stop.getByLabel(/Quatre derniers caractères/).fill('4821');
    await stop.getByLabel(/Code de remise du client/).fill(deliveryCode);
    await stop.getByRole('button', { name: 'Confirmer la remise' }).click();
    await expect(driverPage.getByText('Remise enregistrée.')).toBeVisible();
    await expect(stop).toContainText('Remis');

    await driverPage.getByRole('button', { name: `Échec : ${missed.display}` }).click();
    const missedStop = driverPage.getByTestId('route-stop').filter({ hasText: missed.display });
    await missedStop.getByLabel('Motif').selectOption('ABSENT');
    await missedStop.getByRole('button', { name: 'Enregistrer l’échec' }).click();
    await expect(driverPage.getByText('Livraison non aboutie enregistrée : le colis revient à l’agence.')).toBeVisible();
    // le colis raté est de nouveau « prêt pour retrait », le client est averti
    await page.goto(`/fr/account/packages/${missed.id}`);
    await expect(page.getByTestId('handover-card')).toBeVisible();

    // le livreur n'a pas accès au tableau de bord de l'entreprise
    await driverPage.goto(adminUrl('/dashboard'));
    await expect(driverPage.getByText('Ce tableau de bord concerne toute l’entreprise')).toBeVisible();

    // le personnel termine la tournée
    await staff.reload();
    await staff.getByRole('button', { name: 'Terminer la tournée' }).click();
    await expect(staff.getByText('Tournée terminée.')).toBeVisible();

    // --- 5. Réclamation : ouverture par le client depuis un colis, réponse du service, clôture ---------------------
    await page.goto(`/fr/account/packages/${missed.id}`);
    await page.getByRole('link', { name: 'Signaler un problème' }).click();
    await expect(page.getByLabel('Colis concerné')).toHaveValue(missed.id);
    await page.getByLabel('Objet').fill('Livreur absent');
    await page.getByLabel('Décrivez le problème').fill('Personne n’est venu aujourd’hui.');
    await page.getByRole('button', { name: 'Envoyer la réclamation' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('CLM-');
    await expectNoViolations(page);

    await adminNav(staff).getByRole('link', { name: 'Réclamations', exact: true }).click();
    await staff.getByTestId('staff-claim').filter({ hasText: 'Livreur absent' }).getByRole('link', { name: /^Ouvrir/ }).click();
    await staff.getByLabel('Message', { exact: true }).fill('Nous reprogrammons votre livraison.');
    await staff.getByRole('button', { name: 'Envoyer au client' }).click();
    await expect(staff.getByText('Réponse envoyée : le client est prévenu.')).toBeVisible();
    await staff.getByLabel('Nouvel état').selectOption('RESOLVED');
    await staff.getByRole('button', { name: 'Appliquer' }).click();
    await expect(staff.getByText('Ce champ est obligatoire.')).toBeVisible();
    await staff.getByLabel('Résolution (visible du client)').fill('Livraison reprogrammée.');
    await staff.getByRole('button', { name: 'Appliquer' }).click();
    await expect(staff.getByText('État modifié : le client est prévenu.')).toBeVisible();
    await expectNoViolations(staff);

    await page.reload();
    await expect(page.getByTestId('claim-messages')).toContainText('Nous reprogrammons votre livraison.');
    await expect(page.getByText('Livraison reprogrammée.').first()).toBeVisible();
    await expect(page.getByText('Cette réclamation est clôturée.', { exact: false })).toBeVisible();

    // --- 6. Tableau de bord et journal d'audit ------------------------------------------------------------------------
    await staff.goto(adminUrl('/dashboard'));
    await expect(staff.getByTestId('dashboard')).toBeVisible();
    expect(Number(await staff.getByTestId('dash-delivered').innerText())).toBeGreaterThanOrEqual(2);
    expect(Number(await staff.getByTestId('dash-customers').innerText())).toBeGreaterThanOrEqual(1);
    await expectNoViolations(staff);

    await staff.goto(adminUrl('/audit'));
    await staff.getByLabel(/^Action/).fill('delivery.completed');
    await staff.getByRole('button', { name: 'Filtrer' }).click();
    await expect(staff.getByTestId('audit-item').first()).toContainText('delivery.completed');
    await expectNoViolations(staff);
  });
});
