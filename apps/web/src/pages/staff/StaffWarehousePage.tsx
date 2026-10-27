import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { StatusBadge } from '../../components/PackageParts';
import { staffKeys, useAnomalies, useCan, useInventory, useLocations, useWarehouses } from './queries';

export function StaffWarehousePage() {
  const { m, lang } = useI18n();
  const w = m.staff.warehouse;
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const canManage = useCan('warehouse:manage');
  const [selected, setSelected] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('SHELF');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = warehouses.data?.items ?? [];
  const warehouseId = selected || list[0]?.id || '';
  const inventory = useInventory(warehouseId, locationFilter);
  const locations = useLocations(warehouseId);
  const anomalies = useAnomalies();

  async function addLocation(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/admin/warehouses/${warehouseId}/locations`, { method: 'POST', body: { code, kind } });
      setCode('');
      setNotice(w.created);
      await Promise.all([queryClient.invalidateQueries({ queryKey: staffKeys.locations(warehouseId) }), queryClient.invalidateQueries({ queryKey: staffKeys.inventory(warehouseId) })]);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  const link = (id: string) => localizedPath(lang, `/account/staff/packages/${id}`);

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{w.title}</h1>
      <p className="lead">{w.lead}</p>
      {warehouses.isPending ? <p role="status">{m.common.loading}</p> : null}
      {warehouses.data && list.length === 0 ? <Alert tone="info">{m.staff.common.noWarehouse}</Alert> : null}

      {list.length > 0 ? (
        <>
          {list.length > 1 ? (
            <div className="card form">
              <SelectField name="warehouse" label={m.staff.common.warehouse} value={warehouseId} onChange={(x) => { setSelected(x); setLocationFilter(''); }} options={list.map((x) => ({ value: x.id, label: `${x.name} (${x.city})` }))} />
            </div>
          ) : null}

          {inventory.isPending ? <p role="status">{m.common.loading}</p> : null}
          {inventory.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
          {inventory.data ? (
            <>
              <div className="grid grid-3">
                <div className="card">
                  <p className="muted" style={{ margin: 0 }}>{w.total}</p>
                  <p style={{ fontSize: '2rem', fontWeight: 800, margin: 0 }} data-testid="inventory-total">{inventory.data.total}</p>
                </div>
                <div className="card">
                  <p className="muted" style={{ margin: 0 }}>{w.unplaced}</p>
                  <p style={{ fontSize: '2rem', fontWeight: 800, margin: 0 }} data-testid="inventory-unplaced">{inventory.data.unplaced}</p>
                </div>
              </div>

              <h2 style={{ fontSize: '1.2rem' }}>{w.locations}</h2>
              <ul className="list-plain" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                {inventory.data.locations.map((l) => (
                  <li key={l.id} className="card" style={{ padding: 12 }}>
                    <strong>{l.code}</strong> <span className="muted">({w.kinds[l.kind]})</span>
                    <br />
                    {l.count}
                  </li>
                ))}
              </ul>

              {canManage ? (
                <form className="form card" onSubmit={addLocation} aria-label={w.addLocation}>
                  <h3 style={{ fontSize: '1.05rem' }}>{w.addLocation}</h3>
                  {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
                  {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
                  <div className="form-grid form-grid-2">
                    <TextField name="locationCode" label={w.code} value={code} onChange={setCode} autoCapitalize="characters" />
                    <SelectField name="locationKind" label={w.kind} value={kind} onChange={setKind} options={(['ZONE', 'SHELF', 'BIN'] as const).map((k) => ({ value: k, label: w.kinds[k] }))} />
                  </div>
                  <div className="form-actions">
                    <Button type="submit" disabled={code.trim() === ''}>{m.common.add}</Button>
                  </div>
                </form>
              ) : null}

              <h2 style={{ fontSize: '1.2rem' }}>{w.items}</h2>
              {locations.data && locations.data.items.length > 0 ? (
                <div className="card form">
                  <SelectField
                    name="locationFilter"
                    label={w.locations}
                    value={locationFilter}
                    onChange={setLocationFilter}
                    options={[{ value: '', label: w.allLocations }, ...locations.data.items.map((l) => ({ value: l.id, label: l.code }))]}
                  />
                </div>
              ) : null}
              {inventory.data.truncated ? <Alert tone="info">{w.truncated}</Alert> : null}
              <ul className="list-plain">
                {inventory.data.items.map((p) => (
                  <li key={p.id} className="card" data-testid="inventory-item">
                    <div className="row-card">
                      <div>
                        <strong className="mono">{p.trackingNumberDisplay}</strong> <StatusBadge status={p.status} />
                        <p className="muted" style={{ margin: '4px 0 0' }}>{p.customer ? `${p.customer.name ?? ''} (${p.customer.customerCode})` : m.staff.common.unidentified}</p>
                      </div>
                      <Link className="btn btn-outline btn-sm" to={link(p.id)}>{m.staff.common.open}</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h2 style={{ fontSize: '1.2rem' }}>{w.anomalies}</h2>
          {anomalies.data && anomalies.data.holds.length === 0 && anomalies.data.unidentified.length === 0 ? <p className="muted">{w.noAnomalies}</p> : null}
          {anomalies.data && anomalies.data.holds.length > 0 ? (
            <>
              <h3 style={{ fontSize: '1.05rem' }}>{w.holds}</h3>
              <ul className="list-plain" data-testid="anomaly-holds">
                {anomalies.data.holds.map((h) => (
                  <li key={h.id} className="card">
                    <div className="row-card">
                      <div>
                        <strong className="mono">{h.package.trackingNumberDisplay}</strong> <span className="badge badge-warning">{(m.holdReasons as Record<string, string>)[h.reasonCode] ?? h.reasonCode}</span>
                        {h.note ? <p className="muted" style={{ margin: '4px 0 0' }}>{h.note}</p> : null}
                      </div>
                      <Link className="btn btn-outline btn-sm" to={link(h.package.id)}>{m.staff.common.open}</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {anomalies.data && anomalies.data.unidentified.length > 0 ? (
            <>
              <h3 style={{ fontSize: '1.05rem' }}>{w.unidentified}</h3>
              <ul className="list-plain" data-testid="anomaly-unidentified">
                {anomalies.data.unidentified.map((p) => (
                  <li key={p.id} className="card">
                    <div className="row-card">
                      <div>
                        <strong className="mono">{p.trackingNumberDisplay}</strong> <span className="muted">{p.supplierTracking}</span>
                      </div>
                      <Link className="btn btn-outline btn-sm" to={link(p.id)}>{m.staff.common.open}</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
