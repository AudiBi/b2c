import AxeBuilder from '@axe-core/playwright';
import { adminLogin, adminNav, adminUrl, expect, strongPassword, test, tokenFromMail, uniqueEmail } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('gestion des accès : rôle personnalisé, invitation, effet immédiat', () => {
  test('l’administrateur crée un rôle, invite une personne avec ce rôle ; elle n’a que ces droits ; modifier le rôle change son menu ; suppression en deux temps', async ({ page, request, browser }) => {
    const roleName = `Contrôle ${Date.now().toString().slice(-6)}`;
    await adminLogin(page);

    // --- 1. Création du rôle par l'interface --------------------------------------------------------------------------------
    await adminNav(page).getByRole('link', { name: 'Rôles et droits', exact: true }).click();
    await page.getByRole('button', { name: 'Créer un rôle' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Créer un rôle' }).click(); // sans nom ni droit : refusé
    await expect(dialog.getByText('Choisissez au moins un droit.')).toBeVisible();
    await dialog.getByLabel('Nom du rôle').fill(roleName);
    await dialog.getByRole('checkbox', { name: /package:read/ }).check();
    const axeEditor = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axeEditor.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' ')}`)).toEqual([]);
    await dialog.getByRole('button', { name: 'Créer un rôle' }).click();
    await expect(page.getByText('Rôle créé.')).toBeVisible();
    const card = page.getByRole('heading', { name: roleName }).locator('xpath=ancestor::li');
    await expect(card).toContainText('1 droits');
    await expect(card).toContainText('Personnalisé');

    // --- 2. Invitation avec ce rôle -----------------------------------------------------------------------------------------
    const email = uniqueEmail();
    await adminNav(page).getByRole('link', { name: 'Utilisateurs', exact: true }).click();
    await page.getByRole('button', { name: /Inviter un membre du personnel/ }).click();
    const invite = page.getByRole('dialog');
    await invite.getByLabel('Prénom').fill('Paul');
    await invite.getByLabel('Nom', { exact: true }).fill('Contrôleur');
    await invite.getByLabel('E-mail').fill(email);
    await invite.getByLabel('Rôle').selectOption({ label: `${roleName} (personnalisé)` });
    await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
    await expect(invite.getByText(`Invitation envoyée à ${email}.`)).toBeVisible();
    await invite.getByRole('button', { name: 'Fermer' }).click();

    // --- 3. La personne active son compte (lien du panel) et ne voit que ce que le rôle permet -------------------------------
    const password = strongPassword();
    const mail = await tokenFromMail(request, email);
    expect(mail.text).toContain(adminUrl('/accept-invite'));
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(adminUrl(`/accept-invite?token=${encodeURIComponent(mail.token)}`));
    await guest.getByLabel('Nouveau mot de passe').fill(password);
    await guest.getByRole('button', { name: 'Activer mon compte' }).click();
    await expect(guest.getByText('Votre compte est activé.')).toBeVisible();
    await adminLogin(guest, { email, password });
    await expect(adminNav(guest).getByRole('link', { name: 'Colis', exact: true })).toBeVisible();
    for (const name of ['Factures', 'Paiements', 'Utilisateurs', 'Rôles et droits', 'Réception']) await expect(adminNav(guest).getByRole('link', { name, exact: true })).toHaveCount(0);
    // l'API refuse aussi ce que le menu ne montre pas
    await guest.goto(adminUrl('/billing'));
    await expect(guest.getByText('Impossible de charger ces informations.')).toBeVisible();

    // --- 4. Modifier le rôle : un droit de plus, effet à la page suivante ------------------------------------------------------
    await adminNav(page).getByRole('link', { name: 'Rôles et droits', exact: true }).click();
    await page.getByRole('heading', { name: roleName }).locator('xpath=ancestor::li').getByRole('button', { name: 'Modifier' }).click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByRole('checkbox', { name: /package:read/ })).toBeChecked();
    await edit.getByRole('checkbox', { name: /invoice:read/ }).check();
    await edit.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/Rôle modifié/)).toBeVisible();
    await guest.reload();
    await expect(adminNav(guest).getByRole('link', { name: 'Factures', exact: true })).toBeVisible();

    // --- 5. Suppression : refusée tant que le rôle est attribué ----------------------------------------------------------------
    const row = page.getByRole('heading', { name: roleName }).locator('xpath=ancestor::li');
    await row.getByRole('button', { name: 'Supprimer' }).click();
    await row.getByRole('button', { name: 'Confirmer' }).click();
    await expect(page.getByText('Ce rôle est encore attribué : retirez-le d’abord aux utilisateurs.')).toBeVisible();

    // retrait du rôle sur la fiche de la personne, puis suppression acceptée
    await adminNav(page).getByRole('link', { name: 'Utilisateurs', exact: true }).click();
    await page.getByLabel(/Rechercher/).fill(email);
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await page.getByRole('link', { name: /Ouvrir : Paul Contrôleur/ }).click();
    await page.getByRole('button', { name: 'Retirer', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(page.getByText('Rôle retiré.')).toBeVisible();
    await guest.reload();
    await expect(adminNav(guest).getByRole('link', { name: 'Colis', exact: true })).toHaveCount(0); // plus aucun droit

    await adminNav(page).getByRole('link', { name: 'Rôles et droits', exact: true }).click();
    const again = page.getByRole('heading', { name: roleName }).locator('xpath=ancestor::li');
    await again.getByRole('button', { name: 'Supprimer' }).click();
    await again.getByRole('button', { name: 'Confirmer' }).click();
    await expect(page.getByText('Rôle supprimé.')).toBeVisible();
    await expect(page.getByRole('heading', { name: roleName })).toHaveCount(0);
    await guest.context().close();
  });
});
