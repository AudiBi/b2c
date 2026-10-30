import AxeBuilder from '@axe-core/playwright';
import { accountNav, expect, loginThroughUi, registerAndVerify, strongPassword, test, tokenFromMail, uniqueEmail } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('parcours client', () => {
  test('inscription → confirmation par e-mail → connexion → code client et adresses de réception', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);

    // Connexion impossible avant confirmation : testé plus bas ; ici on se connecte directement
    await loginThroughUi(page, customer);
    await expect(page).toHaveURL(/\/fr\/account$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Marie' })).toBeVisible();
    const code = (await page.getByTestId('customer-code').textContent())?.trim() ?? '';
    expect(code).toMatch(/^EE-\d{6}$/);

    // Adresses de réception générées à partir du code client, pour les deux modes
    await accountNav(page).getByRole('link', { name: 'Adresses de réception' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mes adresses de réception' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Entrepôt de recette/ })).toBeVisible();
    for (const mode of ['AIR', 'SEA']) {
      const block = page.getByTestId(`receiving-${mode}`);
      await expect(block).toContainText('Marie Jean');
      await expect(block).toContainText(`${code} ${mode}`);
      await expect(block).toContainText('100 Test Avenue');
    }
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test('une page protégée renvoie vers la connexion puis revient à la page demandée', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await page.context().clearCookies();
    await page.goto('/fr/account/addresses');
    await expect(page).toHaveURL(/\/fr\/login\?next=%2Ffr%2Faccount%2Faddresses$/);
    await page.getByLabel('Adresse e-mail').fill(customer.email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(customer.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/fr\/account\/addresses$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mes adresses' })).toBeVisible();
  });

  test('la redirection après connexion refuse une destination externe', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await page.context().clearCookies();
    await loginThroughUi(page, customer, '/fr/login?next=https%3A%2F%2Fpirate.example%2F');
    await expect(page).toHaveURL(/\/fr\/account$/);
  });

  test('connexion : erreurs claires (mauvais mot de passe, e-mail non confirmé, champs vides)', async ({ page, request }) => {
    const unverified = { email: uniqueEmail(), password: strongPassword() };
    await page.goto('/fr/register');
    await page.getByLabel('Prénom').fill('Paul');
    await page.getByLabel('Nom', { exact: true }).fill('Louis');
    await page.getByLabel('Adresse e-mail').fill(unverified.email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(unverified.password);
    await page.getByLabel(/J’ai lu et j’accepte/).check();
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByRole('heading', { name: 'Vérifiez votre boîte de réception' })).toBeVisible();

    await loginThroughUi(page, unverified, '/fr/login', { expectSuccess: false });
    await expect(page.getByRole('alert')).toContainText('pas encore confirmée');
    await page.getByRole('button', { name: 'Renvoyer l’e-mail de confirmation' }).click();
    await expect(page.getByText('un nouvel e-mail vient d’être envoyé')).toBeVisible();
    const second = await tokenFromMail(request, unverified.email, 2);
    expect(second.token.length).toBeGreaterThan(20);

    await page.goto('/fr/login');
    await page.getByLabel('Adresse e-mail').fill('inconnu@example.test');
    await page.getByLabel('Mot de passe', { exact: true }).fill('Mauvais-mot-de-passe-1');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toContainText('Adresse e-mail ou mot de passe incorrect.');

    await page.goto('/fr/login');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Ce champ est obligatoire.').first()).toBeVisible();
    await expect(page.getByLabel('Adresse e-mail')).toHaveAttribute('aria-invalid', 'true');
  });

  test('inscription : validation localisée côté navigateur, sans appel au serveur', async ({ page }) => {
    let calls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/v1/auth/register')) calls += 1;
    });
    await page.goto('/ht/register');
    await page.getByRole('button', { name: 'Kreye kont mwen' }).click();
    await expect(page.getByText('Chan sa a obligatwa.').first()).toBeVisible();
    await expect(page.getByText('Ou dwe aksepte kondisyon yo pou kontinye.')).toBeVisible();
    await page.getByLabel('Adrès imèl').fill('pas-un-email');
    await page.getByLabel('Modpas', { exact: true }).fill('court');
    await page.getByRole('button', { name: 'Kreye kont mwen' }).click();
    await expect(page.getByText('Adrès imèl la pa valid.')).toBeVisible();
    await expect(page.getByText('Omwen 10 karaktè.', { exact: true })).toBeVisible();
    expect(calls).toBe(0);
  });

  test('profil : modification des informations, mise à jour de l’adresse de réception', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);
    await accountNav(page).getByRole('link', { name: 'Mon profil' }).click();
    await page.getByLabel('Prénom').fill('Marie-Claire');
    await page.getByLabel('Téléphone').fill('+50937000000');
    await page.getByLabel('WhatsApp').check();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Prénom')).toHaveValue('Marie-Claire');
    await expect(page.getByLabel('Téléphone')).toHaveValue('+50937000000');
    await expect(page.getByLabel('WhatsApp')).toBeChecked();

    await accountNav(page).getByRole('link', { name: 'Adresses de réception' }).click();
    await expect(page.getByTestId('receiving-AIR')).toContainText('Marie-Claire Jean');

    await accountNav(page).getByRole('link', { name: 'Mon profil' }).click();
    await page.getByLabel('Téléphone').fill('12345');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Format international attendu')).toBeVisible();
  });

  test('adresses : ajout, modification, adresse par défaut, suppression avec confirmation', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);
    await page.goto('/fr/account/addresses');
    await expect(page.getByText('Vous n’avez pas encore d’adresse.')).toBeVisible();

    await page.getByRole('button', { name: 'Ajouter une adresse' }).click();
    await page.getByLabel('Nom de l’adresse').fill('Maison');
    await page.getByLabel('Nom du destinataire').fill('Marie Jean');
    await page.getByLabel('Adresse', { exact: true }).fill('12 rue des Palmistes');
    await page.getByLabel('Ville').fill('Pétion-Ville');
    await page.getByLabel('Pays', { exact: true }).fill('ht');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { name: /Maison/ })).toBeVisible();
    await expect(page.getByText('Par défaut')).toBeVisible();
    await expect(page.getByText('12 rue des Palmistes')).toBeVisible();

    await page.getByRole('button', { name: 'Modifier : Maison' }).click();
    await page.getByLabel('Nom de l’adresse').fill('Domicile');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { name: /Domicile/ })).toBeVisible();

    // Validation serveur et client : pays invalide
    await page.getByRole('button', { name: 'Ajouter une adresse' }).click();
    await page.getByLabel('Pays', { exact: true }).fill('H1');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Code pays à 2 lettres (HT, US…).')).toBeVisible();
    await page.getByRole('button', { name: 'Annuler' }).click();

    // Suppression en deux temps
    await page.getByRole('button', { name: 'Supprimer : Domicile' }).click();
    await page.getByRole('button', { name: 'Confirmer la suppression' }).click();
    await expect(page.getByText('Adresse supprimée.')).toBeVisible();
    await expect(page.getByText('Vous n’avez pas encore d’adresse.')).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test('bénéficiaires : ajout (4 derniers caractères seulement), validité, révocation', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);
    await page.goto('/fr/account/beneficiaries');
    await page.getByRole('button', { name: 'Ajouter un bénéficiaire' }).click();
    await page.getByLabel('Nom complet').fill('Jean Baptiste');
    await page.getByLabel('Type de pièce').selectOption('NATIONAL_ID');
    const last4 = page.getByLabel('4 derniers caractères de la pièce');
    await expect(last4).toHaveAttribute('maxlength', '4');
    await last4.fill('4821');
    await page.getByLabel('Valable à partir du').fill('2026-06-01');
    await page.getByLabel('Valable jusqu’au').fill('2026-01-01');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('La fin de validité précède le début.')).toBeVisible();
    await page.getByLabel('Valable jusqu’au').fill('2026-12-31');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { name: 'Jean Baptiste' })).toBeVisible();
    await expect(page.getByText('Carte d’identité …4821')).toBeVisible();

    await page.getByRole('button', { name: 'Révoquer : Jean Baptiste' }).click();
    await page.getByRole('button', { name: 'Confirmer la suppression' }).click();
    await expect(page.getByText('Bénéficiaire révoqué.')).toBeVisible();
    await expect(page.getByText('Aucun bénéficiaire pour le moment.')).toBeVisible();
  });

  test('sécurité : changement de mot de passe, puis connexion avec le nouveau', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);
    await page.goto('/fr/account/security');
    await page.getByLabel('Mot de passe actuel').fill('mauvais-mot-de-passe');
    await page.getByLabel('Nouveau mot de passe').fill(strongPassword());
    await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
    await expect(page.getByRole('alert')).toContainText('Le mot de passe actuel est incorrect.');

    const next = strongPassword();
    await page.getByLabel('Mot de passe actuel').fill(customer.password);
    await page.getByLabel('Nouveau mot de passe').fill(next);
    await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
    await expect(page.getByText('Mot de passe modifié.')).toBeVisible();

    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/fr\/?$/);
    await loginThroughUi(page, { email: customer.email, password: next });
    await expect(page).toHaveURL(/\/fr\/account$/);
  });

  test('la session survit au rechargement (cookie de renouvellement) et la déconnexion est effective', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await loginThroughUi(page, customer);
    await expect(page).toHaveURL(/\/fr\/account$/);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Marie' })).toBeVisible();

    // Le jeton d'accès n'est jamais dans le stockage du navigateur
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toMatch(/eyJ/);
    const cookies = await page.context().cookies();
    const refresh = cookies.find((cookie) => cookie.name === 'b2c_refresh');
    expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/v1/auth' });

    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.goto('/fr/account');
    await expect(page).toHaveURL(/\/fr\/login\?next=/);
  });

  test('mot de passe oublié : lien reçu par e-mail, nouveau mot de passe, ancien refusé', async ({ page, request }) => {
    const customer = await registerAndVerify(page, request);
    await page.goto('/fr/forgot-password');
    await page.getByLabel('Adresse e-mail').fill(customer.email);
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await expect(page.getByText('Si un compte existe pour cette adresse')).toBeVisible();

    const mail = await tokenFromMail(request, customer.email, 2);
    expect(mail.subject).toContain('réinitialisation');
    const next = strongPassword();
    await page.goto(`/fr/reset-password?token=${encodeURIComponent(mail.token)}`);
    await page.getByLabel('Nouveau mot de passe').fill(next);
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
    await expect(page.getByText('Votre mot de passe est enregistré.')).toBeVisible();

    await loginThroughUi(page, customer, '/fr/login', { expectSuccess: false });
    await expect(page.getByRole('alert')).toContainText('incorrect');
    await loginThroughUi(page, { email: customer.email, password: next });
    await expect(page).toHaveURL(/\/fr\/account$/);

    // Le lien ne sert qu'une fois
    await page.goto(`/fr/reset-password?token=${encodeURIComponent(mail.token)}`);
    await page.getByLabel('Nouveau mot de passe').fill(strongPassword());
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
    await expect(page.getByRole('alert')).toContainText('invalide ou a expiré');
  });

  test('lien de confirmation invalide ou absent : message clair', async ({ page }) => {
    await page.goto('/fr/verify-email?token=nimportequoi');
    await expect(page.getByText('Ce lien est invalide ou a expiré.')).toBeVisible();
    await page.goto('/fr/reset-password');
    await expect(page.getByText('Le lien est incomplet.')).toBeVisible();
  });

  test('inscription en créole : e-mail de confirmation en créole, lien vers la bonne langue', async ({ page, request }) => {
    const email = uniqueEmail();
    await page.goto('/ht/register');
    await page.getByLabel('Prenom').fill('Marie');
    await page.getByLabel('Non', { exact: true }).fill('Jean');
    await page.getByLabel('Adrès imèl').fill(email);
    await page.getByLabel('Modpas', { exact: true }).fill(strongPassword());
    await page.getByLabel(/Mwen li epi mwen aksepte/).check();
    await page.getByRole('button', { name: 'Kreye kont mwen' }).click();
    await expect(page.getByRole('heading', { name: 'Gade bwat resepsyon ou' })).toBeVisible();
    const mail = await tokenFromMail(request, email);
    expect(mail.subject).toContain('konfime');
    expect(mail.text).toContain('/ht/verify-email?token=');
  });
});
