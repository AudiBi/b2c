import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { FAILURE_REASONS, FAILED_ATTEMPTS_ALERT, addStopSchema, failDeliverySchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { HandoverForm } from '../delivery/HandoverForm';
import { deliveryKeys, useRoute, type RouteDetail, type RouteStopItem, type StopStatus } from '../delivery/queries';
import { routeTone } from './StaffRoutesPage';
import { useAgencyPackages, useCan } from './queries';

const stopTone = (status: StopStatus) => (status === 'DELIVERED' ? ' badge-success' : status === 'FAILED' ? ' badge-danger' : '');

function FailForm({ onSubmit, onCancel }: { onSubmit(body: Record<string, unknown>): Promise<void>; onCancel(): void }) {
  const { m } = useI18n();
  const f = m.delivery.staff.routes.fail;
  const [reason, setReason] = useState<string>(FAILURE_REASONS[0]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = failDeliverySchema.safeParse({ reason, note: note.trim() === '' ? undefined : note.trim(), rescheduleFor: date.trim() === '' ? undefined : date.trim() });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate aria-label={f.title}>
      <h4 style={{ fontSize: '1rem' }}>{f.title}</h4>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <SelectField name="failReason" label={f.reason} value={reason} onChange={setReason} options={FAILURE_REASONS.map((x) => ({ value: x, label: m.delivery.failureReasons[x] }))} error={errors.reason} />
      <TextField name="failNote" label={f.note} optional value={note} onChange={setNote} error={errors.note} />
      <TextField name="failDate" label={f.reschedule} optional hint={f.rescheduleHint} value={date} onChange={setDate} error={errors.rescheduleFor} />
      <div className="form-actions">
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? m.common.saving : f.submit}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function StopCard({ route, stop, canOverride, canRemove, onChanged, onMessage }: { route: RouteDetail; stop: RouteStopItem; canOverride: boolean; canRemove: boolean; onChanged(): Promise<unknown>; onMessage(text: string): void }) {
  const { m, lang } = useI18n();
  const r = m.delivery.staff.routes;
  const [panel, setPanel] = useState<null | 'deliver' | 'fail'>(null);
  const a = stop.address;
  const active = route.status === 'IN_PROGRESS' && stop.status === 'PENDING';
  const balance = stop.balanceDue !== null && (Number(stop.balanceDue) > 0 || stop.unbilled) ? { due: stop.balanceDue, currency: stop.balanceCurrency, unbilled: stop.unbilled } : null;

  async function remove() {
    try {
      await api(`/v1/admin/routes/${route.id}/stops/${stop.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      onMessage(apiErrorMessage(e, m));
    }
  }

  return (
    <li className="card" data-testid="route-stop">
      <div className="row-card">
        <div>
          <h3 style={{ fontSize: '1.05rem' }}>
            {stop.sequence}. <span className="mono">{stop.package.trackingNumberDisplay}</span> <span className={`badge${stopTone(stop.status)}`}>{r.stopStatuses[stop.status]}</span>
          </h3>
          <p style={{ margin: 0 }}>
            {stop.customer.name} ({stop.customer.customerCode}){stop.customer.phone ? ` · ${stop.customer.phone}` : ''}
          </p>
          {a ? (
            <p style={{ margin: '4px 0 0' }}>
              {a.recipientName ? `${a.recipientName}, ` : ''}
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ''}, {a.city}
              {a.phone ? ` · ${a.phone}` : ''}
            </p>
          ) : null}
          {stop.instructions ? <p className="muted" style={{ margin: '4px 0 0' }}>{stop.instructions}</p> : null}
          {stop.package.description ? <p className="muted" style={{ margin: '4px 0 0' }}>{stop.package.description}</p> : null}
          {balance ? (
            <p style={{ margin: '4px 0 0' }}>
              <span className="badge badge-warning">{stop.unbilled ? r.unbilled : format(r.balance, { amount: formatMoney(balance.due, balance.currency ?? 'USD', lang) })}</span>
            </p>
          ) : null}
        </div>
        <div className="form-actions">
          {active ? (
            <>
              <Button size="sm" aria-label={`${r.deliver} : ${stop.package.trackingNumberDisplay}`} onClick={() => setPanel(panel === 'deliver' ? null : 'deliver')}>
                {r.deliver}
              </Button>
              <Button variant="outline" size="sm" aria-label={`${r.failAction} : ${stop.package.trackingNumberDisplay}`} onClick={() => setPanel(panel === 'fail' ? null : 'fail')}>
                {r.failAction}
              </Button>
            </>
          ) : null}
          {route.status === 'PLANNED' && canRemove && stop.status === 'PENDING' ? (
            <Button variant="ghost" size="sm" aria-label={`${r.removeStop} : ${stop.package.trackingNumberDisplay}`} onClick={remove}>
              {r.removeStop}
            </Button>
          ) : null}
        </div>
      </div>
      {panel === 'deliver' ? (
        <HandoverForm
          packageId={stop.package.id}
          settings={route.settings}
          beneficiaries={stop.beneficiaries}
          balance={balance ? { ...balance, currency: balance.currency } : null}
          canOverride={canOverride}
          submitLabel={r.confirmHandover}
          onSubmit={async (body) => {
            await api(`/v1/admin/route-stops/${stop.id}/deliver`, { method: 'POST', body });
            setPanel(null);
            onMessage(r.delivered);
            await onChanged();
          }}
        />
      ) : null}
      {panel === 'fail' ? (
        <FailForm
          onCancel={() => setPanel(null)}
          onSubmit={async (body) => {
            const res = await api<{ failedAttempts: number; returnSuggested: boolean }>(`/v1/admin/route-stops/${stop.id}/fail`, { method: 'POST', body });
            setPanel(null);
            onMessage(res.returnSuggested ? format(r.failedReturn, { count: res.failedAttempts, max: FAILED_ATTEMPTS_ALERT }) : r.failed);
            await onChanged();
          }}
        />
      ) : null}
    </li>
  );
}

function AddStop({ route, onChanged, onMessage }: { route: RouteDetail; onChanged(): Promise<unknown>; onMessage(text: string): void }) {
  const { m } = useI18n();
  const r = m.delivery.staff.routes;
  const inventory = useAgencyPackages(route.agency.id);
  const taken = new Set(route.stops.map((s) => s.package.id));
  const candidates = (inventory.data?.items ?? []).filter((p) => ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP'].includes(p.status) && !taken.has(p.id));
  const [packageId, setPackageId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = addStopSchema.safeParse({ packageId, instructions: instructions.trim() === '' ? undefined : instructions.trim() });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(`/v1/admin/routes/${route.id}/stops`, { method: 'POST', body: parsed.data });
      setPackageId('');
      setInstructions('');
      onMessage(r.stopAdded);
      await onChanged();
    } catch (e) {
      onMessage(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={r.addStop}>
      <h2 style={{ fontSize: '1.1rem' }}>{r.addStop}</h2>
      {inventory.data && candidates.length === 0 ? <p className="muted">{r.noCandidate}</p> : null}
      <SelectField
        name="stopPackage"
        label={r.package}
        value={packageId}
        onChange={setPackageId}
        error={errors.packageId}
        options={[{ value: '', label: '—' }, ...candidates.map((p) => ({ value: p.id, label: `${p.trackingNumberDisplay}${p.customer ? ` · ${p.customer.name ?? p.customer.customerCode}` : ''}` }))]}
      />
      <TextField name="stopInstructions" label={r.instructions} optional value={instructions} onChange={setInstructions} error={errors.instructions} />
      <div className="form-actions">
        <Button type="submit" disabled={busy || candidates.length === 0}>
          {r.addStopSubmit}
        </Button>
      </div>
    </form>
  );
}

/** Détail d'une tournée : arrêts, départ, remise ou échec par arrêt. `mine` : vue du livreur. */
export function StaffRouteDetailPage({ mine = false }: { mine?: boolean }) {
  const { id = '' } = useParams();
  const { m, lang } = useI18n();
  const r = m.delivery.staff.routes;
  const queryClient = useQueryClient();
  const query = useRoute(id, mine);
  const canAssign = useCan('delivery:assign');
  const canOverride = useCan('delivery:override_balance');
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | 'cancel'>(null);
  const data = query.data;
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: deliveryKeys.routes }), queryClient.invalidateQueries({ queryKey: deliveryKeys.myRoutes })]);

  async function act(action: 'start' | 'complete' | 'cancel', success: string) {
    setMessage(null);
    try {
      await api(`/v1/admin/routes/${id}/${action}`, { method: 'POST' });
      setConfirming(null);
      setMessage(success);
      await refresh();
    } catch (e) {
      setMessage(apiErrorMessage(e, m));
    }
  }

  return (
    <>
      <p>
        <Link to={localizedPath(lang, `/${mine ? 'my-routes' : 'routes'}`)}>← {m.finance.common.back}</Link>
      </p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.auth.errors.ROUTE_NOT_FOUND}</Alert> : null}
      {data ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            <span className="mono">{data.reference}</span> <span className={`badge${routeTone(data.status)}`}>{r.statuses[data.status]}</span>
          </h1>
          <p>
            {data.plannedDate} · {data.agency.name} ({data.agency.city}) · {data.driver.name}
          </p>
          {data.notes ? <p className="muted">{data.notes}</p> : null}
          {message ? (
            <div aria-live="polite">
              <FormMessage tone="info">{message}</FormMessage>
            </div>
          ) : null}
          {!mine && canAssign ? (
            <div className="form-actions">
              {data.status === 'PLANNED' ? <Button onClick={() => act('start', r.started)}>{r.start}</Button> : null}
              {data.status === 'IN_PROGRESS' ? <Button onClick={() => act('complete', r.completed)}>{r.complete}</Button> : null}
              {data.status === 'PLANNED' ? (
                confirming === 'cancel' ? (
                  <Button variant="danger" onClick={() => act('cancel', r.cancelled)}>
                    {r.confirmCancel}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirming('cancel')}>
                    {r.cancel}
                  </Button>
                )
              ) : null}
            </div>
          ) : null}
          {data.stops.length === 0 ? <Alert tone="info">{r.noStops}</Alert> : null}
          <ul className="list-plain" aria-label={r.stops}>
            {data.stops.map((stop) => (
              <StopCard key={stop.id} route={data} stop={stop} canOverride={canOverride} canRemove={!mine && canAssign} onChanged={refresh} onMessage={setMessage} />
            ))}
          </ul>
          {!mine && canAssign && data.status === 'PLANNED' ? <AddStop route={data} onChanged={refresh} onMessage={setMessage} /> : null}
        </>
      ) : null}
    </>
  );
}
