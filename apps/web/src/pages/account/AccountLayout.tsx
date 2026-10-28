import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { localized } from '../../routes';
import { usePageMeta } from '../../seo';
import { LocNavLink } from '../../components/LocLink';
import { useUnreadCount } from '../finance/queries';

/** Zone réservée : redirige vers la connexion sans session, puis revient à la page demandée. */
export function AccountLayout() {
  const { m, lang } = useI18n();
  const { status, user, loggedOut } = useAuth();
  const location = useLocation();
  usePageMeta('account');
  // Les hooks passent avant tout retour anticipé
  const unread = useUnreadCount(status === 'authenticated' && user?.kind === 'CUSTOMER').data ?? 0;

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

  // Double authentification obligatoire et pas encore activée : seule la page Sécurité (où on l'active) reste ouverte
  if (user?.mfa?.enrollmentRequired && !location.pathname.endsWith('/account/security')) {
    return <Navigate to={localized(lang, 'accountSecurity')} replace />;
  }

  const isCustomer = user?.kind === 'CUSTOMER';
  const can = (permission: string) => !!user?.permissions.includes(permission);
  const isStaff = user?.kind === 'STAFF';
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
                  <LocNavLink page="accountInvoices">{m.account.nav.invoices}</LocNavLink>
                </li>
                <li>
                  <LocNavLink page="accountNotifications">
                    {m.account.nav.notifications}
                    {unread > 0 ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>{unread}</span> : null}
                  </LocNavLink>
                </li>
                <li>
                  <LocNavLink page="accountClaims">{m.account.nav.claims}</LocNavLink>
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
            {isStaff && can('package:receive') ? (
              <li>
                <LocNavLink page="accountStaffReception">{m.staff.nav.reception}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('package:read') ? (
              <li>
                <LocNavLink page="accountStaffPackages">{m.staff.nav.packages}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('warehouse:read') ? (
              <li>
                <LocNavLink page="accountStaffWarehouse">{m.staff.nav.warehouse}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('shipment:read') ? (
              <li>
                <LocNavLink page="accountStaffShipments">{m.staff.nav.shipments}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('agency:receive') ? (
              <li>
                <LocNavLink page="accountStaffAgency">{m.staff.nav.agency}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('report:read') ? (
              <li>
                <LocNavLink page="accountStaffDashboard">{m.staff.nav.dashboard}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('delivery:read') ? (
              <li>
                <LocNavLink page="accountStaffRoutes">{m.staff.nav.routes}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('delivery:read_assigned') ? (
              <li>
                <LocNavLink page="accountStaffMyRoutes">{m.staff.nav.myRoutes}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('claim:read') ? (
              <li>
                <LocNavLink page="accountStaffClaims">{m.staff.nav.claims}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('invoice:read') ? (
              <li>
                <LocNavLink page="accountStaffBilling">{m.staff.nav.billing}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('payment:read') ? (
              <li>
                <LocNavLink page="accountStaffPayments">{m.staff.nav.payments}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('notification:read') ? (
              <li>
                <LocNavLink page="accountStaffNotifications">{m.staff.nav.notifications}</LocNavLink>
              </li>
            ) : null}
            {isStaff && can('audit:read') ? (
              <li>
                <LocNavLink page="accountStaffAudit">{m.staff.nav.audit}</LocNavLink>
              </li>
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
