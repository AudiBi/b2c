import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api, apiDownload } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime, formatMoney } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage } from '../../components/ui/Fields';
import { StatusBadge } from '../../components/PackageParts';
import { countryName } from '../../lib/countries';
import { ScanBox } from './ScanBox';
import { staffKeys, useCan, useShipment } from './queries';
import { shipmentTone } from './StaffShipmentsPage';

type Action = 'dispatch' | 'arrive' | 'customs' | 'close' | 'cancel';
const ACTIONS: { action: Action; from: string[]; permission: string }[] = [
  { action: 'dispatch', from: ['OPEN'], permission: 'shipment:dispatch' },
  { action: 'arrive', from: ['DISPATCHED'], permission: 'shipment:receive' },
  { action: 'customs', from: ['ARRIVED'], permission: 'shipment:receive' },
  { action: 'close', from: ['ARRIVED', 'IN_CUSTOMS'], permission: 'shipment:manage' },
  { action: 'cancel', from: ['OPEN'], permission: 'shipment:manage' },
];

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StaffShipmentDetailPage() {
  const { m, lang } = useI18n();
  const s = m.staff.shipment;
  const sh = m.staff.shipments;
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const query = useShipment(id);
  const data = query.data;
  const canManage = useCan('shipment:manage');
  const canDispatch = useCan('shipment:dispatch');
  const canReceive = useCan('shipment:receive');
  const has = (permission: string) => (permission === 'shipment:dispatch' ? canDispatch : permission === 'shipment:receive' ? canReceive : canManage);

  const [confirming, setConfirming] = useState<Action | null>(null);
  const [loadResult, setLoadResult] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ trackingNumber: string; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: staffKeys.shipments }), queryClient.invalidateQueries({ queryKey: staffKeys.packages }), queryClient.invalidateQueries({ queryKey: ['staff', 'inventory'] })]);

  async function perform(action: Action) {
    setError(null);
    setNotice(null);
    setSkipped([]);
    setBusy(true);
    try {
      const res = await api<{ advanced: number; skipped: { trackingNumber: string; status: string }[] }>(`/v1/admin/shipments/${id}/${action}`, { method: 'POST', body: {} });
      setNotice(format(s.advanced, { n: res.advanced }));
      setSkipped(res.skipped);
      await refresh();
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setConfirming(null);
      setBusy(false);
    }
  }

  async function load(code: string) {
    setError(null);
    setLoadResult(null);
    try {
      const res = await api<{ outcome: 'LOADED' | 'ALREADY_LOADED'; package: { trackingNumberDisplay: string } }>(`/v1/admin/shipments/${id}/packages`, { method: 'POST', body: { code } });
      setLoadResult(`${res.package.trackingNumberDisplay} : ${s.load.outcomes[res.outcome]}`);
      await refresh();
    } catch (e) {
      setError(`${code} : ${apiErrorMessage(e, m)}`);
    }
  }

  async function unload(packageId: string) {
    setError(null);
    try {
      await api(`/v1/admin/shipments/${id}/packages/${packageId}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  async function download(kind: 'csv' | 'pdf') {
    setError(null);
    try {
      const blob = await apiDownload(`/v1/admin/shipments/${id}/manifest.${kind}`);
      await saveBlob(blob, `manifeste-${data?.reference ?? id}.${kind}`);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  const link = (pid: string) => localizedPath(lang, `/packages/${pid}`);
  const open = data?.status === 'OPEN';

  return (
    <>
      <p><Link to={localizedPath(lang, '/shipments')}>← {s.back}</Link></p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.auth.errors.SHIPMENT_NOT_FOUND}</Alert> : null}
      {data ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            <span className="mono" data-testid="shipment-reference">{data.reference}</span> <span className={`badge${shipmentTone(data.status)}`} data-testid="shipment-status">{sh.statuses[data.status]}</span>
          </h1>
          <div aria-live="polite">
            {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
            {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
            {skipped.length > 0 ? (
              <Alert tone="warning">
                {format(s.skipped, { n: skipped.length })}
                <ul>{skipped.map((p) => <li key={p.trackingNumber} className="mono">{p.trackingNumber} ({p.status})</li>)}</ul>
              </Alert>
            ) : null}
          </div>

          <div className="card">
            <dl className="kv">
              <dt>{s.route}</dt>
              <dd>{data.origin.city} → {data.destination.agency ? `${data.destination.agency.name}, ` : ''}{data.destination.city ? `${data.destination.city}, ` : ''}{countryName(data.destination.country, lang)}</dd>
              <dt>{m.staff.common.mode}</dt>
              <dd>{m.staff.common.modes[data.transportMode]}</dd>
              {data.carrierName ? (<><dt>{sh.form.carrier}</dt><dd>{data.carrierName}</dd></>) : null}
              {data.transportRef ? (<><dt>{sh.form.transportRef}</dt><dd>{data.transportRef}</dd></>) : null}
              <dt>{s.departed}</dt>
              <dd>{data.departedAt ? formatDateTime(data.departedAt, lang) : s.notYet}</dd>
              <dt>{s.arrived}</dt>
              <dd>{data.arrivedAt ? formatDateTime(data.arrivedAt, lang) : s.notYet}</dd>
            </dl>
          </div>

          <div className="form-actions" aria-label={sh.title}>
            {ACTIONS.filter((a) => a.from.includes(data.status) && has(a.permission)).map((a) =>
              confirming === a.action ? (
                <Button key={a.action} variant={a.action === 'cancel' ? 'danger' : 'primary'} disabled={busy} onClick={() => perform(a.action)}>
                  {format(s.confirmAction, { action: s.actions[a.action] })}
                </Button>
              ) : (
                <Button key={a.action} variant={a.action === 'cancel' ? 'ghost' : 'outline'} onClick={() => setConfirming(a.action)}>
                  {s.actions[a.action]}
                </Button>
              ),
            )}
          </div>

          {open && canManage ? <ScanBox name="loadCode" label={s.load.code} submitLabel={s.load.submit} onScan={load} /> : null}
          <div aria-live="polite">{loadResult ? <p data-testid="load-result">{loadResult}</p> : null}</div>

          <section className="card" aria-label={s.packages}>
            <h2 style={{ fontSize: '1.1rem' }}>{s.packages}</h2>
            {data.packages.length === 0 ? <p className="muted">{s.empty}</p> : null}
            <ul className="list-plain" data-testid="shipment-packages">
              {data.packages.map((p) => (
                <li key={p.id} className="row-card">
                  <span>
                    <Link to={link(p.id)} className="mono">{p.trackingNumberDisplay}</Link> <StatusBadge status={p.status} />
                    <span className="muted"> · {p.customer ? `${p.customer.name ?? ''} (${p.customer.customerCode})` : ''}</span>
                  </span>
                  {open && canManage ? <Button variant="ghost" size="sm" onClick={() => unload(p.id)} aria-label={`${s.remove} : ${p.trackingNumberDisplay}`}>{s.remove}</Button> : null}
                </li>
              ))}
            </ul>
            <p data-testid="shipment-totals"><strong>{format(s.totals, { count: data.totals.count, weight: data.totals.actualWeightKg })}</strong>{Object.entries(data.totals.declared).map(([c, v]) => ` · ${formatMoney(v, c, lang)}`)}</p>
          </section>

          {data.totals.count > 0 ? (
            <section className="card" aria-label={s.manifest}>
              <h2 style={{ fontSize: '1.1rem' }}>{s.manifest}</h2>
              <div className="form-actions">
                <Button variant="outline" onClick={() => download('csv')}>{s.csv}</Button>
                <Button variant="outline" onClick={() => download('pdf')}>{s.pdf}</Button>
              </div>
            </section>
          ) : null}

          <section className="card" aria-label={s.history}>
            <h2 style={{ fontSize: '1.1rem' }}>{s.history}</h2>
            <ol className="timeline" aria-label={s.history}>
              {data.events.slice().reverse().map((e) => (
                <li key={e.id}>
                  <strong>{e.to ? sh.statuses[e.to as keyof typeof sh.statuses] : e.type}</strong>
                  {e.note ? <span className="muted"> — {e.note}</span> : null}
                  <br />
                  <span className="muted">{e.type} · {formatDateTime(e.occurredAt, lang)}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </>
  );
}
