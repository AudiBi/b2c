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
  profile: 'accountProfile',
};

export function DashboardPage() {
  const { m } = useI18n();
  const d = m.account.dashboard;
  const { user } = useAuth();
  const isCustomer = user?.kind === 'CUSTOMER';
  const profile = useProfile();
  const name = user ? user.firstName : '';

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{format(d.title, { name })}</h1>
      {user && !user.emailVerified ? <Alert tone="warning">{d.emailNotVerified}</Alert> : null}

      {isCustomer ? (
        <>
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
          <div className="grid grid-2">
            {d.cards.map((card) => (
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
