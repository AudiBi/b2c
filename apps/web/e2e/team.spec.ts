import AxeBuilder from '@axe-core/playwright';
import { accountNav, expect, loginThroughUi, strongPassword, test, tokenFromMail, uniqueEmail } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('équipe d’un compte professionnel', () => {
  test('le propriétaire invite un lecteur, qui active son compte, voit un menu réduit, puis perd son accès au retrait', async ({ page, request, browser }) => {
    // Compte professionnel (inscription par l'API : la recette de l'inscription existe ailleurs)
    const owner = { email: uniqueEmail(), password: strongPassword() };
    const registered = await request.post('/v1/auth/register', {
      headers: { 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` },
      data: { companySlug: 'e2e', accountType: 'BUSINESS', businessName: 'Ets Recette', email: owner.email, password: owner.password, firstName: 'Paul', lastName: 'Chef', acceptTerms: true },
    });
    expect(registered.status()).toBe(202);
    await page.goto(`/fr/verify-email?token=${encodeURIComponent((await tokenFromMail(request, owner.email)).token)}`);
    await expect(page.getByText('Votre adresse e-mail est confirmée.')).toBeVisible();

    // Le propriétaire voit l'entrée « Mon équipe » et invite un lecteur
    await loginThroughUi(page, owner);
    await accountNav(page).getByRole('link', { name: 'Mon équipe' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mon équipe' })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    const member = { email: uniqueEmail(), password: strongPassword() };
    await page.getByRole('button', { name: 'Inviter un membre' }).click();
    await page.getByLabel('Prénom').fill('Anne');
    await page.getByLabel('Nom', { exact: true }).fill('Membre');
    await page.getByLabel('Adresse e-mail').fill(member.email);
    await page.getByRole('button', { name: 'Envoyer l’invitation' }).click();
    await expect(page.getByText('Invitation envoyée.')).toBeVisible();
    await expect(page.getByText(member.email, { exact: true })).toBeVisible();

    // Le membre active son compte depuis le lien reçu, sur le site
    const mail = await tokenFromMail(request, member.email);
    expect(mail.text).toContain('/fr/accept-invite?token=');
    const memberContext = await browser.newContext({ baseURL: page.url().split('/fr/')[0] });
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/fr/accept-invite?token=${encodeURIComponent(mail.token)}`);
    await memberPage.getByLabel('Nouveau mot de passe').fill(member.password);
    await memberPage.getByRole('button', { name: 'Activer mon compte' }).click();
    await expect(memberPage.getByText('Votre compte est activé.')).toBeVisible();

    // Menu réduit : colis et factures, mais ni profil, ni adresses, ni équipe
    await loginThroughUi(memberPage, member);
    const nav = accountNav(memberPage);
    await expect(nav.getByRole('link', { name: 'Mes colis' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Mes factures' })).toBeVisible();
    for (const hidden of ['Mon profil', 'Mes adresses', 'Bénéficiaires', 'Mon équipe']) {
      await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
    }
    await memberPage.goto('/fr/account/team');
    await expect(memberPage.getByText('L’équipe est réservée aux comptes professionnels.')).toBeVisible();

    // Le propriétaire retire le membre : accès coupé tout de suite
    await page.getByRole('button', { name: /^Retirer : Anne Membre/ }).click();
    await page.getByRole('button', { name: 'Confirmer le retrait' }).click();
    await expect(page.getByText('Membre retiré : son accès est coupé immédiatement.')).toBeVisible();
    await memberPage.goto('/fr/account/packages');
    await expect(memberPage).toHaveURL(/\/fr\/login/);
    await memberContext.close();
  });
});
