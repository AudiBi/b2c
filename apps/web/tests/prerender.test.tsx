import { describe, expect, it } from 'vitest';
import { prerenderTargets, render } from '../src/entry-server';
import { catalogs } from '../src/i18n';

describe('rendu serveur de toutes les pages', () => {
  it('produit 63 pages : 17 publiques + 4 utilitaires, dans 3 langues', () => {
    expect(prerenderTargets).toHaveLength(21 * 3);
    expect(prerenderTargets.filter((t) => t.index)).toHaveLength(17 * 3);
  });

  it.each(prerenderTargets.map((t) => [`/${t.lang}${t.path}`, t] as const))('%s : un seul h1, un titre, aucune valeur « undefined »', (url, target) => {
    const { html, head } = render(url);
    expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
    expect(head.title).toMatch(/B2C/);
    expect(head.description?.length).toBeGreaterThan(20);
    expect(html).not.toMatch(/undefined|\[object Object\]|NaN/);
    expect(html).toContain('<main');
    expect(html).toContain(catalogs[target.lang].a11y.skip);
  });

  it.each(['/fr', '/ht/services', '/en/faq'])('%s : le logo B2C est dans l’en-tête et le pied de page, le nom de la marque reste accessible', (url) => {
    const { html } = render(url);
    expect(html).toContain('src="/logo-mark.svg"');
    expect(html).toContain('src="/logo.svg"');
    // images décoratives (alt vide) : le nom de la marque est porté par un texte réservé aux lecteurs d'écran dans le lien d'accueil
    expect(html).toMatch(/<a [^>]*class="brand"[^>]*>[\s\S]*?<img [^>]*alt=""[\s\S]*?<span class="sr-only">B2C<\/span>/);
    // dimensions déclarées : pas de saut de mise en page au chargement
    expect(html).toMatch(/<img [^>]*src="\/logo-mark.svg"[^>]*width="\d+"[^>]*height="48"/);
  });

  it('une page inexistante rend la page « introuvable » dans la langue demandée', () => {
    expect(render('/en/nope').html).toContain(catalogs.en.notFound.title);
    expect(render('/zz/nope').html).toContain(catalogs.fr.notFound.title);
  });

  it('les liens internes d’une page pointent vers la même langue', () => {
    const { html } = render('/ht/services');
    const hrefs = [...html.matchAll(/<a [^>]*href="(\/[^"]*)"/g)].map((m) => m[1]);
    const internal = hrefs.filter((href) => !href.startsWith('#'));
    expect(internal.length).toBeGreaterThan(10);
    // Seul le sélecteur de langue pointe vers les autres langues
    const foreign = internal.filter((href) => !href.startsWith('/ht'));
    expect(foreign.sort()).toEqual(['/en/services', '/fr/services']);
  });
});
