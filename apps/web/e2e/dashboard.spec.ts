import AxeBuilder from '@axe-core/playwright';
import { expect, loginThroughUi, registerAndVerify, test } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('tableau de bord client', () => {
  for (const viewport of [
    { name: 'ordinateur', width: 1280, height: 900 },
    { name: 'téléphone', width: 390, height: 844 },
  ]) {
    test(`bandeau, chiffres, derniers colis et adresse de réception, sans défaut d’accessibilité (${viewport.name})`, async ({ page, request }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const customer = await registerAndVerify(page, request);
      await loginThroughUi(page, customer);

      await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Marie' })).toBeVisible();
      await expect(page.getByTestId('customer-code')).toHaveText(/^EE-\d{6}$/);
      await expect(page.getByText('Colis en cours')).toBeVisible();
      await expect(page.getByText('Factures à payer')).toBeVisible();
      await expect(page.getByText('Aucun colis pour le moment. Déclarez un achat pour commencer.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Mon adresse de réception' })).toBeVisible();

      // pas de défilement horizontal de la page
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`tableau-de-bord-${viewport.width}.png`), fullPage: true });
      const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(axe.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
