import { Link, useLocation } from 'react-router';
import { LANGS, rememberLang, useI18n } from '../../i18n';

export function LanguageSwitcher() {
  const { lang, m } = useI18n();
  const location = useLocation();
  // /fr/services/air?x=1 → /en/services/air?x=1
  const rest = location.pathname.replace(/^\/[^/]+/, '');
  return (
    <div className="lang-switcher" role="group" aria-label={m.a11y.languageSwitcher}>
      {LANGS.map((code) => (
        <Link
          key={code}
          to={`/${code}${rest}${location.search}`}
          lang={code}
          hrefLang={code}
          aria-current={code === lang ? 'true' : undefined}
          onClick={() => rememberLang(code)}
        >
          {code.toUpperCase()}
          <span className="sr-only"> : {m.lang[code]}</span>
        </Link>
      ))}
    </div>
  );
}
