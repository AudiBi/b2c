import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { findTransition, HOLD_REASON_CODES, PACKAGE_STATUSES, registerPackageSchema, type PackageStatus } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime, formatMoney, formatWeight, parseDecimal } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, RadioGroupField, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { StatusBadge, statusLabel } from '../../components/PackageParts';
import { FilesPanel } from '../account/FilesPanel';
import { HandoverPanel } from '../delivery/HandoverPanel';
import { staffKeys, useAgencies, useCan, useLocations, useStaffPackage, type StaffPackageDetail, type TransportMode } from './queries';

/** Cadre d'action avec son propre message de succès ou d'erreur, annoncé aux lecteurs d'écran. */
function Panel({ title, children, notice, error }: { title: string; children: ReactNode; notice: string | null; error: string | null }) {
  return (
    <section className="card form" aria-label={title}>
      <h2 style={{ fontSize: '1.1rem' }}>{title}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {children}
    </section>
  );
}

function useActionState() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return { notice, error, busy, setNotice, setError, setBusy };
}

export function StaffPackageDetailPage() {
  const { m, lang } = useI18n();
  const s = m.staff;
  const d = s.package;
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const query = useStaffPackage(id);
  const pkg = query.data;
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: staffKeys.packages }), queryClient.invalidateQueries({ queryKey: ['staff', 'inventory'] })]);

  return (
    <>
      <p>
        <Link to={localizedPath(lang, '/account/staff/packages')}>← {d.back}</Link>
      </p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.auth.errors.PACKAGE_NOT_FOUND}</Alert> : null}
      {pkg ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            <span className="mono" data-testid="staff-package-tracking">{pkg.trackingNumberDisplay}</span>
          </h1>
          <p>
            <StatusBadge status={pkg.status} />{' '}
            {pkg.customer ? format(d.customerLine, { name: pkg.customer.name ?? '', code: pkg.customer.customerCode }) : <span className="badge badge-warning">{s.common.unidentified}</span>}
          </p>
          <div className="card">
            <dl className="kv">
              <dt>{s.common.warehouse}</dt>
              <dd>{pkg.warehouse.name}</dd>
              {pkg.supplierTracking ? (<><dt>{m.account.packages.detail.supplierTracking}</dt><dd className="mono">{pkg.supplierTracking}</dd></>) : null}
              {pkg.transportMode ? (<><dt>{s.common.mode}</dt><dd>{s.common.modes[pkg.transportMode]}</dd></>) : null}
              {pkg.contentDescription ? (<><dt>{s.common.note}</dt><dd>{pkg.contentDescription}</dd></>) : null}
              {pkg.measures.actualWeightKg ? (<><dt>{m.account.packages.detail.actualWeight}</dt><dd>{formatWeight(pkg.measures.actualWeightKg, 'KG', lang)}</dd></>) : null}
              {pkg.measures.billableWeight && pkg.measures.weightUnit ? (<><dt>{m.account.packages.detail.billableWeight}</dt><dd>{formatWeight(pkg.measures.billableWeight, pkg.measures.weightUnit, lang)}</dd></>) : null}
              {pkg.declaredValue && pkg.declaredCurrency ? (<><dt>{d.weigh.declared}</dt><dd>{formatMoney(pkg.declaredValue, pkg.declaredCurrency, lang)}</dd></>) : null}
            </dl>
            {pkg.prealert ? <p className="muted">{format(d.prealertLine, { store: pkg.prealert.storeName, amount: pkg.prealert.purchaseAmount, currency: pkg.prealert.purchaseCurrency })}</p> : null}
          </div>

          <IdentifyPanel pkg={pkg} onDone={refresh} />
          <WeighPanel pkg={pkg} onDone={refresh} />
          <TransitionPanel pkg={pkg} onDone={refresh} />
          <LocationPanel pkg={pkg} onDone={refresh} />
          <AgencyPanel pkg={pkg} onDone={refresh} />
          <HandoverPanel packageId={pkg.id} status={pkg.status} onDone={refresh} />
          <NotePanel pkg={pkg} onDone={refresh} />

          <section className="card">
            <FilesPanel ownerType="PACKAGE" ownerId={pkg.id} kind="PHOTO" title={d.photos} editable={true} emptyText={d.noPhotos} />
          </section>

          <section className="card" aria-label={d.history}>
            <h2 style={{ fontSize: '1.1rem' }}>{d.history}</h2>
            <ol className="timeline" aria-label={d.history} data-testid="staff-history">
              {pkg.events.slice().reverse().map((e) => (
                <li key={e.id}>
                  <strong>{e.to ? statusLabel(m, e.to) : e.type}</strong> <span className="badge">{e.visibility === 'PUBLIC' ? d.public : d.internal}</span>
                  {e.reason ? <span className="muted"> — {e.reason}</span> : null}
                  <br />
                  <span className="muted">
                    {e.type} · {formatDateTime(e.occurredAt, lang)}
                    {e.location ? ` · ${e.location}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </>
  );
}

// -------------------------------------------------------------------------------------------------
type PanelProps = { pkg: StaffPackageDetail; onDone(): Promise<unknown> };

function IdentifyPanel({ pkg, onDone }: PanelProps) {
  const { m } = useI18n();
  const d = m.staff.package.identify;
  const can = useCan('package:update');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'' | TransportMode>('');
  const st = useActionState();
  if (pkg.customer || !can || !['RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION'].includes(pkg.status)) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    st.setError(null);
    st.setNotice(null);
    st.setBusy(true);
    try {
      await api(`/v1/admin/packages/${pkg.id}/identify`, { method: 'POST', body: { customerCode: code.trim().toUpperCase(), ...(mode ? { transportMode: mode } : {}) } });
      setCode('');
      st.setNotice(d.done);
      await onDone();
    } catch (e) {
      st.setError(apiErrorMessage(e, m));
    } finally {
      st.setBusy(false);
    }
  }
  return (
    <Panel title={d.title} notice={st.notice} error={st.error}>
      <form onSubmit={submit} className="form" noValidate>
        <TextField name="customerCode" label={d.code} value={code} onChange={setCode} autoCapitalize="characters" spellCheck={false} />
        <RadioGroupField legend={m.staff.common.mode} name="identifyMode" value={mode} onChange={(x) => setMode(x as '' | TransportMode)} options={[{ value: '', label: m.staff.common.none }, { value: 'AIR', label: m.staff.common.modes.AIR }, { value: 'SEA', label: m.staff.common.modes.SEA }]} />
        <div className="form-actions"><Button type="submit" disabled={st.busy || code.trim() === ''}>{d.submit}</Button></div>
      </form>
    </Panel>
  );
}

function WeighPanel({ pkg, onDone }: PanelProps) {
  const { m } = useI18n();
  const d = m.staff.package.weigh;
  const can = useCan('package:register');
  const [v, setV] = useState({ weight: '', weightUnit: 'KG', length: '', width: '', height: '', dimensionUnit: 'CM', declared: '', description: '', mode: '' as '' | TransportMode });
  const [errors, setErrors] = useState<FieldErrors>({});
  const st = useActionState();
  if (!can || !pkg.customer || !['RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION'].includes(pkg.status)) return null;
  const set = (name: keyof typeof v, value: string) => {
    setV((c) => ({ ...c, [name]: value }));
    setErrors((c) => {
      const next = { ...c };
      for (const key of Object.keys(next)) if (key.split('.').pop() === name || key === name) delete next[key];
      return next;
    });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    st.setError(null);
    st.setNotice(null);
    const manual: FieldErrors = {};
    const num = (key: string, text: string): number | undefined => {
      if (text.trim() === '') return undefined;
      const n = parseDecimal(text);
      if (n === null) manual[key] = m.validation.number;
      return n ?? undefined;
    };
    const payload = {
      weight: { value: num('weight.value', v.weight), unit: v.weightUnit },
      dimensions: { length: num('dimensions.length', v.length), width: num('dimensions.width', v.width), height: num('dimensions.height', v.height), unit: v.dimensionUnit },
      ...(v.description.trim() ? { contentDescription: v.description.trim() } : {}),
      ...(num('declaredValue', v.declared) !== undefined ? { declaredValue: num('declaredValue', v.declared) } : {}),
      ...(v.mode ? { transportMode: v.mode } : {}),
    };
    const parsed = registerPackageSchema.safeParse(payload);
    const all = { ...(parsed.success ? {} : issuesToErrors(parsed.error, m)), ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      st.setError(m.common.fixErrors);
      return;
    }
    st.setBusy(true);
    try {
      await api(`/v1/admin/packages/${pkg.id}/register`, { method: 'POST', body: parsed.data });
      st.setNotice(d.done);
      await onDone();
    } catch (e) {
      st.setError(apiErrorMessage(e, m));
    } finally {
      st.setBusy(false);
    }
  }

  const unitOptions = (a: 'KG' | 'LB' | 'CM' | 'IN', b: 'KG' | 'LB' | 'CM' | 'IN') => [{ value: a, label: d.units[a] }, { value: b, label: d.units[b] }];
  return (
    <Panel title={d.title} notice={st.notice} error={st.error}>
      <form onSubmit={submit} className="form" noValidate>
        <div className="form-grid form-grid-2" style={{ alignItems: 'start' }}>
          <TextField name="weight" label={d.weight} inputMode="decimal" value={v.weight} onChange={(x) => set('weight', x)} error={errors['weight.value']} />
          <RadioGroupField legend={d.weightUnit} name="weightUnit" value={v.weightUnit} onChange={(x) => set('weightUnit', x)} options={unitOptions('KG', 'LB')} />
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
          <TextField name="length" label={d.length} inputMode="decimal" value={v.length} onChange={(x) => set('length', x)} error={errors['dimensions.length']} />
          <TextField name="width" label={d.width} inputMode="decimal" value={v.width} onChange={(x) => set('width', x)} error={errors['dimensions.width']} />
          <TextField name="height" label={d.height} inputMode="decimal" value={v.height} onChange={(x) => set('height', x)} error={errors['dimensions.height']} />
        </div>
        <RadioGroupField legend={d.dimensionUnit} name="dimensionUnit" value={v.dimensionUnit} onChange={(x) => set('dimensionUnit', x)} options={unitOptions('CM', 'IN')} />
        {!pkg.transportMode ? (
          <RadioGroupField legend={m.staff.common.mode} name="weighMode" value={v.mode} onChange={(x) => set('mode', x)} options={[{ value: 'AIR', label: m.staff.common.modes.AIR }, { value: 'SEA', label: m.staff.common.modes.SEA }]} />
        ) : null}
        <TextField name="declared" label={d.declared} optional inputMode="decimal" value={v.declared} onChange={(x) => set('declared', x)} error={errors.declaredValue} />
        <TextAreaField name="description" label={d.description} optional value={v.description} onChange={(x) => set('description', x)} error={errors.contentDescription} />
        <div className="form-actions"><Button type="submit" disabled={st.busy}>{d.submit}</Button></div>
      </form>
    </Panel>
  );
}

function TransitionPanel({ pkg, onDone }: PanelProps) {
  const { m } = useI18n();
  const d = m.staff.package.transition;
  const { user } = useAuth();
  const [target, setTarget] = useState('');
  const [holdReason, setHoldReason] = useState('OTHER');
  const [reason, setReason] = useState('');
  const st = useActionState();

  // Seules les transitions que l'API générique accepte (colis et facturation) et que l'utilisateur peut espérer faire
  const options = PACKAGE_STATUSES.map((to) => findTransition(pkg.status as PackageStatus, to, pkg.previousStatus as PackageStatus | null))
    .filter((rule): rule is NonNullable<typeof rule> => !!rule && (rule.owner === 'PACKAGES' || rule.owner === 'BILLING') && !!rule.permission)
    // La pesée et la réception ont leurs propres écrans ; seule la reprise d'une retenue y ramène
    .filter((rule) => (rule.to !== 'REGISTERED_WEIGHED' && rule.to !== 'RECEIVED_AT_WAREHOUSE') || rule.from === 'ON_HOLD')
    .filter((rule) => user?.permissions.includes(rule.permission as string));
  if (options.length === 0) return null;
  const rule = options.find((o) => o.to === target) ?? options[0];

  async function submit(event: FormEvent) {
    event.preventDefault();
    st.setError(null);
    st.setNotice(null);
    if (rule.reasonRequired && reason.trim() === '') {
      st.setError(d.reasonRequired);
      return;
    }
    st.setBusy(true);
    try {
      await api(`/v1/admin/packages/${pkg.id}/transitions`, {
        method: 'POST',
        body: { to: rule.to, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(rule.to === 'ON_HOLD' ? { holdReasonCode: holdReason } : {}) },
      });
      setReason('');
      setTarget('');
      st.setNotice(d.done);
      await onDone();
    } catch (e) {
      st.setError(apiErrorMessage(e, m));
    } finally {
      st.setBusy(false);
    }
  }
  return (
    <Panel title={d.title} notice={st.notice} error={st.error}>
      <form onSubmit={submit} className="form" noValidate>
        <SelectField name="target" label={d.target} value={rule.to} onChange={setTarget} options={options.map((o) => ({ value: o.to, label: statusLabel(m, o.to) }))} />
        {rule.to === 'ON_HOLD' ? (
          <SelectField name="holdReason" label={d.holdReason} value={holdReason} onChange={setHoldReason} options={HOLD_REASON_CODES.map((c) => ({ value: c, label: (m.holdReasons as Record<string, string>)[c] }))} />
        ) : null}
        <TextAreaField name="reason" label={m.staff.common.reason} optional={!rule.reasonRequired} value={reason} onChange={setReason} />
        <div className="form-actions"><Button type="submit" disabled={st.busy}>{d.submit}</Button></div>
      </form>
    </Panel>
  );
}

function LocationPanel({ pkg, onDone }: PanelProps) {
  const { m } = useI18n();
  const d = m.staff.package.location;
  const can = useCan('warehouse:move');
  const locations = useLocations(pkg.warehouse.id);
  const [choice, setChoice] = useState('');
  const st = useActionState();
  const inWarehouse = ['RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION', 'REGISTERED_WEIGHED', 'AWAITING_PAYMENT', 'READY_TO_SHIP', 'ON_HOLD'].includes(pkg.status);
  const active = (locations.data?.items ?? []).filter((l) => l.status === 'ACTIVE');
  if (!can || !inWarehouse || active.length === 0) return null;
  const current = active.find((l) => l.id === pkg.locationId);

  async function move(locationId: string | null) {
    st.setError(null);
    st.setNotice(null);
    st.setBusy(true);
    try {
      await api(`/v1/admin/packages/${pkg.id}/move`, { method: 'POST', body: { locationId } });
      st.setNotice(d.done);
      await onDone();
    } catch (e) {
      st.setError(apiErrorMessage(e, m));
    } finally {
      st.setBusy(false);
    }
  }
  return (
    <Panel title={d.title} notice={st.notice} error={st.error}>
      <p style={{ margin: 0 }}>{d.current} : <strong data-testid="current-location">{current?.code ?? d.none}</strong></p>
      <SelectField name="location" label={d.choose} value={choice || active[0].id} onChange={setChoice} options={active.map((l) => ({ value: l.id, label: l.code }))} />
      <div className="form-actions">
        <Button disabled={st.busy} onClick={() => move(choice || active[0].id)}>{d.submit}</Button>
        {pkg.locationId ? <Button variant="outline" disabled={st.busy} onClick={() => move(null)}>{d.remove}</Button> : null}
      </div>
    </Panel>
  );
}

function AgencyPanel({ pkg, onDone }: PanelProps) {
  const { m } = useI18n();
  const d = m.staff.package.agency;
  const can = useCan('package:update');
  const agencies = useAgencies();
  const [choice, setChoice] = useState('');
  const st = useActionState();
  const list = (agencies.data?.items ?? []).filter((a) => a.country === pkg.destinationCountry);
  const locked = ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED'].includes(pkg.status);
  if (!can || locked || list.length === 0) return null;
  const current = list.find((a) => a.id === pkg.destinationAgencyId);

  async function assign(agencyId: string | null) {
    st.setError(null);
    st.setNotice(null);
    st.setBusy(true);
    try {
      await api(`/v1/admin/packages/${pkg.id}/agency`, { method: 'POST', body: { agencyId } });
      st.setNotice(d.done);
      await onDone();
    } catch (e) {
      st.setError(apiErrorMessage(e, m));
    } finally {
      st.setBusy(false);
    }
  }
  return (
    <Panel title={d.title} notice={st.notice} error={st.error}>
      <p style={{ margin: 0 }}>{d.current} : <strong data-testid="current-agency">{current?.name ?? m.staff.common.none}</strong></p>
      <SelectField name="agency" label={d.choose} value={choice || list[0].id} onChange={setChoice} options={list.map((a) => ({ value: a.id, label: `${a.name} (${a.city})` }))} />
      <div className="form-actions">
        <Button disabled={st.busy} onClick={() => assign(choice || list[0].id)}>{d.submit}</Button>
        {pkg.destinationAgencyId ? <Button variant="outline" disabled={st.busy} onClick={() => assign(null)}>{d.remove}</Button> : null}
      </div>
    </Panel>
  );
}

function NotePanel({ pkg, onDone }: PanelProps) {
  const { m } = useI18n();
  const d = m.staff.package.note;
  const can = useCan('package:update');
  const [note, setNote] = useState('');
  const st = useActionState();
  if (!can) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    st.setError(null);
    st.setNotice(null);
    st.setBusy(true);
    try {
      await api(`/v1/admin/packages/${pkg.id}/notes`, { method: 'POST', body: { note: note.trim() } });
      setNote('');
      st.setNotice(d.done);
      await onDone();
    } catch (e) {
      st.setError(apiErrorMessage(e, m));
    } finally {
      st.setBusy(false);
    }
  }
  return (
    <Panel title={d.title} notice={st.notice} error={st.error}>
      <form onSubmit={submit} className="form" noValidate>
        <TextAreaField name="note" label={d.label} value={note} onChange={setNote} />
        <div className="form-actions"><Button type="submit" disabled={st.busy || note.trim() === ''}>{d.submit}</Button></div>
      </form>
    </Panel>
  );
}
