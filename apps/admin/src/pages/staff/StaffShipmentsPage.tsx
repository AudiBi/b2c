import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { createShipmentSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, RadioGroupField, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { countryName } from '../../lib/countries';
import { staffKeys, useAgencies, useCan, useShipments, useWarehouses, type ShipmentSummary, type TransportMode } from './queries';

export const shipmentTone = (status: ShipmentSummary['status']) => (status === 'CLOSED' ? ' badge-success' : status === 'CANCELLED' ? ' badge-danger' : status === 'OPEN' ? '' : ' badge-warning');

function NewShipmentForm({ onDone }: { onDone(): void }) {
  const { m } = useI18n();
  const f = m.staff.shipments.form;
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const agencies = useAgencies();
  const list = warehouses.data?.items ?? [];
  const [v, setV] = useState({ mode: 'AIR' as TransportMode, origin: '', country: 'HT', city: '', agency: '', carrier: '', ref: '', notes: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (name: keyof typeof v, value: string) => setV((c) => ({ ...c, [name]: value }));
  const origin = v.origin || list[0]?.id || '';
  const text = (x: string) => (x.trim() === '' ? undefined : x.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createShipmentSchema.safeParse({
      transportMode: v.mode,
      originWarehouseId: origin,
      destinationCountry: v.country,
      destinationCity: text(v.city),
      destinationAgencyId: text(v.agency),
      carrierName: text(v.carrier),
      transportRef: text(v.ref),
      notes: text(v.notes),
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      await api('/v1/admin/shipments', { method: 'POST', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: staffKeys.shipments });
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={m.staff.shipments.new}>
      <h2 style={{ fontSize: '1.2rem' }}>{m.staff.shipments.new}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <RadioGroupField legend={m.staff.common.mode} name="shipmentMode" value={v.mode} onChange={(x) => set('mode', x)} options={[{ value: 'AIR', label: m.staff.common.modes.AIR }, { value: 'SEA', label: m.staff.common.modes.SEA }]} />
      <SelectField name="origin" label={f.origin} value={origin} onChange={(x) => set('origin', x)} options={list.map((w) => ({ value: w.id, label: `${w.name} (${w.city})` }))} error={errors.originWarehouseId} />
      <div className="form-grid form-grid-2">
        <TextField name="country" label={f.country} value={v.country} onChange={(x) => set('country', x)} maxLength={2} error={errors.destinationCountry} />
        <TextField name="city" label={f.city} optional value={v.city} onChange={(x) => set('city', x)} error={errors.destinationCity} />
      </div>
      <SelectField
        name="agency"
        label={f.agency}
        optional
        value={v.agency}
        onChange={(x) => set('agency', x)}
        options={[{ value: '', label: m.staff.common.none }, ...(agencies.data?.items ?? []).filter((a) => a.country === v.country.toUpperCase()).map((a) => ({ value: a.id, label: `${a.name} (${a.city})` }))]}
      />
      <div className="form-grid form-grid-2">
        <TextField name="carrier" label={f.carrier} optional value={v.carrier} onChange={(x) => set('carrier', x)} error={errors.carrierName} />
        <TextField name="transportRef" label={f.transportRef} optional value={v.ref} onChange={(x) => set('ref', x)} error={errors.transportRef} />
      </div>
      <TextAreaField name="notes" label={f.notes} optional value={v.notes} onChange={(x) => set('notes', x)} error={errors.notes} />
      <div className="form-actions">
        <Button type="submit" disabled={busy || list.length === 0}>{busy ? m.common.saving : f.submit}</Button>
        <Button variant="outline" onClick={onDone}>{m.common.cancel}</Button>
      </div>
    </form>
  );
}

export function StaffShipmentsPage() {
  const { m, lang } = useI18n();
  const sh = m.staff.shipments;
  const canManage = useCan('shipment:manage');
  const shipments = useShipments();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{sh.title}</h1>
      <p className="lead">{sh.lead}</p>
      {canManage && !adding ? <p><Button onClick={() => setAdding(true)}>{sh.new}</Button></p> : null}
      {adding ? <NewShipmentForm onDone={() => setAdding(false)} /> : null}

      {shipments.isPending ? <p role="status">{m.common.loading}</p> : null}
      {shipments.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {shipments.data && shipments.data.items.length === 0 ? <Alert tone="info">{sh.empty}</Alert> : null}
      <ul className="list-plain" aria-label={sh.title}>
        {shipments.data?.items.map((s) => (
          <li key={s.id} className="card" data-testid="shipment-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  <span className="mono">{s.reference}</span> <span className={`badge${shipmentTone(s.status)}`}>{sh.statuses[s.status]}</span>
                </h2>
                <p style={{ margin: 0 }}>
                  {s.origin.city} → {s.destination.city ? `${s.destination.city}, ` : ''}{countryName(s.destination.country, lang)} · {m.staff.common.modes[s.transportMode]} · {s.packageCount} {sh.count}
                </p>
                {s.departedAt ? <p className="muted" style={{ margin: '4px 0 0' }}>{m.staff.shipment.departed} : {formatDateTime(s.departedAt, lang)}</p> : null}
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/shipments/${s.id}`)} aria-label={`${m.staff.common.open} : ${s.reference}`}>
                {m.staff.common.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
