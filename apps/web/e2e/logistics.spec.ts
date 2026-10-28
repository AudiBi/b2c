import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';
import { accountNav, adminApi, expect, loginThroughUi, registerAndVerify, test, type NewCustomer } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ipHeader = () => ({ 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` });

/** Le client déclare un achat par l'API (la recette de l'écran de préalerte est dans parcels.spec.ts). */
async function declarePurchase(request: APIRequestContext, customer: Pick<NewCustomer, 'email' | 'password'>, warehouseId: string) {
  const ip = ipHeader();
  const login = await request.post('/v1/auth/login', { headers: ip, data: { companySlug: 'e2e', email: customer.email, password: customer.password } });
  expect(login.status()).toBe(200);
  const { accessToken } = await login.json();
  const supplier = `LOG${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const created = await request.post('/v1/me/prealerts', {
    headers: { ...ip, Authorization: `Bearer ${accessToken}` },
    data: { storeName: 'Boutique logistique', supplierTracking: supplier, warehouseId, transportMode: 'AIR', purchaseAmount: 100, purchaseCurrency: 'USD', description: 'Colis de recette' },
  });
  expect(created.status()).toBe(201);
  const body = await created.json();
  return { supplier, trackingNumber: body.package.trackingNumber as string, packageId: body.package.id as string, accessToken };
}

async function staffLogin(page: Page) {
  await loginThroughUi(page, { email: process.env.E2E_ADMIN_EMAIL as string, password: process.env.E2E_ADMIN_PASSWORD as string });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('logistique : du scan en entrepôt au retrait en agence', () => {
  test('réception, pesée, rangement, lot, manifeste, départ, arrivée, réception en agence, retrait', async ({ page, request, browser }) => {
    const customer = await registerAndVerify(page, request);
    const admin = await adminApi(request);
    const warehouses = await (await admin.get('/v1/admin/warehouses')).json();
    const warehouse = warehouses.items.find((w: { reference: string }) => w.reference === 'MIA1');
    const purchase = await declarePurchase(request, customer, warehouse.id);

    // --- 1. Le personnel se connecte : le menu dépend des droits ----------------------------------
    await page.context().clearCookies();
    await staffLogin(page);
    const nav = accountNav(page);
    for (const name of ['Réception', 'Colis', 'Entrepôt', 'Lots', 'Agence']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();

    // --- 2. Réception par lecture d'un code --------------------------------------------------------
    await nav.getByRole('link', { name: 'Réception', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Réception en entrepôt' })).toBeVisible();
    const scan = page.getByLabel('Code du colis');
    await expect(scan).toBeFocused();
    await scan.fill(purchase.trackingNumber.toLowerCase());
    await page.keyboard.press('Enter');
    const entry = page.getByTestId('scan-entry').first();
    await expect(entry).toContainText('Reçu');
    await expect(entry).toContainText('(EE-');
    await expect(scan).toBeFocused();
    await expect(scan).toHaveValue('');
    // relire le même code ne crée rien
    await scan.fill(purchase.supplier);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('scan-entry').first()).toContainText('Déjà reçu');
    // un code inconnu crée un colis sans client, signalé comme tel
    await scan.fill(`INCONNU-${Date.now()}`);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('scan-entry').first()).toContainText('Non identifié');
    const axeReception = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeReception.violations.map((v) => v.id)).toEqual([]);

    // --- 3. Fiche du colis : pesée ----------------------------------------------------------------
    await page.getByTestId('scan-entry').nth(2).getByRole('link', { name: 'Ouvrir' }).click();
    await expect(page.getByTestId('staff-package-tracking')).toBeVisible();
    const weigh = page.getByRole('region', { name: 'Peser et enregistrer' });
    await weigh.getByRole('button', { name: 'Enregistrer la pesée' }).click();
    await expect(weigh.getByText('Ce champ est obligatoire.').first()).toBeVisible();
    await weigh.getByLabel('Poids', { exact: true }).fill('2');
    await weigh.getByLabel('Longueur').fill('40');
    await weigh.getByLabel('Largeur').fill('30');
    await weigh.getByLabel('Hauteur').fill('20');
    await weigh.getByRole('button', { name: 'Enregistrer la pesée' }).click();
    // Le message « Pesée enregistrée. » est éphémère (le panneau de pesée disparaît dès le rechargement du colis) :
    // on vérifie le résultat, pas le message (assertion instable révélée par la recette de la phase 9).
    await expect(page.getByText('Enregistré et pesé').first()).toBeVisible();
    await expect(page.getByText('2 kg').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Peser et enregistrer' })).toHaveCount(0);

    // --- 4. Changement de statut : le motif est exigé ----------------------------------------------
    const transition = page.getByRole('region', { name: 'Changer le statut' });
    await transition.getByLabel('Nouveau statut').selectOption('READY_TO_SHIP');
    await transition.getByRole('button', { name: 'Changer le statut' }).click();
    await expect(transition.getByText('Un motif est obligatoire pour ce changement.')).toBeVisible();
    await transition.getByLabel('Motif').fill('Paiement reçu au comptoir (recette)');
    await transition.getByRole('button', { name: 'Changer le statut' }).click();
    await expect(page.getByText('Statut modifié.')).toBeVisible();
    await expect(page.getByText('Prêt pour expédition').first()).toBeVisible();

    // --- 5. Rangement ------------------------------------------------------------------------------
    const code = `E2E${Date.now().toString().slice(-6)}`;
    await nav.getByRole('link', { name: 'Entrepôt', exact: true }).click();
    await page.getByLabel('Code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByText('Emplacement créé.')).toBeVisible();
    await nav.getByRole('link', { name: 'Colis', exact: true }).click();
    await page.getByLabel(/Numéro de suivi, numéro du marchand/).fill(purchase.supplier);
    await page.getByRole('button', { name: 'Appliquer' }).click();
    await page.getByTestId('staff-package-item').first().getByRole('link', { name: /Ouvrir/ }).click();
    const storage = page.getByRole('region', { name: 'Rangement' });
    await storage.getByLabel('Emplacement', { exact: true }).selectOption({ label: code });
    await storage.getByRole('button', { name: 'Ranger', exact: true }).click();
    await expect(page.getByTestId('current-location')).toHaveText(code);
    const packageUrl = page.url();

    // L'inventaire montre le colis rangé
    await nav.getByRole('link', { name: 'Entrepôt', exact: true }).click();
    await expect(page.getByTestId('inventory-item').filter({ hasText: purchase.trackingNumber.slice(0, 2) }).first()).toBeVisible();
    await expect(page.getByTestId('anomaly-unidentified')).toBeVisible();

    // --- 6. Lot de transport ----------------------------------------------------------------------
    await nav.getByRole('link', { name: 'Lots', exact: true }).click();
    await page.getByRole('button', { name: 'Nouveau lot' }).click();
    await page.getByLabel('Transporteur').fill('Transporteur de recette');
    await page.getByLabel('N° de connaissement / LTA').fill('LTA-E2E-1');
    await page.getByLabel('Agence de destination').selectOption({ label: 'Agence de recette (Delmas)' });
    await page.getByRole('button', { name: 'Créer le lot' }).click();
    await page.getByTestId('shipment-item').first().getByRole('link', { name: /Ouvrir/ }).click();
    await expect(page.getByTestId('shipment-status')).toHaveText('Ouvert');
    const reference = (await page.getByTestId('shipment-reference').textContent()) ?? '';
    expect(reference).toMatch(/^MIA1-AIR-\d{8}-\d+$/);
    await expect(page.getByText('Aucune date prévue')).toHaveCount(0);

    // chargement : un code inconnu est refusé, le bon colis est chargé, puis relu
    const loadField = page.getByLabel('Code du colis');
    await loadField.fill('INCONNU-9999');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Colis introuvable');
    await loadField.fill(purchase.trackingNumber);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('load-result')).toContainText('Chargé');
    await expect(page.getByTestId('shipment-packages')).toContainText(purchase.trackingNumber.slice(0, 2));
    await expect(page.getByTestId('shipment-totals')).toContainText('1 colis, 2 kg');
    await loadField.fill(purchase.supplier);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('load-result')).toContainText('Déjà dans ce lot');
    const axeShipment = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeShipment.violations.map((v) => v.id)).toEqual([]);

    // manifeste : CSV et PDF réellement téléchargés
    const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger le CSV' }).click()]);
    expect(csvDownload.suggestedFilename()).toBe(`manifeste-${reference}.csv`);
    const csv = await readFile((await csvDownload.path()) as string, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`Lot,${reference}`);
    expect(csv).toContain('Transporteur de recette');
    expect(csv).toContain(purchase.trackingNumber.slice(0, 2));
    const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger le PDF' }).click()]);
    expect(pdfDownload.suggestedFilename()).toBe(`manifeste-${reference}.pdf`);
    expect((await readFile((await pdfDownload.path()) as string)).subarray(0, 5).toString()).toBe('%PDF-');

    // départ : confirmation en deux temps, puis le lot ne se modifie plus
    await page.getByRole('button', { name: 'Faire partir' }).click();
    await expect(page.getByTestId('shipment-status')).toHaveText('Ouvert');
    await page.getByRole('button', { name: 'Confirmer : Faire partir' }).click();
    await expect(page.getByTestId('shipment-status')).toHaveText('Parti');
    await expect(page.getByText('1 colis mis à jour.')).toBeVisible();
    await expect(page.getByLabel('Code du colis')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retirer' })).toHaveCount(0);

    // le client voit « en transit » ; le suivi public aussi, sans aucune date prévue
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`/fr/tracking?n=${purchase.trackingNumber}`);
    await expect(visitor.getByTestId('tracking-result').getByText('En transit').first()).toBeVisible();
    await expect(visitor.getByTestId('tracking-pickup')).toHaveCount(0);
    expect(await visitor.locator('main').innerText()).not.toContain(reference);

    // l'inventaire de l'entrepôt ne contient plus le colis ; l'agence ne peut pas encore le recevoir
    await page.goto(packageUrl);
    await expect(page.getByText('En transit').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Rangement' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Agence', exact: true }).click();
    await page.getByLabel('Code du colis').fill(purchase.trackingNumber);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('pas encore arrivé');

    // --- 7. Arrivée du lot -------------------------------------------------------------------------
    await nav.getByRole('link', { name: 'Lots', exact: true }).click();
    await page.getByTestId('shipment-item').filter({ hasText: reference }).getByRole('link', { name: /Ouvrir/ }).click();
    await page.getByRole('button', { name: 'Déclarer l’arrivée' }).click();
    await page.getByRole('button', { name: 'Confirmer : Déclarer l’arrivée' }).click();
    await expect(page.getByTestId('shipment-status')).toHaveText('Arrivé');
    // la clôture est refusée tant que le colis n'est pas reçu en agence
    await page.getByRole('button', { name: 'Clôturer', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer : Clôturer' }).click();
    await expect(page.getByRole('alert')).toContainText('pas encore été reçus en agence');

    // --- 8. Réception en agence et retrait ----------------------------------------------------------
    await nav.getByRole('link', { name: 'Agence', exact: true }).click();
    await page.getByLabel('Code du colis').fill(purchase.trackingNumber);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('agency-scan-result')).toContainText('Reçu');
    const axeAgency = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeAgency.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('button', { name: new RegExp('^Prêt pour retrait : ') }).first().click();
    await expect(page.getByText('Colis prêt pour retrait.')).toBeVisible();

    // le lot peut maintenant être clos
    await nav.getByRole('link', { name: 'Lots', exact: true }).click();
    await page.getByTestId('shipment-item').filter({ hasText: reference }).getByRole('link', { name: /Ouvrir/ }).click();
    await page.getByRole('button', { name: 'Clôturer', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer : Clôturer' }).click();
    await expect(page.getByTestId('shipment-status')).toHaveText('Clos');
    for (const name of ['Faire partir', 'Déclarer l’arrivée', 'Clôturer', 'Annuler le lot']) await expect(page.getByRole('button', { name })).toHaveCount(0);

    // --- 9. Le client voit son point de retrait ----------------------------------------------------
    const customerPage = await (await browser.newContext()).newPage();
    await loginThroughUi(customerPage, customer);
    await customerPage.goto(`/fr/account/packages/${purchase.packageId}`);
    const pickup = customerPage.getByTestId('pickup-card');
    await expect(pickup).toContainText('Votre colis est prêt : vous pouvez venir le retirer.');
    await expect(pickup).toContainText('Agence de recette');
    await expect(pickup).toContainText('Lun-Ven 8h-17h');
    const axePickup = await new AxeBuilder({ page: customerPage }).withTags(WCAG).analyze();
    expect(axePickup.violations.map((v) => v.id)).toEqual([]);
    await customerPage.context().close();

    await visitor.reload();
    await expect(visitor.getByTestId('tracking-result').getByText('Prêt pour retrait').first()).toBeVisible();
    await expect(visitor.getByTestId('tracking-pickup')).toContainText('Agence de recette');
    await visitor.context().close();
  });

  test('un client n’a aucun accès aux écrans du personnel', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);
    const nav = accountNav(page);
    for (const name of ['Réception', 'Lots', 'Entrepôt', 'Agence']) await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
    await page.goto('/fr/account/staff/shipments');
    await expect(page.getByText('Impossible de charger ces informations.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nouveau lot' })).toHaveCount(0);
    await page.goto('/fr/account/staff/reception');
    await expect(page.getByText('Aucun entrepôt dans votre périmètre.').or(page.getByText('Impossible de charger ces informations.'))).toBeVisible();
    // l'API refuse aussi, indépendamment de l'interface
    const forbidden = await page.request.get('/v1/admin/shipments', { headers: { Authorization: `Bearer ${await page.evaluate(async () => {
      const res = await fetch('/v1/auth/refresh', { method: 'POST', headers: { 'X-CSRF-Protection': '1', 'Content-Type': 'application/json' }, body: '{}', credentials: 'include' });
      return (await res.json()).accessToken as string;
    })}` } });
    expect(forbidden.status()).toBe(403);
  });

  test('agences publiques et page « Entrepôts et agences » sur téléphone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/fr/locations');
    const agency = page.getByRole('heading', { name: 'Agence de recette' });
    await expect(agency).toBeVisible();
    await expect(page.getByText('Lun-Ven 8h-17h').first()).toBeVisible();
    await expect(page.getByText('Aucune agence n’est encore publiée.')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test('réception en créole et en anglais', async ({ page }) => {
    await staffLogin(page);
    await page.goto('/ht/account/staff/reception');
    await expect(page.getByRole('heading', { level: 1, name: 'Resepsyon nan depo' })).toBeVisible();
    await expect(page.getByLabel('Kòd kolis la')).toBeFocused();
    await page.goto('/en/account/staff/shipments');
    await expect(page.getByRole('heading', { level: 1, name: 'Transport shipments' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New shipment' })).toBeVisible();
  });
});
