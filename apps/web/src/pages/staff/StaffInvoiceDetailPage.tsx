import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { creditNoteSchema, recordCashPaymentSchema, refundSchema, rejectPaymentSchema, voidInvoiceSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime, formatMoney, parseDecimal } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { InvoiceBadge, InvoiceLines, PaymentList, PdfButton } from '../finance/FinanceParts';
import { financeKeys, newIdempotencyKey, useStaffInvoice, type InvoiceDetail, type Payment } from '../finance/queries';
import { useAgencies, useCan } from './queries';

type Run = (action: () => Promise<unknown>, success: string | ((result: { receiptNumber?: string }) => string)) => Promise<boolean>;

/** Petit formulaire en ligne : un ou deux champs, validation par le schéma partagé puis appel de l'API. */
function ReasonAmountForm({
  title,
  submitLabel,
  withAmount,
  maxAmount,
  amountLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  withAmount?: boolean;
  maxAmount?: string;
  amountLabel: string;
  onSubmit(values: { amount?: number; reason: string }): Promise<boolean>;
  onCancel(): void;
}) {
  const { m } = useI18n();
  const [amount, setAmount] = useState(maxAmount ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = withAmount ? parseDecimal(amount) : undefined;
    const manual: FieldErrors = withAmount && parsedAmount === null ? { amount: m.validation.number } : {};
    const schema = withAmount ? refundSchema : voidInvoiceSchema;
    const parsed = schema.safeParse(withAmount ? { amount: parsedAmount ?? undefined, reason: reason.trim() } : { reason: reason.trim() });
    const all = { ...(parsed.success ? {} : issuesToErrors(parsed.error, m)), ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      return;
    }
    setBusy(true);
    const ok = await onSubmit({ amount: withAmount ? (parsedAmount ?? undefined) : undefined, reason: reason.trim() });
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={title}>
      <h3 style={{ fontSize: '1.05rem' }}>{title}</h3>
      <div className="form-grid form-grid-2">
        {withAmount ? <TextField name="amount" label={amountLabel} inputMode="decimal" value={amount} onChange={setAmount} error={errors.amount} /> : null}
        <TextField name="reason" label={m.finance.common.reason} value={reason} onChange={setReason} error={errors.reason} />
      </div>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? m.common.saving : submitLabel}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function CashForm({ invoice, run }: { invoice: InvoiceDetail; run: Run }) {
  const { m } = useI18n();
  const s = m.finance.staff.invoice;
  const agencies = useAgencies();
  const available = Math.max(0, Number(invoice.balance) - Number(invoice.pendingTotal));
  const [amount, setAmount] = useState(available.toFixed(2));
  const [reference, setReference] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = parseDecimal(amount);
    const manual: FieldErrors = parsedAmount === null ? { amount: m.validation.number } : {};
    const parsed = recordCashPaymentSchema.safeParse({
      invoiceId: invoice.id,
      amount: parsedAmount ?? undefined,
      reference: reference.trim() === '' ? undefined : reference.trim(),
      agencyId: agencyId || undefined,
    });
    const all = { ...(parsed.success ? {} : issuesToErrors(parsed.error, m)), ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      return;
    }
    setBusy(true);
    // La même clé accompagne une nouvelle tentative de la même saisie : un double clic ne double pas l'encaissement
    const ok = await run(
      () => api('/v1/admin/payments/cash', { method: 'POST', body: parsed.data, headers: { 'Idempotency-Key': key } }),
      (result) => format(s.cashDone, { receipt: result.receiptNumber ?? '' }),
    );
    setBusy(false);
    if (ok) {
      setKey(newIdempotencyKey());
      setReference('');
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={s.cashTitle}>
      <h3 style={{ fontSize: '1.05rem' }}>{s.cashTitle}</h3>
      <div className="form-grid form-grid-2">
        <TextField name="cashAmount" label={m.finance.common.amount} inputMode="decimal" value={amount} onChange={setAmount} error={errors.amount} />
        <TextField name="cashReference" label={m.finance.common.reference} optional value={reference} onChange={setReference} error={errors.reference} />
      </div>
      <SelectField
        name="cashAgency"
        label={s.agency}
        optional
        value={agencyId}
        onChange={setAgencyId}
        options={[{ value: '', label: s.company }, ...(agencies.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.city})` }))]}
      />
      <p className="muted">{s.cashNeedsSession}</p>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? m.common.saving : s.cashSubmit}
        </Button>
      </div>
    </form>
  );
}

export function StaffInvoiceDetailPage() {
  const { id = '' } = useParams();
  const { m, lang } = useI18n();
  const f = m.finance;
  const s = f.staff.invoice;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useStaffInvoice(id);
  const canCreate = useCan('invoice:create');
  const canVoid = useCan('invoice:void');
  const canCash = useCan('payment:record_cash');
  const canReconcile = useCan('payment:reconcile');
  const canRefund = useCan('payment:refund');
  const [panel, setPanel] = useState<null | 'void' | 'credit' | { type: 'reject' | 'refund'; paymentId: string }>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = query.data;

  const run: Run = async (action, success) => {
    setError(null);
    setNotice(null);
    try {
      const result = (await action()) as { receiptNumber?: string };
      await Promise.all([queryClient.invalidateQueries({ queryKey: financeKeys.invoices }), queryClient.invalidateQueries({ queryKey: financeKeys.payments })]);
      setNotice(typeof success === 'function' ? success(result ?? {}) : success);
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, m));
      return false;
    }
  };

  const open = data && (data.status === 'ISSUED' || data.status === 'PARTIALLY_PAID');
  const available = data ? Number(data.balance) - Number(data.pendingTotal) : 0;
  const base = `/v1/admin/invoices/${id}`;

  return (
    <>
      <p>
        <Link to={localizedPath(lang, '/account/staff/billing')}>← {f.common.back}</Link>
      </p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{s.notFound}</Alert> : null}
      {data ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            <span className="mono">{data.number ?? f.common.draftNumber}</span> <InvoiceBadge status={data.status} />
          </h1>
          <p>
            {data.customer.customerCode} · {data.customer.name}
          </p>
          <p className="muted">
            {data.issuedAt ? `${f.common.issuedOn} ${formatDateTime(data.issuedAt, lang)}` : ''}
            {data.dueDate ? ` · ${f.common.dueOn} ${data.dueDate}` : ''}
            {data.notes ? ` · ${data.notes}` : ''}
          </p>
          {data.voidReason ? <Alert tone="info">{data.voidReason}</Alert> : null}
          <div aria-live="polite">
            {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
            {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          </div>

          <InvoiceLines invoice={data} />

          <div className="form-actions">
            {data.number ? <PdfButton path={`${base}/pdf`} filename={`${data.number}.pdf`} label={f.common.downloadPdf} /> : null}
            {data.status === 'DRAFT' && canCreate ? (
              <>
                <Button onClick={() => run(() => api(`${base}/issue`, { method: 'POST' }), s.issued)}>{s.issue}</Button>
                {confirmingDelete ? (
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (await run(() => api(`${base}`, { method: 'DELETE' }), s.deleted)) navigate(localizedPath(lang, '/account/staff/billing'));
                    }}
                  >
                    {s.confirmDelete}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
                    {s.delete}
                  </Button>
                )}
              </>
            ) : null}
            {open && canVoid ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setPanel('credit')}>
                  {s.creditTitle}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPanel('void')}>
                  {s.voidTitle}
                </Button>
              </>
            ) : null}
          </div>
          {data.status === 'DRAFT' ? <p className="muted">{s.issueNote}</p> : null}

          {panel === 'void' ? (
            <ReasonAmountForm
              title={s.voidTitle}
              submitLabel={s.voidSubmit}
              amountLabel=""
              onSubmit={({ reason }) => run(() => api(`${base}/void`, { method: 'POST', body: { reason } }), s.voided)}
              onCancel={() => setPanel(null)}
            />
          ) : null}
          {panel === 'credit' ? (
            <CreditForm base={base} run={run} onCancel={() => setPanel(null)} />
          ) : null}
          {typeof panel === 'object' && panel?.type === 'reject' ? (
            <RejectForm paymentId={panel.paymentId} run={run} onCancel={() => setPanel(null)} />
          ) : null}
          {typeof panel === 'object' && panel?.type === 'refund' ? (
            <ReasonAmountForm
              title={s.refund}
              submitLabel={s.refundSubmit}
              withAmount
              amountLabel={f.common.amount}
              onSubmit={({ amount, reason }) => run(() => api(`/v1/admin/payments/${panel.paymentId}/refunds`, { method: 'POST', body: { amount, reason } }), s.refunded)}
              onCancel={() => setPanel(null)}
            />
          ) : null}

          {data.packages.length > 0 ? (
            <>
              <h2 style={{ fontSize: '1.2rem' }}>{f.common.packages}</h2>
              <ul>
                {data.packages.map((p) => (
                  <li key={p.id}>
                    <Link to={localizedPath(lang, `/account/staff/packages/${p.id}`)} className="mono">
                      {p.trackingNumberDisplay}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {data.credits.length > 0 ? (
            <>
              <h2 style={{ fontSize: '1.2rem' }}>{f.common.credits}</h2>
              <ul>
                {data.credits.map((c) => (
                  <li key={c.id}>
                    <span className="mono">{c.number}</span> · {formatMoney(c.amount, data.currency, lang)} · {c.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h2 style={{ fontSize: '1.2rem' }}>{f.common.payments}</h2>
          <PaymentList
            payments={data.payments}
            receiptPath={(paymentId) => `/v1/admin/payments/${paymentId}/receipt.pdf`}
            actions={(p: Payment) => (
              <>
                {p.status === 'PENDING' && canReconcile ? (
                  <>
                    <Button size="sm" aria-label={`${s.confirm} : ${p.reference ?? ''}`} onClick={() => run(() => api(`/v1/admin/payments/${p.id}/confirm`, { method: 'POST', body: {} }), s.confirmed)}>
                      {s.confirm}
                    </Button>
                    <Button variant="outline" size="sm" aria-label={`${s.reject} : ${p.reference ?? ''}`} onClick={() => setPanel({ type: 'reject', paymentId: p.id })}>
                      {s.reject}
                    </Button>
                  </>
                ) : null}
                {(p.status === 'CONFIRMED' || p.status === 'REFUNDED_PARTIAL') && canRefund ? (
                  <Button variant="outline" size="sm" aria-label={`${s.refund} : ${p.reference ?? p.id}`} onClick={() => setPanel({ type: 'refund', paymentId: p.id })}>
                    {s.refund}
                  </Button>
                ) : null}
              </>
            )}
          />
          {data.payments.some((p) => p.status === 'CONFIRMED' || p.status === 'REFUNDED_PARTIAL') && canRefund ? <p className="muted">{s.refundNote}</p> : null}

          {open && canCash && available > 0 ? <CashForm invoice={data} run={run} /> : null}
        </>
      ) : null}
    </>
  );
}

function CreditForm({ base, run, onCancel }: { base: string; run: Run; onCancel(): void }) {
  const { m } = useI18n();
  const s = m.finance.staff.invoice;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = parseDecimal(amount);
    const manual: FieldErrors = parsedAmount === null ? { amount: m.validation.number } : {};
    const parsed = creditNoteSchema.safeParse({ amount: parsedAmount ?? undefined, reason: reason.trim() });
    const all = { ...(parsed.success ? {} : issuesToErrors(parsed.error, m)), ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      return;
    }
    setBusy(true);
    const ok = await run(() => api(`${base}/credit-notes`, { method: 'POST', body: parsed.data }), s.credited);
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={s.creditTitle}>
      <h3 style={{ fontSize: '1.05rem' }}>{s.creditTitle}</h3>
      <div className="form-grid form-grid-2">
        <TextField name="creditAmount" label={m.finance.common.amount} inputMode="decimal" value={amount} onChange={setAmount} error={errors.amount} />
        <TextField name="creditReason" label={m.finance.common.reason} value={reason} onChange={setReason} error={errors.reason} />
      </div>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? m.common.saving : s.creditSubmit}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function RejectForm({ paymentId, run, onCancel }: { paymentId: string; run: Run; onCancel(): void }) {
  const { m } = useI18n();
  const s = m.finance.staff.invoice;
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = rejectPaymentSchema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return;
    }
    setBusy(true);
    const ok = await run(() => api(`/v1/admin/payments/${paymentId}/reject`, { method: 'POST', body: parsed.data }), s.rejected);
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={s.reject}>
      <h3 style={{ fontSize: '1.05rem' }}>{s.reject}</h3>
      <TextField name="rejectReason" label={m.finance.common.reason} value={reason} onChange={setReason} error={errors.reason} />
      <div className="form-actions">
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? m.common.saving : s.reject}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}
