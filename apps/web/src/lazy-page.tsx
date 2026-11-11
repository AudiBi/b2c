import { createElement, use, type ComponentType } from 'react';

/**
 * Page chargée à la demande, SANS décalage entre le HTML pré-rendu et l'hydratation : le module est préchargé (preload) avant
 * le rendu serveur et avant l'hydratation de la page demandée ; seule une navigation dans le navigateur vers une autre page
 * passe par la frontière <Suspense> pendant le téléchargement.
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const preload = (): Promise<void> => (pending ??= load().then((component) => void (loaded = component)));
  function Page(props: P) {
    if (!loaded) use(preload());
    return createElement(loaded as ComponentType<P>, props);
  }
  Page.preload = preload;
  return Page;
}
