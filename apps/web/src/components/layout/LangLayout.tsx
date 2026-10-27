import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useParams } from 'react-router';
import { I18nProvider, isLang, useI18n } from '../../i18n';
import { NotFoundPage } from '../../pages/NotFoundPage';
import { Footer } from './Footer';
import { Header } from './Header';

function Shell() {
  const { m, lang } = useI18n();
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const lastPath = useRef(location.pathname);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Navigation côté navigateur : le focus passe au contenu et la page revient en haut.
  // On compare au dernier chemin (et non à un « premier rendu ») : React rejoue les effets au montage.
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#main">
        {m.a11y.skip}
      </a>
      <Header />
      <main id="main" ref={main} tabIndex={-1} style={{ outline: 'none' }}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

/** Valide le préfixe de langue de l'URL, fournit les textes et la structure commune des pages. */
export function LangLayout() {
  const { lang } = useParams();
  if (!isLang(lang)) return <NotFoundPage />;
  return (
    <I18nProvider lang={lang}>
      <Shell />
    </I18nProvider>
  );
}
