import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { PACKAGE_STATUSES } from '@b2c/shared';
import { useI18n } from '../../i18n';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, SelectField, TextField } from '../../components/ui/Fields';
import { StatusBadge, statusLabel } from '../../components/PackageParts';
import { useStaffPackages } from './queries';

export function StaffPackagesPage() {
  const { m, lang } = useI18n();
  const p = m.staff.packages;
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [unidentified, setUnidentified] = useState(false);
  const packages = useStaffPackages({ status, q, unidentified });
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
          <SelectField name="status" label={p.filter} optional value={status} onChange={setStatus} options={[{ value: '', label: p.allStatuses }, ...PACKAGE_STATUSES.map((s) => ({ value: s, label: statusLabel(m, s) }))]} />
        </div>
        <CheckField name="unidentified" checked={unidentified} onChange={setUnidentified}>
          {p.unidentifiedOnly}
        </CheckField>
        <div className="form-actions">
          <Button type="submit">{p.apply}</Button>
        </div>
      </form>

      {packages.isPending ? <p role="status">{m.common.loading}</p> : null}
      {packages.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {packages.data && items.length === 0 ? <Alert tone="info">{p.empty}</Alert> : null}
      <ul className="list-plain" aria-label={p.title}>
        {items.map((item) => (
          <li key={item.id} className="card" data-testid="staff-package-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  <span className="mono">{item.trackingNumberDisplay}</span> <StatusBadge status={item.status} />
                </h2>
                <p style={{ margin: 0 }}>
                  {item.customer ? `${item.customer.name ?? ''} (${item.customer.customerCode})` : m.staff.common.unidentified}
                  {item.supplierTracking ? ` · ${item.supplierTracking}` : ''}
                </p>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {item.warehouse.name}
                  {item.contentDescription ? ` · ${item.contentDescription}` : ''}
                </p>
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/account/staff/packages/${item.id}`)} aria-label={`${m.staff.common.open} : ${item.trackingNumberDisplay}`}>
                {m.staff.common.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {packages.hasNextPage ? (
        <p>
          <Button variant="outline" disabled={packages.isFetchingNextPage} onClick={() => packages.fetchNextPage()}>
            {packages.isFetchingNextPage ? m.common.loading : m.staff.common.loadMore}
          </Button>
        </p>
      ) : null}
    </>
  );
}
