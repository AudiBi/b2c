import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { localized } from '../../routes';
import { usePageMeta } from '../../seo';
import { LocNavLink } from '../../components/LocLink';
import { useUnreadCount } from '../finance/queries';
import { StaffNotice } from './StaffNotice';

/** Zone réservée : redirige vers la connexion sans session, puis revient à la page demandée. */
export function AccountLayout() {
  const { m, lang } = useI18n();
  const { status, user, loggedOut } = useAuth();
  const location = useLocation();
  usePageMeta('account');
  // Les hooks passent avant tout retour anticipé
  const can = (permission: string) => !!user?.permissions.includes(permission);
  const unread = useUnreadCount(status === 'authenticated' && user?.kind === 'CUSTOMER' && can('notification:read_own')).data ?? 0;

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


  // Le personnel et la plateforme travaillent dans le panel d'administration, pas sur le site
  if (user && user.kind !== 'CUSTOMER') return <StaffNotice />;

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
                {can('prealert:read_own') ? (
                  <li>
                    <LocNavLink page="accountPrealerts">{m.account.nav.prealerts}</LocNavLink>
                  </li>
                ) : null}
                {can('package:read_own') ? (
                  <li>
                    <LocNavLink page="accountPackages">{m.account.nav.packages}</LocNavLink>
                  </li>
                ) : null}
                {can('invoice:read_own') ? (
                  <li>
                    <LocNavLink page="accountInvoices">{m.account.nav.invoices}</LocNavLink>
                  </li>
                ) : null}
                {can('notification:read_own') ? (
                  <li>
                    <LocNavLink page="accountNotifications">
                      {m.account.nav.notifications}
                      {unread > 0 ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>{unread}</span> : null}
                    </LocNavLink>
                  </li>
                ) : null}
                {can('claim:read_own') ? (
                  <li>
                    <LocNavLink page="accountClaims">{m.account.nav.claims}</LocNavLink>
                  </li>
                ) : null}
                {can('profile:read_own') ? (
                  <li>
                    <LocNavLink page="accountReceiving">{m.account.nav.receiving}</LocNavLink>
                  </li>
                ) : null}
                {can('profile:read_own') ? (
                  <li>
                    <LocNavLink page="accountAddresses">{m.account.nav.addresses}</LocNavLink>
                  </li>
                ) : null}
                {can('profile:read_own') ? (
                  <li>
                    <LocNavLink page="accountBeneficiaries">{m.account.nav.beneficiaries}</LocNavLink>
                  </li>
                ) : null}
                {can('team:manage_own') ? (
                  <li>
                    <LocNavLink page="accountTeam">{m.account.nav.team}</LocNavLink>
                  </li>
                ) : null}
                {can('profile:read_own') ? (
                  <li>
                    <LocNavLink page="accountProfile">{m.account.nav.profile}</LocNavLink>
                  </li>
                ) : null}
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
