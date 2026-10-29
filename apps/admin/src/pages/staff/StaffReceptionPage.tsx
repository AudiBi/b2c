import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { RadioGroupField, SelectField } from '../../components/ui/Fields';
import { StatusBadge } from '../../components/PackageParts';
import { ScanBox } from './ScanBox';
import { staffKeys, useWarehouses, type StaffPackage, type TransportMode } from './queries';

type Outcome = 'RECEIVED' | 'ALREADY_RECEIVED' | 'UNIDENTIFIED';
interface Entry {
  key: number;
  at: string;
  code: string;
  outcome?: Outcome;
  package?: StaffPackage;
  error?: string;
}

/** Réception en entrepôt par lecture de codes : une ligne d'historique par lecture, la plus récente en haut. */
export function StaffReceptionPage() {
  const { m, lang } = useI18n();
  const s = m.staff;
  const r = s.reception;
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<'' | TransportMode>('');
  const [entries, setEntries] = useState<Entry[]>([]);

  const list = warehouses.data?.items ?? [];
  const warehouseId = selected || list[0]?.id || '';

  async function scan(code: string) {
    const entry: Entry = { key: Date.now() + Math.random(), at: new Date().toISOString(), code };
    try {
      const res = await api<{ outcome: Outcome; package: StaffPackage }>('/v1/admin/scan/receive', {
        method: 'POST',
        body: { warehouseId, code, ...(mode ? { transportMode: mode } : {}) },
      });
      entry.outcome = res.outcome;
      entry.package = res.package;
      void queryClient.invalidateQueries({ queryKey: staffKeys.packages });
    } catch (e) {
      const message = e instanceof ApiError ? apiErrorMessage(e, m) : apiErrorMessage(e, m);
      entry.error = format(r.failed, { message });
    }
    setEntries((current) => [entry, ...current].slice(0, 50));
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{r.title}</h1>
      <p className="lead">{r.lead}</p>
      {warehouses.isPending ? <p role="status">{m.common.loading}</p> : null}
      {warehouses.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {warehouses.data && list.length === 0 ? <Alert tone="info">{s.common.noWarehouse}</Alert> : null}

      {list.length > 0 ? (
        <>
          <div className="card form">
            {list.length > 1 ? (
              <SelectField name="warehouse" label={s.common.warehouse} value={warehouseId} onChange={setSelected} options={list.map((w) => ({ value: w.id, label: `${w.name} (${w.city})` }))} />
            ) : (
              <p style={{ margin: 0 }}>
                <strong>{s.common.warehouse} :</strong> {list[0].name} ({list[0].city})
              </p>
            )}
            <RadioGroupField
              legend={r.mode}
              name="receptionMode"
              value={mode}
              onChange={(x) => setMode(x as '' | TransportMode)}
              options={[
                { value: '', label: s.common.none },
                { value: 'AIR', label: s.common.modes.AIR },
                { value: 'SEA', label: s.common.modes.SEA },
              ]}
            />
          </div>
          <ScanBox name="code" label={r.code} hint={r.codeHint} submitLabel={r.submit} onScan={scan} />

          <h2 style={{ fontSize: '1.2rem' }}>{r.history}</h2>
          <div aria-live="polite">
            {entries.length === 0 ? <p className="muted">{r.empty}</p> : null}
            <ul className="list-plain" data-testid="scan-history">
              {entries.map((entry) => (
                <li key={entry.key} className="card" data-testid="scan-entry">
                  <div className="row-card">
                    <div>
                      <strong className="mono">{entry.code}</strong>{' '}
                      {entry.outcome ? <span className={`badge${entry.outcome === 'RECEIVED' ? ' badge-success' : entry.outcome === 'UNIDENTIFIED' ? ' badge-warning' : ''}`}>{r.outcomes[entry.outcome]}</span> : null}
                      <p className="muted" style={{ margin: '4px 0 0' }}>
                        {formatDateTime(entry.at, lang)}
                        {entry.package ? ` · ${entry.package.customer ? `${entry.package.customer.name ?? ''} (${entry.package.customer.customerCode})` : s.common.unidentified}` : ''}
                      </p>
                      {entry.outcome === 'UNIDENTIFIED' ? <p style={{ margin: '4px 0 0' }}>{r.unidentifiedHint}</p> : null}
                      {entry.error ? <Alert tone="danger">{entry.error}</Alert> : null}
                    </div>
                    {entry.package ? (
                      <div className="form-actions">
                        <StatusBadge status={entry.package.status} />
                        <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/packages/${entry.package.id}`)}>
                          {s.common.open}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </>
  );
}
