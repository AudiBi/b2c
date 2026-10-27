import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { localized } from '../../routes';
import { usePageMeta } from '../../seo';
import { LocNavLink } from '../../components/LocLink';

/** Zone réservée : redirige vers la connexion sans session, puis revient à la page demandée. */
export function AccountLayout() {
  const { m, lang } = useI18n();
  const { status, user, loggedOut } = useAuth();
  const location = useLocation();
  usePageMeta('account');

  if (status === 'loading') {
    return (
      <div className="container section">
        <p role="status">{m.common.loading}</p>
      </div>
    );
  }
  if (status === 'anonymous') {
    // Déconnexion volontaire depuis l'espace client : retour à l'accueil (sans course avec la navigation du bouton)
    if (loggedOut) return <Navigate to={localized(lang, 'home')} replace />;
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`${localized(lang, 'login')}?next=${next}`} replace />;
  }

  const isCustomer = user?.kind === 'CUSTOMER';
  return (
    <div className="container">
      <div className="account-layout">
        <nav className="account-nav" aria-label={m.a11y.accountNav}>
          <ul>
            <li>
              <LocNavLink page="account" end>
                {m.account.nav.dashboard}
              </LocNavLink>
            </li>
            {isCustomer ? (
              <>
                <li>
                  <LocNavLink page="accountPrealerts">{m.account.nav.prealerts}</LocNavLink>
                </li>
                <li>
                  <LocNavLink page="accountPackages">{m.account.nav.packages}</LocNavLink>
                </li>
                <li>
                  <LocNavLink page="accountReceiving">{m.account.nav.receiving}</LocNavLink>
                </li>
                <li>
                  <LocNavLink page="accountAddresses">{m.account.nav.addresses}</LocNavLink>
                </li>
                <li>
                  <LocNavLink page="accountBeneficiaries">{m.account.nav.beneficiaries}</LocNavLink>
                </li>
                <li>
                  <LocNavLink page="accountProfile">{m.account.nav.profile}</LocNavLink>
                </li>
              </>
            ) : null}
            <li>
              <LocNavLink page="accountSecurity">{m.account.nav.security}</LocNavLink>
            </li>
          </ul>
        </nav>
        <div className="stack" style={{ minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
