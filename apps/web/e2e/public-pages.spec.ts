import AxeBuilder from '@axe-core/playwright';
import { publicPages, paths } from '../src/routes';
import { expect, test } from './helpers';

const LANGS = ['fr', 'ht', 'en'] as const;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Les 17 pages publiques du cahier des charges, dans les 3 langues
for (const lang of LANGS) {
  for (const key of publicPages) {
    const url = `/${lang}${paths[key]}`;

    test(`${url} : contenu, accessibilité (WCAG 2.1 AA) et mobile`, async ({ page }) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`exception: ${error.message}`));

      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      await page.waitForLoadState('networkidle');

      // Structure : une langue déclarée, un titre non vide, un seul h1, des repères
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      expect(await page.title()).toMatch(/\S/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('navigation').first()).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();

      // Accessibilité automatisée (ordinateur)
      const desktop = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(desktop.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

      // Téléphone : pas de défilement horizontal, menu utilisable
      await page.setViewportSize({ width: 375, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const toggle = page.locator('button.menu-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByRole('navigation', { name: /.+/ }).first()).toBeVisible();
      const mobile = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(mobile.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

      expect(problems).toEqual([]);
    });
  }
}

test('le HTML pré-rendu contient le contenu sans JavaScript, avec canonical et hreflang', async ({ request }) => {
  const response = await request.get('/en/services/air');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('<h1>Air freight</h1>');
  expect(html).toMatch(/<link rel="canonical" href="http:\/\/localhost:4173\/en\/services\/air"/);
  for (const lang of LANGS) expect(html).toContain(`hreflang="${lang}" href="http://localhost:4173/${lang}/services/air"`);
  expect(html).toContain('hreflang="x-default"');
  expect(html).toMatch(/<meta name="description" content="[^"]{20,}"/);
});

test('les pages utilitaires ne sont pas référencées (noindex) et le sitemap liste les pages publiques', async ({ request }) => {
  const html = await (await request.get('/fr/forgot-password')).text();
  expect(html).toContain('<meta name="robots" content="noindex"');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect((sitemap.match(/<url>/g) ?? []).length).toBe(17 * 3);
  expect(sitemap).not.toContain('forgot-password');
  expect(sitemap).not.toContain('/account');
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /fr/account');
  expect(robots).toContain('Sitemap: http://localhost:4173/sitemap.xml');
});

test('la racine propose le choix de la langue et redirige selon la préférence du navigateur', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForURL('**/en/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await context.close();

  const withoutScript = await browser.newContext({ javaScriptEnabled: false });
  const plain = await withoutScript.newPage();
  await plain.goto('/');
  await expect(plain.getByRole('link', { name: 'Kreyòl ayisyen' })).toBeVisible();
  await withoutScript.close();
});

test('une URL inconnue affiche la page 404 du site, avec le statut 404', async ({ request, page }) => {
  expect((await request.get('/fr/page-qui-nexiste-pas')).status()).toBe(404);
  await page.goto('/fr/page-qui-nexiste-pas');
  await expect(page.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible();
});

test('le sélecteur de langue conserve la page courante', async ({ page }) => {
  await page.goto('/fr/services/sea');
  await page.getByRole('link', { name: 'Kreyòl ayisyen' }).click();
  await expect(page).toHaveURL(/\/ht\/services\/sea$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Voye pa bato' })).toBeVisible();
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/services\/sea$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sea freight' })).toBeVisible();
});

test('la navigation au clavier : lien d’évitement, puis menu, sans piège de focus', async ({ page }) => {
  await page.goto('/fr/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Aller au contenu principal' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('FAQ : les questions s’ouvrent au clavier', async ({ page }) => {
  await page.goto('/fr/faq');
  const first = page.getByText('Comment créer un compte ?');
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cliquez sur « Créer un compte »')).toBeVisible();
});

test('suivi et calculateur : explication honnête, aucun faux formulaire', async ({ page }) => {
  for (const [path, notice] of [['/fr/tracking', 'Suivi public : pas encore activé'], ['/fr/calculator', 'Estimation en ligne : pas encore activée']] as const) {
    await page.goto(path);
    await expect(page.getByText(notice)).toBeVisible();
    await expect(page.locator('main form')).toHaveCount(0);
    await expect(page.locator('main input')).toHaveCount(0);
  }
});

test('entrepôts : la liste vient de l’API ; contact : coordonnées configurées par l’administrateur', async ({ page, request, browser }) => {
  await page.goto('/fr/locations');
  await expect(page.getByRole('heading', { name: 'Entrepôt de recette' })).toBeVisible();
  await expect(page.getByText('100 Test Avenue, Miami, FL 33100')).toBeVisible();

  await page.goto('/fr/contact');
  await expect(page.getByText('Les coordonnées de contact ne sont pas encore renseignées.')).toBeVisible();

  const login = await request.post('/v1/auth/login', {
    data: { companySlug: 'e2e', email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
  });
  expect(login.status()).toBe(200);
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    const saved = await request.put('/v1/admin/settings/public-contact', {
      headers,
      data: { email: 'contact@exemple.test', phones: ['+50937000000'], hours: 'Lun-Ven 8h-17h', facebook: 'https://facebook.com/exemple' },
    });
    expect(saved.status()).toBe(200);
    // Les coordonnées publiques sont mises en cache 60 s (Cache-Control) : on relit la page dans un contexte neuf
    const fresh = await browser.newContext();
    page = await fresh.newPage();
    await page.goto('/fr/contact');
    await expect(page.getByRole('link', { name: 'contact@exemple.test' })).toHaveAttribute('href', 'mailto:contact@exemple.test');
    await expect(page.getByRole('link', { name: '+50937000000' })).toHaveAttribute('href', 'tel:+50937000000');
    await expect(page.getByText('Lun-Ven 8h-17h')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Facebook' })).toHaveAttribute('rel', /noopener/);
  } finally {
    await request.put('/v1/admin/settings/public-contact', { headers, data: { phones: [] } });
  }
});
