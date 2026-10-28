import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { declarePaymentSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime, formatMoney, parseDecimal } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { InvoiceBadge, InvoiceLines, PaymentList, PdfButton } from '../finance/FinanceParts';
import { financeKeys, useMyInvoice, useMyInvoices, usePaymentOptions, type InvoiceDetail } from '../finance/queries';

export function InvoicesPage() {
  const { m, lang } = useI18n();
  const f = m.finance;
  const c = f.customer.invoices;
  const invoices = useMyInvoices();
  const items = invoices.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{c.title}</h1>
      <p className="lead">{c.lead}</p>
      {invoices.isPending ? <p role="status">{m.common.loading}</p> : null}
      {invoices.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {invoices.data && items.length === 0 ? <Alert tone="info">{c.empty}</Alert> : null}
      <ul className="list-plain" aria-label={c.title}>
        {items.map((inv) => (
          <li key={inv.id} className="card" data-testid="invoice-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.1rem' }}>
                  <span className="mono">{inv.number}</span> <InvoiceBadge status={inv.status} />
                </h2>
                <p style={{ margin: 0 }}>
                  {f.totals.total} : <strong>{formatMoney(inv.total, inv.currency, lang)}</strong>
                  {Number(inv.balance) > 0 && inv.status !== 'VOID' ? ` · ${f.totals.balance} : ${formatMoney(inv.balance, inv.currency, lang)}` : ''}
                </p>
                {inv.issuedAt ? <p className="muted" style={{ margin: '4px 0 0' }}>{f.common.issuedOn} {formatDateTime(inv.issuedAt, lang)}</p> : null}
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/account/invoices/${inv.id}`)} aria-label={`${f.common.open} : ${inv.number}`}>
                {f.common.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {invoices.hasNextPage ? (
        <Button variant="outline" onClick={() => invoices.fetchNextPage()} disabled={invoices.isFetchingNextPage}>
          {f.common.loadMore}
        </Button>
      ) : null}
    </>
  );
}

function DeclareForm({ invoice, onDone }: { invoice: InvoiceDetail; onDone(message: string): void }) {
  const { m, lang } = useI18n();
  const p = m.finance.customer.pay;
  const queryClient = useQueryClient();
  const options = usePaymentOptions();
  const available = Math.max(0, Number(invoice.balance) - Number(invoice.pendingTotal));
  const methods = options.data?.declare ?? [];
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState(available > 0 ? available.toFixed(2) : '');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = method || methods[0] || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedAmount = parseDecimal(amount);
    const manual: FieldErrors = parsedAmount === null ? { amount: m.validation.number } : {};
    const parsed = declarePaymentSchema.safeParse({ method: chosen, amount: parsedAmount ?? undefined, reference: reference.trim() });
    const issues = parsed.success ? {} : issuesToErrors(parsed.error, m);
    const all = { ...issues, ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      await api(`/v1/me/invoices/${invoice.id}/payments`, { method: 'POST', body: parsed.data });
      await Promise.all([queryClient.invalidateQueries({ queryKey: financeKeys.myInvoices }), queryClient.invalidateQueries({ queryKey: financeKeys.myPayments })]);
      setReference('');
      onDone(p.sent);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="pay-title">
      <h2 id="pay-title" style={{ fontSize: '1.2rem' }}>{p.title}</h2>
      {options.data?.instructions ? (
        <>
          <h3 style={{ fontSize: '1rem' }}>{p.instructions}</h3>
          <p style={{ whiteSpace: 'pre-line' }}>{options.data.instructions}</p>
        </>
      ) : null}
      <p>{p.howTo}</p>
      {options.data?.cash ? <p className="muted">{p.cash}</p> : null}
      {options.data && !options.data.online ? <p className="muted">{p.noOnline}</p> : null}
      {available <= 0 ? (
        <Alert tone="info">{Number(invoice.pendingTotal) > 0 ? format(m.finance.totals.pending + ' : {amount}', { amount: formatMoney(invoice.pendingTotal, invoice.currency, lang) }) : p.settled}</Alert>
      ) : (
        <form className="form" onSubmit={submit} noValidate aria-label={p.title}>
          {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          <SelectField name="method" label={p.method} value={chosen} onChange={setMethod} options={methods.map((x) => ({ value: x, label: m.finance.methods[x] }))} error={errors.method} />
          <div className="form-grid form-grid-2">
            <TextField name="amount" label={p.amount} inputMode="decimal" value={amount} onChange={setAmount} error={errors.amount} />
            <TextField name="reference" label={p.reference} hint={p.referenceHint} value={reference} onChange={setReference} error={errors.reference} spellCheck={false} />
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={busy || methods.length === 0}>
              {busy ? m.common.saving : p.submit}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const { m, lang } = useI18n();
  const f = m.finance;
  const queryClient = useQueryClient();
  const query = useMyInvoice(id);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const payable = data && (data.status === 'ISSUED' || data.status === 'PARTIALLY_PAID');

  async function cancel(paymentId: string) {
    setError(null);
    try {
      await api(`/v1/me/payments/${paymentId}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: financeKeys.myInvoices });
      setNotice(f.customer.pay.cancelled);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <>
      <p>
        <Link to={localizedPath(lang, '/account/invoices')}>← {f.common.back}</Link>
      </p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.auth.errors.INVOICE_NOT_FOUND}</Alert> : null}
      {data ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            {format(f.customer.invoices.number, { number: data.number ?? '' })} <InvoiceBadge status={data.status} />
          </h1>
          <p className="muted">
            {data.issuedAt ? `${f.common.issuedOn} ${formatDateTime(data.issuedAt, lang)}` : ''}
            {data.dueDate ? ` · ${f.common.dueOn} ${data.dueDate}` : ''}
          </p>
          <div aria-live="polite">
            {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
            {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          </div>
          <InvoiceLines invoice={data} />
          <p>
            <PdfButton path={`/v1/me/invoices/${data.id}/pdf`} filename={`${data.number}.pdf`} label={f.common.downloadPdf} />
          </p>
          {data.packages.length > 0 ? (
            <>
              <h2 style={{ fontSize: '1.2rem' }}>{f.common.packages}</h2>
              <ul>
                {data.packages.map((p) => (
                  <li key={p.id}>
                    <Link to={localizedPath(lang, `/account/packages/${p.id}`)} className="mono">
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
            receiptPath={(paymentId) => `/v1/me/payments/${paymentId}/receipt.pdf`}
            actions={(p) =>
              p.status === 'PENDING' && p.declaredByCustomer ? (
                <Button variant="ghost" size="sm" onClick={() => cancel(p.id)} aria-label={`${f.customer.pay.cancel} : ${p.reference ?? ''}`}>
                  {f.customer.pay.cancel}
                </Button>
              ) : null
            }
          />
          {payable ? (
            <DeclareForm
              invoice={data}
              onDone={(message) => {
                setError(null);
                setNotice(message);
              }}
            />
          ) : (
            <Alert tone="info">{data.status === 'PAID' ? f.customer.pay.settled : f.customer.pay.unavailable}</Alert>
          )}
        </>
      ) : null}
    </>
  );
}
