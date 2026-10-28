import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { PACKAGE_STATUSES } from '@b2c/shared';
import { useI18n } from '../../i18n';
import { formatMoney, formatWeight } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Fields';
import { StatusBadge, Timeline, statusLabel } from '../../components/PackageParts';
import { countryName } from '../LocationsPage';
import { HandoverCodeCard } from '../delivery/HandoverCodeCard';
import { FilesPanel } from './FilesPanel';
import { usePackage, usePackages } from './queries';

export function PackagesPage() {
  const { m, lang } = useI18n();
  const p = m.account.packages;
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const packages = usePackages({ status, q });
  const items = packages.data?.pages.flatMap((page) => page.items) ?? [];

  function search(event: FormEvent) {
    event.preventDefault();
    setQ(text.trim());
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{p.title}</h1>
      <p className="lead">{p.lead}</p>

      <form className="form card" onSubmit={search} role="search">
        <div className="form-grid form-grid-2">
          <TextField name="q" label={p.search} optional value={text} onChange={setText} autoCapitalize="characters" spellCheck={false} />
          <SelectField
            name="status"
            label={p.filter}
            optional
            value={status}
            onChange={setStatus}
            options={[{ value: '', label: p.allStatuses }, ...PACKAGE_STATUSES.map((s) => ({ value: s, label: statusLabel(m, s) }))]}
          />
        </div>
        <div className="form-actions">
          <Button type="submit">{p.apply}</Button>
        </div>
      </form>

      {packages.isPending ? <p role="status">{m.common.loading}</p> : null}
      {packages.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {packages.data && items.length === 0 ? <Alert tone="info">{p.empty}</Alert> : null}
      <ul className="list-plain" aria-label={p.title}>
        {items.map((item) => (
          <li key={item.id} className="card" data-testid="package-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.1rem' }}>
                  <span className="mono">{item.trackingNumberDisplay}</span> <StatusBadge status={item.status} />
                </h2>
                <p style={{ margin: 0 }}>{item.contentDescription ?? '—'}</p>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {item.origin.city}, {countryName(item.origin.country, lang)} → {countryName(item.destination.country, lang)}
                  {item.measures.billableWeight ? ` · ${formatWeight(item.measures.billableWeight, item.measures.weightUnit, lang)}` : ''}
                </p>
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/account/packages/${item.id}`)} aria-label={`${p.open} : ${item.trackingNumberDisplay}`}>
                {p.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {packages.hasNextPage ? (
        <p>
          <Button variant="outline" disabled={packages.isFetchingNextPage} onClick={() => packages.fetchNextPage()}>
            {packages.isFetchingNextPage ? m.common.loading : p.more}
          </Button>
        </p>
      ) : null}
    </>
  );
}

export function PackageDetailPage() {
  const { m, lang } = useI18n();
  const p = m.account.packages;
  const d = p.detail;
  const { id = '' } = useParams();
  const pkg = usePackage(id);
  const data = pkg.data;

  return (
    <>
      <p>
        <Link to={localizedPath(lang, '/account/packages')}>← {d.back}</Link>
        {data ? (
          <>
            {' · '}
            <Link to={localizedPath(lang, `/account/claims?package=${data.id}`)}>{m.delivery.claims.report}</Link>
          </>
        ) : null}
      </p>
      {pkg.isPending ? <p role="status">{m.common.loading}</p> : null}
      {pkg.isError ? <Alert tone="danger">{m.auth.errors.PACKAGE_NOT_FOUND}</Alert> : null}
      {data ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            <span className="mono" data-testid="package-tracking">
              {data.trackingNumberDisplay}
            </span>
          </h1>
          <p>
            <strong>{d.status} : </strong>
            <StatusBadge status={data.status} />
          </p>

          <div className="card">
            <dl className="kv">
              <dt>{d.trackingNumber}</dt>
              <dd className="mono">{data.trackingNumber}</dd>
              {data.supplierTracking ? (
                <>
                  <dt>{d.supplierTracking}</dt>
                  <dd className="mono">{data.supplierTracking}</dd>
                </>
              ) : null}
              <dt>{d.route}</dt>
              <dd>
                {data.origin.city}, {countryName(data.origin.country, lang)} → {data.destination.city ? `${data.destination.city}, ` : ''}
                {countryName(data.destination.country, lang)}
              </dd>
              {data.transportMode ? (
                <>
                  <dt>{d.mode}</dt>
                  <dd>{m.account.prealerts.fields.modes[data.transportMode]}</dd>
                </>
              ) : null}
              {data.contentDescription ? (
                <>
                  <dt>{d.description}</dt>
                  <dd>{data.contentDescription}</dd>
                </>
              ) : null}
            </dl>
          </div>

          {data.pickup ? (
            <div className="card" data-testid="pickup-card">
              <h2 style={{ fontSize: '1.1rem' }}>{d.pickupTitle}</h2>
              <Alert tone={data.pickup.ready ? 'success' : 'info'}>{data.pickup.ready ? d.pickupReady : d.pickupHere}</Alert>
              <p style={{ margin: 0 }}>
                <strong>{data.pickup.name}</strong>
                <br />
                {data.pickup.addressLine}, {data.pickup.city}
              </p>
              <dl className="kv">
                {data.pickup.hours ? (
                  <>
                    <dt>{d.pickupHours}</dt>
                    <dd>{data.pickup.hours}</dd>
                  </>
                ) : null}
                {data.pickup.phone ? (
                  <>
                    <dt>{d.pickupPhone}</dt>
                    <dd>{data.pickup.phone}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}

          {['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'].includes(data.status) ? <HandoverCodeCard packageId={data.id} /> : null}

          <div className="card">
            <h2 style={{ fontSize: '1.1rem' }}>{d.measures}</h2>
            {data.measures.actualWeightKg ? (
              <dl className="kv">
                <dt>{d.actualWeight}</dt>
                <dd>{formatWeight(data.measures.actualWeightKg, 'KG', lang)}</dd>
                <dt>{d.billableWeight}</dt>
                <dd>{formatWeight(data.measures.billableWeight, data.measures.weightUnit, lang)}</dd>
              </dl>
            ) : (
              <p className="muted">{d.notWeighed}</p>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.1rem' }}>{d.fees}</h2>
            {data.fees ? (
              <>
                <dl className="kv">
                  <dt>{d.freight}</dt>
                  <dd data-testid="package-freight">{formatMoney(data.fees.freight, data.fees.currency, lang)}</dd>
                  {data.fees.extras && Number(data.fees.extras) > 0 ? (
                    <>
                      <dt>{d.extras}</dt>
                      <dd>{formatMoney(data.fees.extras, data.fees.currency, lang)}</dd>
                    </>
                  ) : null}
                </dl>
                <p className="muted">{d.provisional}</p>
              </>
            ) : (
              <p className="muted">{d.noFees}</p>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.1rem' }}>{d.history}</h2>
            <Timeline events={data.events} label={d.history} />
          </div>

          <div className="card">
            <FilesPanel ownerType="PACKAGE" ownerId={data.id} kind="PHOTO" title={d.files} editable={false} emptyText={d.noFiles} />
          </div>
        </>
      ) : null}
    </>
  );
}
