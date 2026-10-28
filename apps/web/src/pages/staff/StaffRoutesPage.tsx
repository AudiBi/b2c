import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { createRouteSchema, deliverySettingsSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { deliveryKeys, useDeliverySettings, useRoutes, type RouteStatus } from '../delivery/queries';
import { useAgencies, useCan } from './queries';

export const routeTone = (status: RouteStatus) => (status === 'COMPLETED' ? ' badge-success' : status === 'CANCELLED' ? ' badge-danger' : status === 'IN_PROGRESS' ? ' badge-warning' : '');
const today = () => new Date().toISOString().slice(0, 10);

function NewRouteForm({ onDone }: { onDone(): void }) {
  const { m, lang } = useI18n();
  const r = m.delivery.staff.routes;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const agencies = useAgencies();
  const drivers = useQuery({ queryKey: ['staff', 'drivers'] as const, queryFn: () => api<{ items: { id: string; name: string }[] }>('/v1/admin/drivers') });
  const [agencyId, setAgencyId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const agencyList = agencies.data?.items ?? [];
  const driverList = drivers.data?.items ?? [];
  const agency = agencyId || agencyList[0]?.id || '';
  const driver = driverId || driverList[0]?.id || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createRouteSchema.safeParse({ agencyId: agency, driverUserId: driver, plannedDate: date.trim(), notes: notes.trim() === '' ? undefined : notes.trim() });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/v1/admin/routes', { method: 'POST', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.routes });
      navigate(localizedPath(lang, `/account/staff/routes/${created.id}`));
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={r.new}>
      <h2 style={{ fontSize: '1.2rem' }}>{r.new}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {drivers.data && driverList.length === 0 ? <Alert tone="info">{r.noDriver}</Alert> : null}
      <div className="form-grid form-grid-2">
        <SelectField name="routeAgency" label={r.agency} value={agency} onChange={setAgencyId} options={agencyList.map((a) => ({ value: a.id, label: `${a.name} (${a.city})` }))} error={errors.agencyId} />
        <SelectField name="routeDriver" label={r.driver} value={driver} onChange={setDriverId} options={driverList.map((d) => ({ value: d.id, label: d.name }))} error={errors.driverUserId} />
      </div>
      <TextField name="routeDate" label={r.date} value={date} onChange={setDate} error={errors.plannedDate} />
      <TextAreaField name="routeNotes" label={r.notes} optional value={notes} onChange={setNotes} error={errors.notes} />
      <div className="form-actions">
        <Button type="submit" disabled={busy || driverList.length === 0}>
          {busy ? m.common.saving : r.create}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function SettingsSection() {
  const { m } = useI18n();
  const s = m.delivery.staff.settings;
  const canUpdate = useCan('settings:update');
  const queryClient = useQueryClient();
  const settings = useDeliverySettings();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!settings.data) return null;
  const current = settings.data;

  async function change(patch: Partial<typeof current>) {
    setError(null);
    setNotice(null);
    const parsed = deliverySettingsSchema.safeParse(patch);
    if (!parsed.success) return;
    try {
      await api('/v1/admin/settings/delivery', { method: 'PUT', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.settings });
      setNotice(s.saved);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <section className="card" aria-labelledby="delivery-settings-title">
      <h2 id="delivery-settings-title" style={{ fontSize: '1.2rem' }}>{s.title}</h2>
      <p className="muted">{s.lead}</p>
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <CheckField name="requireOtp" checked={current.requireOtp} onChange={(v) => canUpdate && change({ requireOtp: v })}>
        {s.requireOtp}
      </CheckField>
      <CheckField name="requireIdDocument" checked={current.requireIdDocument} onChange={(v) => canUpdate && change({ requireIdDocument: v })}>
        {s.requireIdDocument}
      </CheckField>
      <CheckField name="requirePhoto" checked={current.requirePhoto} onChange={(v) => canUpdate && change({ requirePhoto: v })}>
        {s.requirePhoto}
      </CheckField>
      {!canUpdate ? <p className="muted">{s.readOnly}</p> : null}
    </section>
  );
}

/** Tournées de livraison : planification (responsables) ou « mes tournées » (livreur). */
export function StaffRoutesPage({ mine = false }: { mine?: boolean }) {
  const { m, lang } = useI18n();
  const r = m.delivery.staff.routes;
  const canAssign = useCan('delivery:assign');
  const canSettings = useCan('settings:read');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const routes = useRoutes(mine, { status });
  const base = mine ? 'my-routes' : 'routes';

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{mine ? r.mineTitle : r.title}</h1>
      <p className="lead">{mine ? r.mineLead : r.lead}</p>
      {!mine && canAssign && !adding ? (
        <p>
          <Button onClick={() => setAdding(true)}>{r.new}</Button>
        </p>
      ) : null}
      {adding ? <NewRouteForm onDone={() => setAdding(false)} /> : null}
      <SelectField
        name="routeStatus"
        label={r.status}
        value={status}
        onChange={setStatus}
        options={[{ value: '', label: m.finance.common.all }, ...(Object.keys(r.statuses) as RouteStatus[]).map((k) => ({ value: k, label: r.statuses[k] }))]}
      />
      {routes.isPending ? <p role="status">{m.common.loading}</p> : null}
      {routes.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {routes.data && routes.data.items.length === 0 ? <Alert tone="info">{r.empty}</Alert> : null}
      <ul className="list-plain" aria-label={r.title}>
        {routes.data?.items.map((route) => (
          <li key={route.id} className="card" data-testid="route-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  <span className="mono">{route.reference}</span> <span className={`badge${routeTone(route.status)}`}>{r.statuses[route.status]}</span>
                </h2>
                <p style={{ margin: 0 }}>
                  {route.plannedDate} · {route.agency.name} ({route.agency.city}) · {route.driver.name} · {route.stopCount} {r.stops}
                </p>
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/account/staff/${base}/${route.id}`)} aria-label={`${m.finance.common.open} : ${route.reference}`}>
                {m.finance.common.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {!mine && canSettings ? <SettingsSection /> : null}
    </>
  );
}
