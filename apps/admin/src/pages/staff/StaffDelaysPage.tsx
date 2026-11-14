import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { TextField } from '../../components/ui/Fields';
import { StatusBadge } from '../../components/PackageParts';

interface Delay {
  id: string;
  trackingNumberDisplay: string;
  status: string;
  customer: { id: string; customerCode: string; name: string } | null;
  warehouse: string;
  lastUpdate: string;
  idleDays: number;
}

/** Alerte de retard : colis ouverts sans changement depuis N jours. */
export function StaffDelaysPage() {
  const { m, lang } = useI18n();
  const d = m.staff.delays;
  const [days, setDays] = useState('14');
  const n = Math.min(365, Math.max(1, Number(days) || 14));
  const report = useQuery({ queryKey: ['delays', n] as const, queryFn: () => api<{ days: number; items: Delay[] }>(`/v1/admin/reports/delays?days=${n}`) });
  const items = report.data?.items ?? [];

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{d.title}</h1>
      <p className="lead">{d.lead}</p>
      <div className="card form">
        <TextField name="delayDays" label={d.days} type="number" min={1} max={365} value={days} onChange={setDays} />
      </div>
      {report.isPending ? <p role="status">{m.common.loading}</p> : null}
      {report.data && items.length === 0 ? <Alert tone="success">{format(d.none, { n: String(n) })}</Alert> : null}
      <ul className="list-plain">
        {items.map((x) => (
          <li key={x.id} className="card row-card" data-testid="delay">
            <div>
              <strong className="mono">{x.trackingNumberDisplay}</strong> <StatusBadge status={x.status} />{' '}
              <span className="badge badge-warning">{format(d.idle, { n: String(x.idleDays) })}</span>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {x.customer ? `${x.customer.name} (${x.customer.customerCode})` : m.staff.common.unidentified} · {x.warehouse} · {formatDateTime(x.lastUpdate, lang)}
              </p>
            </div>
            <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/packages/${x.id}`)}>
              {m.staff.common.open}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
