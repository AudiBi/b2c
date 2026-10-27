import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { adminApi, accountNav, expect, loginThroughUi, registerAndVerify, test } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

const uniqueSupplierTracking = () => `E2E${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;

test.describe('calculateur de frais', () => {
  test('estimation avec poids réel, puis poids volumétrique, assurance et détail des lignes', async ({ page }) => {
    await page.goto('/fr/calculator');
    await page.getByLabel('Poids du colis').fill('2,3');
    await page.getByRole('button', { name: 'Estimer les frais' }).click();

    const result = page.getByTestId('quote-result');
    await expect(result).toBeVisible();
    await expect(result.getByText('Estimation indicative', { exact: true })).toBeVisible();
    await expect(page.getByTestId('billable-weight')).toHaveText('2,5 kg');
    // 4 $ × 2,5 kg + 1,50 $ de manutention
    await expect(page.getByTestId('quote-total')).toContainText('11,50');
    await expect(result.getByText('Manutention')).toBeVisible();
    await expect(result.getByText('Non calculé')).toBeVisible();

    // Un colis léger mais volumineux : 40 × 30 × 20 cm = 4,8 kg volumétriques > 2 kg réels
    await page.getByLabel('Poids du colis').fill('2');
    await page.getByLabel('Longueur').fill('40');
    await page.getByLabel('Largeur').fill('30');
    await page.getByLabel('Hauteur').fill('20');
    await page.getByLabel('Valeur déclarée').fill('100');
    await page.getByLabel('Assurance').check();
    await page.getByRole('button', { name: 'Estimer les frais' }).click();
    await expect(page.getByTestId('billable-weight')).toHaveText('5 kg');
    await expect(result.getByText('4,8 kg')).toBeVisible();
    // 3,50 $ × 5 kg = 17,50 $ + 1,50 $ + 2 % de 100 $
    await expect(page.getByTestId('quote-total')).toContainText('21,00');
    await expect(result.getByText('Assurance')).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test('saisie invalide : erreurs localisées sans appel au serveur, en français et en anglais', async ({ page }) => {
    let quotes = 0;
    page.on('request', (request) => {
      if (request.url().includes('/quote')) quotes += 1;
    });
    await page.goto('/fr/calculator');
    await page.getByRole('button', { name: 'Estimer les frais' }).click();
    await expect(page.getByText('Ce champ est obligatoire.').first()).toBeVisible();
    await page.getByLabel('Poids du colis').fill('abc');
    await page.getByRole('button', { name: 'Estimer les frais' }).click();
    await expect(page.getByText('Saisissez un nombre (par exemple 2,5).')).toBeVisible();

    await page.goto('/en/calculator');
    await page.getByLabel('Package weight').fill('2.3');
    await page.getByLabel('Declared value').fill('10.999');
    await page.getByRole('button', { name: 'Estimate costs' }).click();
    await expect(page.getByText('At most two decimals.')).toBeVisible();
    expect(quotes).toBe(0);
  });

  test('poids hors grille : refus explicite, jamais de prix inventé', async ({ page }) => {
    // La grille de recette couvre tous les poids ; on choisit une catégorie restreinte inexistante via l'API publique
    await page.goto('/fr/calculator');
    const res = await page.request.post('/v1/public/companies/e2e/quote', {
      data: { transportMode: 'SEA', originCountry: 'US', destinationCountry: 'HT', weight: { value: 1, unit: 'KG' }, optionalSurcharges: [] },
      headers: { 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('TARIFF_UNAVAILABLE');
  });

  test('sur téléphone, la page ne déborde pas horizontalement', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/fr/calculator');
    await page.getByLabel('Poids du colis').fill('2');
    await page.getByRole('button', { name: 'Estimer les frais' }).click();
    await expect(page.getByTestId('quote-result')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('suivi public', () => {
  test('numéro inconnu ou mal formé : message neutre', async ({ page }) => {
    await page.goto('/fr/tracking');
    await page.getByLabel('Numéro de suivi').fill('EE-ZZZZZ-00000-0');
    await page.getByRole('button', { name: 'Suivre le colis' }).click();
    await expect(page.getByText('Aucun colis ne correspond à ce numéro.')).toBeVisible();
    await expect(page).toHaveURL(/\?n=EE-ZZZZZ-00000-0$/);
    await page.getByLabel('Numéro de suivi').fill('abc');
    await page.getByRole('button', { name: 'Suivre le colis' }).click();
    await expect(page.getByText('Aucun colis ne correspond à ce numéro.')).toBeVisible();
    await expect(page.getByTestId('tracking-result')).toHaveCount(0);
  });
});

test.describe('préalerte, réception, pesée et suivi', () => {
  test('parcours complet : le client déclare un achat, l’entrepôt le reçoit et le pèse, le suivi public suit chaque étape', async ({ page, request, browser }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);

    // --- 1. Préalerte -------------------------------------------------------------------------
    await accountNav(page).getByRole('link', { name: 'Mes préalertes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mes préalertes' })).toBeVisible();
    await expect(page.getByText('Vous n’avez pas encore déclaré d’achat.')).toBeVisible();

    const supplier = uniqueSupplierTracking();
    await page.getByRole('button', { name: 'Déclarer un achat' }).click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Ce champ est obligatoire.').first()).toBeVisible();

    await page.getByLabel('Boutique ou marchand').fill('Boutique de recette');
    await page.getByLabel('Numéro de suivi du marchand').fill(supplier);
    await page.getByLabel('Montant de l’achat').fill('59,90');
    await page.getByLabel('Contenu du colis').fill('Chaussures de sport');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/Préalerte enregistrée\. Numéro de suivi du colis : [0-9A-Z]{13}\./)).toBeVisible();

    const item = page.getByTestId('prealert-item').first();
    await expect(item).toContainText('Boutique de recette');
    await expect(item).toContainText('En attente du colis');
    const trackingNumber = ((await item.getByTestId('prealert-tracking').textContent()) ?? '').trim();
    expect(trackingNumber).toMatch(/^EE[0-9A-Z]{11}$/);

    // Un second achat avec le même numéro du marchand est refusé
    await page.getByRole('button', { name: 'Déclarer un achat' }).click();
    await page.getByLabel('Boutique ou marchand').fill('Autre');
    await page.getByLabel('Numéro de suivi du marchand').fill(supplier.toLowerCase());
    await page.getByLabel('Montant de l’achat').fill('10');
    await page.getByLabel('Contenu du colis').fill('Autre chose');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('alert')).toContainText('Une préalerte existe déjà pour ce numéro de suivi du marchand.');
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();

    // --- 2. Facture jointe --------------------------------------------------------------------
    await item.getByTestId('file-input-prealert').setInputFiles({ name: 'facture.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(item.getByText('Fichier ajouté.')).toBeVisible();
    await expect(item.getByText('facture.pdf')).toBeVisible();
    // Un fichier qui n'est pas un PDF malgré son nom est refusé par le serveur
    await item.getByTestId('file-input-prealert').setInputFiles({ name: 'faux.pdf', mimeType: 'application/pdf', buffer: Buffer.from('ceci est du texte, pas un PDF') });
    await expect(item.getByText('Format non pris en charge. Utilisez JPEG, PNG, WebP ou PDF.')).toBeVisible();
    // Ouverture par lien signé de courte durée (window.open est intercepté pour lire l'adresse demandée)
    await page.evaluate(() => {
      const w = window as unknown as { opened: string[] };
      w.opened = [];
      window.open = (url?: string | URL) => {
        w.opened.push(String(url));
        return null;
      };
    });
    await item.getByRole('button', { name: 'Ouvrir : facture.pdf' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened.length)).toBe(1);
    const link = await page.evaluate(() => (window as unknown as { opened: string[] }).opened[0]);
    expect(link).toMatch(/\/v1\/files\/[0-9a-f-]+\/content\?c=.+&exp=\d+&sig=[0-9a-f]{64}$/);
    const content = await page.request.get(link);
    expect(content.status()).toBe(200);
    expect(content.headers()['content-type']).toContain('application/pdf');
    expect(content.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(await content.body()).equals(PDF)).toBe(true);
    // Le lien ne marche plus s'il est altéré
    expect((await page.request.get(link.replace(/sig=([0-9a-f])/, (_m, c: string) => `sig=${c === 'a' ? 'b' : 'a'}`))).status()).toBe(403);

    // --- 3. Le colis attendu est visible dans « Mes colis » ----------------------------------
    await accountNav(page).getByRole('link', { name: 'Mes colis' }).click();
    const row = page.getByTestId('package-item').first();
    await expect(row).toContainText('En attente de réception');
    await row.getByRole('link', { name: /Détail/ }).click();
    await expect(page.getByTestId('package-tracking')).toContainText(trackingNumber.slice(0, 2));
    await expect(page.getByText('Le colis n’a pas encore été pesé.')).toBeVisible();
    await expect(page.getByText('Aucun montant n’est affiché')).toBeVisible();
    const packageUrl = page.url();

    // --- 4. Entrepôt : réception rapprochée automatiquement puis pesée (API : pas d'écran du personnel à ce jour) ---
    const admin = await adminApi(request);
    const warehouses = await (await admin.get('/v1/admin/warehouses')).json();
    const warehouse = warehouses.items.find((w: { reference: string }) => w.reference === 'MIA1');
    const received = await admin.post('/v1/admin/packages/receive', { warehouseId: warehouse.id, supplierTracking: supplier });
    expect(received.status()).toBe(200);
    const receivedBody = await received.json();
    expect(receivedBody.match).toEqual({ status: 'MATCHED_AUTO', method: 'SUPPLIER_TRACKING' });
    const packageId = receivedBody.package.id;
    const weighed = await admin.post(`/v1/admin/packages/${packageId}/register`, {
      weight: { value: 2, unit: 'KG' },
      dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
    });
    expect(weighed.status()).toBe(200);

    // --- 5. Le client voit l'avancement, les mesures et des frais PROVISOIRES ------------------
    await page.goto(packageUrl);
    await expect(page.getByText('Enregistré et pesé').first()).toBeVisible();
    await expect(page.getByText('5 kg').first()).toBeVisible();
    await expect(page.getByTestId('package-freight')).toContainText('17,50');
    await expect(page.getByText('Montants provisoires, calculés à la pesée. La facture fait foi.')).toBeVisible();
    const steps = page.getByRole('list', { name: 'Historique' }).getByRole('listitem');
    await expect(steps.first()).toContainText('Enregistré et pesé');
    await expect(steps.last()).toContainText('Préalerte enregistrée');

    // La préalerte n'est plus modifiable ni annulable : le colis est arrivé
    await accountNav(page).getByRole('link', { name: 'Mes préalertes' }).click();
    await expect(page.getByText('Colis reçu')).toBeVisible();
    await expect(page.getByRole('button', { name: /Annuler la préalerte/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Modifier/ })).toHaveCount(0);

    const axeCustomer = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeCustomer.violations.map((v) => v.id)).toEqual([]);

    // --- 6. Suivi public, sans connexion -------------------------------------------------------
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto('/fr/tracking');
    await visitor.getByLabel('Numéro de suivi').fill(trackingNumber);
    await visitor.getByRole('button', { name: 'Suivre le colis' }).click();
    const tracking = visitor.getByTestId('tracking-result');
    await expect(tracking).toBeVisible();
    await expect(tracking.getByText('Enregistré et pesé').first()).toBeVisible();
    const publicText = (await visitor.locator('main').innerText()).toLowerCase();
    for (const secret of [customer.email.toLowerCase(), 'marie jean', supplier.toLowerCase(), 'chaussures', 'boutique de recette', '17,50', 'mia1']) {
      expect(publicText, secret).not.toContain(secret);
    }
    const axePublic = await new AxeBuilder({ page: visitor }).withTags(WCAG).analyze();
    expect(axePublic.violations.map((v) => v.id)).toEqual([]);

    // --- 7. Retenue en douane : le suivi public montre le statut et un motif non sensible ------
    const hold = await admin.post(`/v1/admin/packages/${packageId}/transitions`, { to: 'ON_HOLD', reason: 'Vérification douanière', holdReasonCode: 'CUSTOMS' });
    expect(hold.status()).toBe(200);
    await visitor.getByRole('button', { name: 'Suivre le colis' }).click();
    await expect(visitor.getByTestId('tracking-result').getByText('Retenu').first()).toBeVisible();
    await expect(visitor.getByTestId('tracking-result').getByText('Formalités douanières')).toBeVisible();
    expect(await visitor.locator('main').innerText()).not.toContain('Vérification douanière');
    await visitor.context().close();
  });

  test('modification puis annulation d’une préalerte, en deux temps', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);
    await page.goto('/fr/account/prealerts');
    await page.getByRole('button', { name: 'Déclarer un achat' }).click();
    await page.getByLabel('Boutique ou marchand').fill('Première boutique');
    await page.getByLabel('Montant de l’achat').fill('25');
    await page.getByLabel('Contenu du colis').fill('Livre');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    const item = page.getByTestId('prealert-item').first();
    await expect(item).toContainText('Première boutique');

    await item.getByRole('button', { name: 'Modifier : Première boutique' }).click();
    await page.getByLabel('Boutique ou marchand').fill('Boutique renommée');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Préalerte mise à jour.')).toBeVisible();
    await expect(page.getByTestId('prealert-item').first()).toContainText('Boutique renommée');

    await page.getByRole('button', { name: 'Annuler la préalerte : Boutique renommée' }).click();
    await page.getByRole('button', { name: 'Confirmer l’annulation' }).click();
    await expect(page.getByText('Préalerte annulée.')).toBeVisible();
    await expect(page.getByTestId('prealert-item').first()).toContainText('Annulée');
    await expect(page.getByRole('button', { name: /Annuler la préalerte/ })).toHaveCount(0);
  });

  test('un client ne peut pas ouvrir le colis d’un autre client', async ({ page, request, browser }) => {
    const owner = await registerAndVerify(page, request);
    await loginThroughUi(page, owner);
    await page.goto('/fr/account/prealerts');
    await page.getByRole('button', { name: 'Déclarer un achat' }).click();
    await page.getByLabel('Boutique ou marchand').fill('Boutique privée');
    await page.getByLabel('Montant de l’achat').fill('25');
    await page.getByLabel('Contenu du colis').fill('Cadeau');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByRole('link', { name: 'Voir le colis' }).click();
    await expect(page.getByTestId('package-tracking')).toBeVisible();
    const privateUrl = page.url();

    const otherPage = await (await browser.newContext()).newPage();
    const other = await registerAndVerify(otherPage, request, { firstName: 'Paul', lastName: 'Louis' });
    await loginThroughUi(otherPage, other);
    await otherPage.goto(privateUrl);
    await expect(otherPage.getByText('Colis introuvable.')).toBeVisible();
    await expect(otherPage.getByText('Boutique privée')).toHaveCount(0);
    await otherPage.goto('/fr/account/packages');
    await expect(otherPage.getByText('Aucun colis pour le moment.')).toBeVisible();
    await otherPage.context().close();
  });

  test('créole : libellés des statuts et du suivi traduits', async ({ page }) => {
    await page.goto('/ht/tracking');
    await expect(page.getByRole('heading', { level: 1, name: 'Swivi kolis' })).toBeVisible();
    await expect(page.getByLabel('Nimewo swivi')).toBeVisible();
    await page.getByLabel('Nimewo swivi').fill('EE-ZZZZZ-00000-0');
    await page.getByRole('button', { name: 'Swiv kolis la' }).click();
    await expect(page.getByText('Okenn kolis pa koresponn ak nimewo sa a.')).toBeVisible();
  });
});
