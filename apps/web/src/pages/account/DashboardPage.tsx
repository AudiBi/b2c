import { useAuth } from '../../auth/AuthProvider';
import { format, useI18n } from '../../i18n';
import type { PageKey } from '../../routes';
import { LocLink } from '../../components/LocLink';
import { Alert } from '../../components/ui/Alert';
import { useProfile } from './queries';

const cardPages: Record<string, PageKey> = {
  prealerts: 'accountPrealerts',
  packages: 'accountPackages',
  receiving: 'accountReceiving',
  addresses: 'accountAddresses',
  beneficiaries: 'accountBeneficiaries',
  team: 'accountTeam',
  profile: 'accountProfile',
};

/** Droit nécessaire pour voir chaque carte : un membre d'équipe n'en voit qu'une partie. */
const cardPermission: Record<string, string> = {
  prealerts: 'prealert:read_own',
  packages: 'package:read_own',
  receiving: 'profile:read_own',
  addresses: 'profile:read_own',
  beneficiaries: 'profile:read_own',
  team: 'team:manage_own',
  profile: 'profile:read_own',
};

export function DashboardPage() {
  const { m } = useI18n();
  const d = m.account.dashboard;
  const { user } = useAuth();
  const isCustomer = user?.kind === 'CUSTOMER';
  const canProfile = !!user?.permissions.includes('profile:read_own');
  const profile = useProfile(isCustomer && canProfile);
  const name = user ? user.firstName : '';

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{format(d.title, { name })}</h1>
      {user && !user.emailVerified ? <Alert tone="warning">{d.emailNotVerified}</Alert> : null}

      {isCustomer ? (
        <>
          {canProfile ? (
          <div className="card">
            <h2 style={{ fontSize: '1.1rem' }}>{d.customerCode}</h2>
            {profile.isPending ? <p role="status">{m.common.loading}</p> : null}
            {profile.isError ? <Alert tone="warning">{m.common.errorLoad}</Alert> : null}
            {profile.data?.customer ? (
              <>
                <p>
                  <span className="code-badge" data-testid="customer-code">
                    {profile.data.customer.customerCode}
                  </span>
                </p>
                <p className="muted">{d.customerCodeHint}</p>
              </>
            ) : null}
          </div>
          ) : null}
          <div className="grid grid-2">
            {d.cards.filter((card) => user?.permissions.includes(cardPermission[card.key])).map((card) => (
              <LocLink key={card.key} page={cardPages[card.key]} className="card card-link">
                <h2 style={{ fontSize: '1.15rem' }}>{card.title}</h2>
                <p>{card.text}</p>
              </LocLink>
            ))}
          </div>
          <Alert tone="info" title={d.soonTitle}>
            {d.soon}
          </Alert>
        </>
      ) : (
        <>
          <Alert tone="info" title={d.staffTitle}>
            {d.staff}
          </Alert>
          {user ? (
            <div className="card">
              <h2 style={{ fontSize: '1.1rem' }}>{d.roles}</h2>
              <ul>
                {user.roles.map((role) => (
                  <li key={role.userRoleId}>
                    {role.roleCode}
                    {role.scopeType !== 'COMPANY' ? ` (${role.scopeType})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
