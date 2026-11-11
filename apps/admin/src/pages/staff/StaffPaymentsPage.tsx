import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CURRENCIES, closeCashSessionSchema, exportQuerySchema, financeSettingsSchema, openCashSessionSchema, rejectPaymentSchema } from '@b2c/shared';
import { api, apiDownload } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatDateTime, formatAmount, formatMoney, parseDecimal } from '../../lib/format';
import { saveBlob } from '../../lib/download';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { PaymentBadge } from '../finance/FinanceParts';
import { financeKeys, useCashSessions, useFinanceSettings, useStaffPayments, type FinanceSummary } from '../finance/queries';
import { useAgencies, useCan } from './queries';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

function Queue() {
  const { m, lang } = useI18n();
  const s = m.finance.staff.payments;
  const canReconcile = useCan('payment:reconcile');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const payments = useStaffPayments(status);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(paymentId: string, action: 'confirm' | 'reject', body: unknown) {
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/admin/payments/${paymentId}/${action}`, { method: 'POST', body });
      await Promise.all([queryClient.invalidateQueries({ queryKey: financeKeys.payments }), queryClient.invalidateQueries({ queryKey: financeKeys.invoices })]);
      setNotice(action === 'confirm' ? m.finance.staff.invoice.confirmed : m.finance.staff.invoice.rejected);
      setRejecting(null);
      setReason('');
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  function reject(event: FormEvent, paymentId: string) {
    event.preventDefault();
    const parsed = rejectPaymentSchema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setReasonError(issuesToErrors(parsed.error, m).reason);
      return;
    }
    setReasonError(undefined);
    void act(paymentId, 'reject', parsed.data);
  }

  return (
    <section aria-labelledby="queue-title">
      <h2 id="queue-title" style={{ fontSize: '1.4rem' }}>{s.queue}</h2>
      <SelectField
        name="paymentStatus"
        label={s.statusFilter}
        value={status}
        onChange={setStatus}
        options={[{ value: '', label: m.finance.common.all }, ...(Object.keys(m.finance.paymentStatuses) as (keyof typeof m.finance.paymentStatuses)[]).map((k) => ({ value: k, label: m.finance.paymentStatuses[k] }))]}
      />
      <div aria-live="polite">
        {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      </div>
      {payments.isPending ? <p role="status">{m.common.loading}</p> : null}
      {payments.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {payments.data && payments.data.items.length === 0 ? <Alert tone="info">{s.empty}</Alert> : null}
      <ul className="list-plain" aria-label={s.queue}>
        {payments.data?.items.map((p) => (
          <li key={p.id} className="card" data-testid="queue-payment">
            <div className="row-card">
              <div>
                <strong>{formatMoney(p.amount, p.currency, lang)}</strong> · {m.finance.methods[p.method]} <PaymentBadge status={p.status} />
                <p style={{ margin: '4px 0 0' }}>
                  {s.invoice} :{' '}
                  <Link to={localizedPath(lang, `/billing/${p.invoiceId}`)} className="mono">
                    {p.invoiceNumber}
                  </Link>{' '}
                  · {s.customer} : {p.customerCode}
                </p>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {p.reference ? <span className="mono">{p.reference} · </span> : null}
                  {formatDateTime(p.createdAt, lang)}
                </p>
              </div>
              {p.status === 'PENDING' && canReconcile ? (
                <div className="form-actions">
                  <Button size="sm" aria-label={`${m.finance.staff.invoice.confirm} : ${p.reference ?? ''} ${p.customerCode}`} onClick={() => act(p.id, 'confirm', {})}>
                    {m.finance.staff.invoice.confirm}
                  </Button>
                  <Button variant="outline" size="sm" aria-label={`${m.finance.staff.invoice.reject} : ${p.reference ?? ''} ${p.customerCode}`} onClick={() => setRejecting(p.id)}>
                    {m.finance.staff.invoice.reject}
                  </Button>
                </div>
              ) : null}
            </div>
            {rejecting === p.id ? (
              <form className="form" noValidate onSubmit={(event) => reject(event, p.id)} aria-label={m.finance.staff.invoice.reject}>
                <TextField name={`reason-${p.id}`} label={m.finance.common.reason} value={reason} onChange={setReason} error={reasonError} />
                <div className="form-actions">
                  <Button type="submit" variant="danger">
                    {m.finance.staff.invoice.reject}
                  </Button>
                  <Button variant="outline" onClick={() => setRejecting(null)}>
                    {m.common.cancel}
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cash() {
  const { m, lang } = useI18n();
  const s = m.finance.staff.payments.cash;
  const canCash = useCan('payment:record_cash');
  const queryClient = useQueryClient();
  const sessions = useCashSessions();
  const agencies = useAgencies();
  const [agencyId, setAgencyId] = useState('');
  const [currency, setCurrency] = useState<string>('');
  const [opening, setOpening] = useState('0');
  const [closing, setClosing] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: financeKeys.cash });
      setNotice(success);
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, m));
      return false;
    }
  }

  async function open(event: FormEvent) {
    event.preventDefault();
    const amount = parseDecimal(opening);
    const parsed = openCashSessionSchema.safeParse({ agencyId: agencyId || undefined, currency: currency || undefined, openingAmount: amount ?? undefined });
    if (amount === null || !parsed.success) {
      setErrors({ openingAmount: m.validation.number });
      return;
    }
    setErrors({});
    await call(() => api('/v1/admin/cash-sessions', { method: 'POST', body: parsed.data }), s.opened);
  }

  async function close(event: FormEvent, id: string) {
    event.preventDefault();
    const amount = parseDecimal(counted);
    const parsed = closeCashSessionSchema.safeParse({ countedAmount: amount ?? undefined });
    if (amount === null || !parsed.success) {
      setErrors({ counted: m.validation.number });
      return;
    }
    setErrors({});
    if (await call(() => api(`/v1/admin/cash-sessions/${id}/close`, { method: 'POST', body: parsed.data }), s.closed)) {
      setClosing(null);
      setCounted('');
    }
  }

  const agencyLabel = (id: string | null) => (id ? (agencies.data?.items.find((a) => a.id === id)?.name ?? id) : m.finance.staff.invoice.company);
  return (
    <section aria-labelledby="cash-title">
      <h2 id="cash-title" style={{ fontSize: '1.4rem' }}>{s.title}</h2>
      <div aria-live="polite">
        {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      </div>
      {canCash ? (
        <form className="form card" onSubmit={open} noValidate aria-label={s.open}>
          <h3 style={{ fontSize: '1.05rem' }}>{s.open}</h3>
          <div className="form-grid form-grid-2">
            <SelectField name="cashScope" label={s.scope} value={agencyId} onChange={setAgencyId} options={[{ value: '', label: m.finance.staff.invoice.company }, ...(agencies.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.city})` }))]} />
            <SelectField name="cashCurrency" label={s.currency} value={currency} onChange={setCurrency} options={[{ value: '', label: '—' }, ...CURRENCIES.map((c) => ({ value: c, label: c }))]} />
            <TextField name="openingAmount" label={s.openingAmount} inputMode="decimal" value={opening} onChange={setOpening} error={errors.openingAmount} />
          </div>
          <div className="form-actions">
            <Button type="submit">{s.open}</Button>
          </div>
        </form>
      ) : null}
      {sessions.isPending ? <p role="status">{m.common.loading}</p> : null}
      {sessions.data && sessions.data.items.length === 0 ? <Alert tone="info">{s.none}</Alert> : null}
      <ul className="list-plain" aria-label={s.title}>
        {sessions.data?.items.map((c) => (
          <li key={c.id} className="card" data-testid="cash-session">
            <div className="row-card">
              <div>
                <strong>{agencyLabel(c.agencyId)}</strong> · {c.currency} · {s.openingAmount} : {formatAmount(c.openingAmount, lang)}
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {s.openSince} {formatDateTime(c.openedAt, lang)}
                  {c.closedAt ? ` · ${s.closedAt} ${formatDateTime(c.closedAt, lang)}` : ''}
                </p>
                {c.closedAt ? (
                  <p style={{ margin: '4px 0 0' }}>
                    {s.expected} : {formatAmount(c.expectedAmount ?? 0, lang)} · {s.counted} : {formatAmount(c.countedAmount ?? 0, lang)} · {s.difference} : <strong>{formatAmount(c.difference ?? 0, lang)}</strong>
                  </p>
                ) : null}
              </div>
              {!c.closedAt && canCash ? (
                <Button variant="outline" size="sm" aria-label={`${s.close} : ${agencyLabel(c.agencyId)}`} onClick={() => setClosing(c.id)}>
                  {s.close}
                </Button>
              ) : null}
            </div>
            {closing === c.id ? (
              <form className="form" onSubmit={(event) => close(event, c.id)} noValidate aria-label={s.close}>
                <TextField name="counted" label={s.counted} inputMode="decimal" value={counted} onChange={setCounted} error={errors.counted} />
                <div className="form-actions">
                  <Button type="submit">{s.close}</Button>
                  <Button variant="outline" onClick={() => setClosing(null)}>
                    {m.common.cancel}
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Summary() {
  const { m, lang } = useI18n();
  const s = m.finance.staff.payments.summary;
  const canExport = useCan('payment:export');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = useQuery({
    queryKey: ['staff', 'finance-summary', range] as const,
    enabled: !!range,
    queryFn: () => api<FinanceSummary>(`/v1/admin/finance/summary?from=${range!.from}&to=${range!.to}`),
  });

  function validate(): { from: string; to: string } | null {
    const parsed = exportQuerySchema.safeParse({ from, to });
    if (!parsed.success) {
      setError(m.common.fixErrors);
      return null;
    }
    setError(null);
    return parsed.data;
  }

  async function exportCsv() {
    const valid = validate();
    if (!valid) return;
    try {
      saveBlob(await apiDownload(`/v1/admin/finance/export.csv?from=${valid.from}&to=${valid.to}`), `registre-${valid.from}-${valid.to}.csv`);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <section aria-labelledby="summary-title">
      <h2 id="summary-title" style={{ fontSize: '1.4rem' }}>{s.title}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <div className="form-grid form-grid-2">
        <TextField name="summaryFrom" label={s.from} value={from} onChange={setFrom} />
        <TextField name="summaryTo" label={s.to} value={to} onChange={setTo} />
      </div>
      <div className="form-actions">
        <Button variant="outline" onClick={() => setRange(validate())}>
          {s.load}
        </Button>
        {canExport ? (
          <Button variant="outline" onClick={() => void exportCsv()}>
            {s.export}
          </Button>
        ) : null}
      </div>
      {summary.isError ? <Alert tone="danger">{apiErrorMessage(summary.error, m)}</Alert> : null}
      {summary.data ? (
        <>
          {summary.data.confirmed.length === 0 ? <Alert tone="info">{s.none}</Alert> : null}
          {summary.data.confirmed.length > 0 ? (
            <table className="table" aria-label={s.title}>
              <thead>
                <tr>
                  <th scope="col">{s.method}</th>
                  <th scope="col" className="num">{s.count}</th>
                  <th scope="col" className="num">{s.collected}</th>
                  <th scope="col" className="num">{s.refunded}</th>
                  <th scope="col" className="num">{s.net}</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.confirmed.map((row) => (
                  <tr key={`${row.method}-${row.currency}`}>
                    <th scope="row">{m.finance.methods[row.method]} ({row.currency})</th>
                    <td className="num">{row.count}</td>
                    <td className="num">{formatMoney(row.collected, row.currency, lang)}</td>
                    <td className="num">{formatMoney(row.refunded, row.currency, lang)}</td>
                    <td className="num">{formatMoney(row.net, row.currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {summary.data.pending.length > 0 ? (
            <p>
              {s.pending} :{' '}
              {summary.data.pending.map((row) => `${m.finance.methods[row.method]} ${row.count} (${formatMoney(row.amount, row.currency, lang)})`).join(' · ')}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Settings() {
  const { m } = useI18n();
  const s = m.finance.staff.payments.settings;
  const canUpdate = useCan('settings:update');
  const queryClient = useQueryClient();
  const settings = useFinanceSettings();
  const [draft, setDraft] = useState<{ max: string; text: string } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!settings.data) return null;
  const values = draft ?? { max: String(settings.data.maxDiscountPercent), text: settings.data.paymentInstructions ?? '' };

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const max = parseDecimal(values.max);
    const parsed = financeSettingsSchema.safeParse({ maxDiscountPercent: max ?? undefined, paymentInstructions: values.text.trim() === '' ? null : values.text.trim() });
    if (max === null || !parsed.success) {
      setErrors({ max: m.validation.number, ...(parsed.success ? {} : issuesToErrors(parsed.error, m)) });
      return;
    }
    setErrors({});
    try {
      await api('/v1/admin/settings/finance', { method: 'PUT', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: financeKeys.settings });
      setNotice(s.saved);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <section aria-labelledby="settings-title">
      <h2 id="settings-title" style={{ fontSize: '1.4rem' }}>{s.title}</h2>
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <form className="form card" onSubmit={save} noValidate aria-label={s.title}>
        <TextField name="maxDiscount" label={s.maxDiscount} inputMode="decimal" value={values.max} onChange={(v) => setDraft({ ...values, max: v })} error={errors.max} disabled={!canUpdate} />
        <TextAreaField name="paymentInstructions" label={s.instructions} value={values.text} onChange={(v) => setDraft({ ...values, text: v })} error={errors.paymentInstructions} />
        {canUpdate ? (
          <div className="form-actions">
            <Button type="submit">{s.save}</Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

export function StaffPaymentsPage() {
  const { m } = useI18n();
  const p = m.finance.staff.payments;
  const canRead = useCan('payment:read');
  const canReconcile = useCan('payment:reconcile');
  const canSettings = useCan('settings:read');
  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{p.title}</h1>
      <p className="lead">{p.lead}</p>
      {canRead ? <Queue /> : null}
      {canRead ? <Cash /> : null}
      {canReconcile ? <Summary /> : null}
      {canSettings ? <Settings /> : null}
    </>
  );
}
