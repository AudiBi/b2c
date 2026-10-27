import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { config } from '../../config';
import { useI18n } from '../../i18n';
import { localized } from '../../routes';
import { LocLink, LocNavLink } from '../LocLink';
import { ButtonLink } from '../ui/Button';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Header() {
  const { m, lang } = useI18n();
  const { status, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Le menu mobile se ferme à chaque changement de page
  useEffect(() => setOpen(false), [location.pathname]);

  const signedIn = status === 'authenticated';

  return (
    <header className="site-header">
      <div className="container header-bar">
        <LocLink page="home" className="brand">
          <LogoMark />
          <span>{config.brandName}</span>
        </LocLink>
        <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'close' : 'menu'} width={22} height={22} />
          <span>{open ? m.a11y.closeMenu : m.a11y.openMenu}</span>
        </button>
        <nav id="site-nav" className={`site-nav${open ? ' open' : ''}`} aria-label={m.a11y.mainNav}>
          <ul className="nav-list">
            <li>
              <LocNavLink page="home" end className="nav-link">
                {m.nav.home}
              </LocNavLink>
            </li>
            <li className="has-submenu">
              <LocNavLink page="services" end className="nav-link">
                {m.nav.services}
              </LocNavLink>
              <ul className="submenu">
                {(['air', 'sea', 'international', 'local'] as const).map((key) => (
                  <li key={key}>
                    <LocNavLink page={key} className="nav-link">
                      {m.nav[key]}
                    </LocNavLink>
                  </li>
                ))}
              </ul>
            </li>
            <li>
              <LocNavLink page="howItWorks" className="nav-link">
                {m.nav.howItWorks}
              </LocNavLink>
            </li>
            <li>
              <LocNavLink page="calculator" className="nav-link">
                {m.nav.calculator}
              </LocNavLink>
            </li>
            <li>
              <LocNavLink page="tracking" className="nav-link">
                {m.nav.tracking}
              </LocNavLink>
            </li>
            <li>
              <LocNavLink page="locations" className="nav-link">
                {m.nav.locations}
              </LocNavLink>
            </li>
            <li>
              <LocNavLink page="faq" className="nav-link">
                {m.nav.faq}
              </LocNavLink>
            </li>
            <li>
              <LocNavLink page="contact" className="nav-link">
                {m.nav.contact}
              </LocNavLink>
            </li>
          </ul>
          <div className="nav-actions">
            <LanguageSwitcher />
            {signedIn ? (
              <>
                <ButtonLink page="account" variant="outline" size="sm">
                  {m.nav.account}
                </ButtonLink>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await logout();
                    navigate(localized(lang, 'home'));
                  }}
                >
                  {m.nav.logout}
                </Button>
              </>
            ) : (
              <>
                <ButtonLink page="login" variant="outline" size="sm">
                  {m.nav.login}
                </ButtonLink>
                <ButtonLink page="register" variant="primary" size="sm">
                  {m.nav.register}
                </ButtonLink>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
