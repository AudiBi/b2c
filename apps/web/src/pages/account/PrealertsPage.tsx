import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { createPrealertSchema, updatePrealertSchema, CURRENCIES } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime, formatMoney, parseDecimal } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, RadioGroupField, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { FilesPanel } from './FilesPanel';
import { accountKeys, useReceiving, usePrealerts, type Prealert, type TransportMode } from './queries';

interface FormValues {
  storeName: string;
  orderNumber: string;
  supplierTracking: string;
  warehouseId: string;
  transportMode: TransportMode;
  purchaseAmount: string;
  purchaseCurrency: string;
  description: string;
}

function PrealertForm({ initial, onDone, onSaved }: { initial?: Prealert; onDone(): void; onSaved(message: string): void }) {
  const { m } = useI18n();
  const p = m.account.prealerts;
  const f = p.fields;
  const queryClient = useQueryClient();
  const receiving = useReceiving();
  const warehouses = receiving.data?.warehouses ?? [];

  const [values, setValues] = useState<FormValues>({
    storeName: initial?.storeName ?? '',
    orderNumber: initial?.orderNumber ?? '',
    supplierTracking: initial?.supplierTracking ?? '',
    warehouseId: initial?.warehouse.id ?? '',
    transportMode: initial?.transportMode ?? 'AIR',
    purchaseAmount: initial ? String(Number(initial.purchaseAmount)) : '',
    purchaseCurrency: initial?.purchaseCurrency ?? 'USD',
    description: initial?.description ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormValues>(name: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => {
      const { [name]: _removed, ...rest } = e;
      return rest;
    });
  };
  const warehouseId = values.warehouseId || warehouses[0]?.id || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const manual: FieldErrors = {};
    const amount = values.purchaseAmount.trim() === '' ? undefined : parseDecimal(values.purchaseAmount);
    if (values.purchaseAmount.trim() !== '' && amount === null) manual.purchaseAmount = m.validation.number;

    const text = (x: string) => (x.trim() === '' ? undefined : x.trim());
    const common = {
      storeName: text(values.storeName),
      orderNumber: text(values.orderNumber),
      supplierTracking: text(values.supplierTracking),
      transportMode: values.transportMode,
      purchaseAmount: amount ?? undefined,
      purchaseCurrency: values.purchaseCurrency,
      description: text(values.description),
    };
    const parsed = initial ? updatePrealertSchema.safeParse(common) : createPrealertSchema.safeParse({ ...common, warehouseId });
    const issues = parsed.success ? {} : issuesToErrors(parsed.error, m);
    const all = { ...issues, ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      if (initial) {
        await api(`/v1/me/prealerts/${initial.id}`, { method: 'PATCH', body: parsed.data });
        onSaved(p.updated);
      } else {
        const created = await api<Prealert>('/v1/me/prealerts', { method: 'POST', body: parsed.data });
        onSaved(format(p.created, { tracking: created.package.trackingNumber }));
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: accountKeys.prealerts }), queryClient.invalidateQueries({ queryKey: accountKeys.packages })]);
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={initial ? p.edit : p.add}>
      <h2 style={{ fontSize: '1.2rem' }}>{initial ? p.edit : p.add}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {receiving.isPending ? <p role="status">{m.common.loading}</p> : null}
      {!initial && receiving.data && warehouses.length === 0 ? <Alert tone="info">{p.noWarehouse}</Alert> : null}

      <div className="form-grid form-grid-2">
        <TextField name="storeName" label={f.storeName} value={values.storeName} onChange={(x) => set('storeName', x)} error={errors.storeName} />
        <TextField name="orderNumber" label={f.orderNumber} optional value={values.orderNumber} onChange={(x) => set('orderNumber', x)} error={errors.orderNumber} />
      </div>
      <TextField
        name="supplierTracking"
        label={f.supplierTracking}
        optional
        hint={f.supplierTrackingHint}
        value={values.supplierTracking}
        onChange={(x) => set('supplierTracking', x)}
        error={errors.supplierTracking}
        autoCapitalize="characters"
        spellCheck={false}
      />
      {initial ? (
        <p className="muted">
          {f.warehouse} : {initial.warehouse.name} ({initial.warehouse.city})
        </p>
      ) : (
        <SelectField
          name="warehouseId"
          label={f.warehouse}
          value={warehouseId}
          onChange={(x) => set('warehouseId', x)}
          error={errors.warehouseId}
          options={warehouses.map((w) => ({ value: w.id, label: `${w.name} (${w.city})` }))}
        />
      )}
      <RadioGroupField
        legend={f.mode}
        name="transportMode"
        value={values.transportMode}
        onChange={(x) => set('transportMode', x as TransportMode)}
        options={[
          { value: 'AIR', label: f.modes.AIR },
          { value: 'SEA', label: f.modes.SEA },
        ]}
      />
      <div className="form-grid form-grid-2">
        <TextField name="purchaseAmount" label={f.amount} inputMode="decimal" value={values.purchaseAmount} onChange={(x) => set('purchaseAmount', x)} error={errors.purchaseAmount} />
        <SelectField name="purchaseCurrency" label={f.currency} value={values.purchaseCurrency} onChange={(x) => set('purchaseCurrency', x)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </div>
      <TextAreaField name="description" label={f.description} value={values.description} onChange={(x) => set('description', x)} error={errors.description} />
      <div className="form-actions">
        <Button type="submit" disabled={busy || (!initial && warehouses.length === 0)}>
          {busy ? m.common.saving : m.common.save}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

export function PrealertsPage() {
  const { m, lang } = useI18n();
  const p = m.account.prealerts;
  const queryClient = useQueryClient();
  const prealerts = usePrealerts();
  const [mode, setMode] = useState<{ type: 'idle' } | { type: 'add' } | { type: 'edit'; prealert: Prealert }>({ type: 'idle' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setError(null);
    try {
      await api(`/v1/me/prealerts/${id}`, { method: 'DELETE' });
      await Promise.all([queryClient.invalidateQueries({ queryKey: accountKeys.prealerts }), queryClient.invalidateQueries({ queryKey: accountKeys.packages })]);
      setNotice(p.cancelled);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setConfirming(null);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{p.title}</h1>
      <p className="lead">{p.lead}</p>
      <div aria-live="polite">
        {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      </div>

      {mode.type === 'add' ? <PrealertForm onDone={() => setMode({ type: 'idle' })} onSaved={setNotice} /> : null}
      {mode.type === 'edit' ? <PrealertForm initial={mode.prealert} onDone={() => setMode({ type: 'idle' })} onSaved={setNotice} /> : null}
      {mode.type === 'idle' ? (
        <p>
          <Button
            onClick={() => {
              setNotice(null);
              setError(null);
              setMode({ type: 'add' });
            }}
          >
            {p.add}
          </Button>
        </p>
      ) : null}

      {prealerts.isPending ? <p role="status">{m.common.loading}</p> : null}
      {prealerts.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {prealerts.data && prealerts.data.items.length === 0 ? <Alert tone="info">{p.empty}</Alert> : null}
      <ul className="list-plain">
        {prealerts.data?.items.map((item) => {
          const open = item.status === 'OPEN';
          return (
            <li key={item.id} className="card" data-testid="prealert-item">
              <div className="row-card">
                <div>
                  <h2 style={{ fontSize: '1.1rem' }}>
                    {item.storeName} <span className={`badge${item.status === 'CANCELLED' ? ' badge-danger' : item.status === 'OPEN' ? '' : ' badge-success'}`}>{p.status[item.status]}</span>
                  </h2>
                  <p style={{ margin: 0 }}>{item.description}</p>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    {formatMoney(item.purchaseAmount, item.purchaseCurrency, lang)} · {p.fields.modes[item.transportMode]} · {item.warehouse.city} · {formatDateTime(item.createdAt, lang)}
                  </p>
                  <p style={{ margin: '8px 0 0' }}>
                    {p.trackingNumber} : <span className="mono" data-testid="prealert-tracking">{item.package.trackingNumber}</span>
                  </p>
                </div>
                <div className="form-actions">
                  <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/account/packages/${item.package.id}`)}>
                    {p.viewPackage}
                  </Link>
                  {open ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`${m.common.edit} : ${item.storeName}`}
                      onClick={() => {
                        setNotice(null);
                        setMode({ type: 'edit', prealert: item });
                      }}
                    >
                      {m.common.edit}
                    </Button>
                  ) : null}
                  {open ? (
                    confirming === item.id ? (
                      <Button variant="danger" size="sm" onClick={() => cancel(item.id)}>
                        {p.confirmCancel}
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" aria-label={`${p.cancel} : ${item.storeName}`} onClick={() => setConfirming(item.id)}>
                        {p.cancel}
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
              <FilesPanel ownerType="PREALERT" ownerId={item.id} kind="INVOICE" title={p.invoice.title} editable={open} emptyText={p.invoice.none} />
              {!open ? <p className="muted">{p.lockedNote}</p> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
