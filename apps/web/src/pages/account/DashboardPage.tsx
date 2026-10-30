import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { localized, type PageKey } from '../../routes';
import { LocLink } from '../../components/LocLink';
import { StatusBadge } from '../../components/PackageParts';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink } from '../../components/ui/Button';
import { useMyInvoices, useUnreadCount } from '../finance/queries';
import { usePackages, useProfile, useReceiving } from './queries';

const cardPages: Record<string, PageKey> = {
  prealerts: 'accountPrealerts',
  packages: 'accountPackages',
  receiving: 'accountReceiving',
  addresses: 'accountAddresses',
  beneficiaries: 'accountBeneficiaries',
  team: 'accountTeam',
  profile: 'accountProfile',
};

/** Droit nécessaire pour voir chaque raccourci : un membre d'équipe n'en voit qu'une partie. */
const cardPermission: Record<string, string> = {
  prealerts: 'prealert:read_own',
  packages: 'package:read_own',
  receiving: 'profile:read_own',
  addresses: 'profile:read_own',
  beneficiaries: 'profile:read_own',
  team: 'team:manage_own',
  profile: 'profile:read_own',
};

const FINISHED = ['DELIVERED', 'RETURNED', 'CANCELLED'];
const TO_COLLECT = ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];

function CopyChip({ text, label, children }: { text: string; label: string; children: string }) {
  const { m } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* presse-papiers indisponible : le texte reste sélectionnable */
        }
      }}
    >
      {copied ? m.common.copied : children}
    </Button>
  );
}

function Stat({ page, value, label, tone }: { page: PageKey; value: string; label: string; tone: 'blue' | 'green' | 'amber' | 'violet' }) {
  return (
    <LocLink page={page} className={`stat stat-${tone}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </LocLink>
  );
}

export function DashboardPage() {
  const { m, lang } = useI18n();
  const d = m.account.dashboard;
  const { user } = useAuth();
  const can = (permission: string) => !!user?.permissions.includes(permission);
  const isCustomer = user?.kind === 'CUSTOMER';
  const canProfile = isCustomer && can('profile:read_own');
  const canPackages = isCustomer && can('package:read_own');
  const canInvoices = isCustomer && can('invoice:read_own');
  const canNotifications = isCustomer && can('notification:read_own');
  const profile = useProfile(canProfile);
  const packages = usePackages({ status: '', q: '' }, canPackages);
  const invoices = useMyInvoices(canInvoices);
  const receiving = useReceiving(canProfile);
  const unread = useUnreadCount(canNotifications).data ?? 0;
  const name = user ? user.firstName : '';

  // Chiffres calculés sur la première page chargée : « 20+ » quand il y en a davantage (jamais un total inventé)
  const count = (n: number, more: boolean) => (more ? `${n}+` : String(n));
  const pkgItems = packages.data?.pages.flatMap((p) => p.items) ?? [];
  const pkgMore = !!packages.data?.pages.at(-1)?.nextCursor;
  const active = pkgItems.filter((p) => !FINISHED.includes(p.status));
  const toCollect = pkgItems.filter((p) => TO_COLLECT.includes(p.status));
  const invItems = invoices.data?.pages.flatMap((p) => p.items) ?? [];
  const invMore = !!invoices.data?.pages.at(-1)?.nextCursor;
  const unpaid = invItems.filter((i) => (i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID') && Number(i.balance) > 0);
  const recent = pkgItems.slice(0, 5);
  const warehouse = receiving.data?.warehouses[0];

  if (!isCustomer) {
    return (
      <>
        <h1 style={{ fontSize: '1.9rem' }}>{format(d.title, { name })}</h1>
        {user && !user.emailVerified ? <Alert tone="warning">{d.emailNotVerified}</Alert> : null}
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
    );
  }

  return (
    <>
      {user && !user.emailVerified ? <Alert tone="warning">{d.emailNotVerified}</Alert> : null}

      <section className="dash-hero" aria-labelledby="dash-title">
        <div>
          <h1 id="dash-title">{format(d.title, { name })}</h1>
          <p>{d.heroText}</p>
          <div className="dash-hero-actions">
            {can('prealert:create_own') ? (
              <ButtonLink page="accountPrealerts" variant="accent">
                {d.cards.find((c) => c.key === 'prealerts')?.title ?? ''}
              </ButtonLink>
            ) : null}
            {can('package:read_own') ? (
              <ButtonLink page="accountPackages" variant="outline">
                {m.account.nav.packages}
              </ButtonLink>
            ) : null}
          </div>
        </div>
        {canProfile ? (
          <div className="dash-code" aria-live="polite">
            <span className="dash-code-label">{d.customerCode}</span>
            {profile.isPending ? <span role="status">{m.common.loading}</span> : null}
            {profile.isError ? <span>{m.common.errorLoad}</span> : null}
            {profile.data?.customer ? (
              <>
                <span className="dash-code-value" data-testid="customer-code">
                  {profile.data.customer.customerCode}
                </span>
                <CopyChip text={profile.data.customer.customerCode} label={`${m.common.copy} : ${d.customerCode}`}>
                  {m.common.copy}
                </CopyChip>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="stat-grid">
        {canPackages ? <Stat page="accountPackages" tone="blue" value={packages.isPending ? '…' : count(active.length, pkgMore)} label={d.stats.active} /> : null}
        {canPackages ? <Stat page="accountPackages" tone="green" value={packages.isPending ? '…' : count(toCollect.length, pkgMore)} label={d.stats.ready} /> : null}
        {canInvoices ? <Stat page="accountInvoices" tone="amber" value={invoices.isPending ? '…' : count(unpaid.length, invMore)} label={d.stats.unpaid} /> : null}
        {canNotifications ? <Stat page="accountNotifications" tone="violet" value={String(unread)} label={d.stats.unread} /> : null}
      </div>

      <div className="dash-cols">
        {canPackages ? (
          <section className="card" aria-labelledby="dash-recent">
            <div className="row-card">
              <h2 id="dash-recent" style={{ fontSize: '1.15rem' }}>
                {d.recent}
              </h2>
              <LocLink page="accountPackages">{d.viewAll}</LocLink>
            </div>
            {packages.isPending ? <p role="status">{m.common.loading}</p> : null}
            {packages.isError ? <Alert tone="warning">{m.common.errorLoad}</Alert> : null}
            {packages.data && recent.length === 0 ? <p className="muted">{d.recentEmpty}</p> : null}
            <ul className="pkg-list">
              {recent.map((p) => (
                <li key={p.id}>
                  <Link to={`${localized(lang, 'accountPackages')}/${p.id}`} className="pkg-row">
                    <span>
                      <strong>{p.trackingNumberDisplay}</strong>
                      <span className="muted">{p.contentDescription ? ` · ${p.contentDescription}` : ''}</span>
                      <br />
                      <small className="muted">{formatDateTime(p.receivedAt ?? p.createdAt, lang)}</small>
                    </span>
                    <StatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {canProfile && warehouse ? (
          <section className="card" aria-labelledby="dash-receiving">
            <div className="row-card">
              <h2 id="dash-receiving" style={{ fontSize: '1.15rem' }}>
                {d.receivingTitle}
              </h2>
              <LocLink page="accountReceiving">{d.viewAll}</LocLink>
            </div>
            <p className="muted">
              {warehouse.name} · {warehouse.city}
            </p>
            {warehouse.addresses.map((address) => (
              <div key={address.mode} className="mini-address">
                <strong>{m.account.receiving.modes[address.mode]}</strong>
                <address className="address-block">{address.lines.join('\n')}</address>
                <CopyChip text={address.lines.join('\n')} label={`${m.account.receiving.copyAddress} (${m.account.receiving.modes[address.mode]})`}>
                  {m.account.receiving.copyAddress}
                </CopyChip>
              </div>
            ))}
          </section>
        ) : null}
      </div>

      <h2 style={{ fontSize: '1.15rem' }}>{d.shortcuts}</h2>
      <div className="shortcut-grid">
        {d.cards
          .filter((card) => can(cardPermission[card.key]))
          .map((card) => (
            <LocLink key={card.key} page={cardPages[card.key]} className="shortcut">
              <strong>{card.title}</strong>
              <span>{card.text}</span>
            </LocLink>
          ))}
      </div>
    </>
  );
}
