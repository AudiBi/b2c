import { useState } from 'react';
import { apiDownload } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatDateTime, formatMoney } from '../../lib/format';
import { saveBlob } from '../../lib/download';
import { Button } from '../../components/ui/Button';
import { FormMessage } from '../../components/ui/Fields';
import type { InvoiceDetail, InvoiceStatus, Payment, PaymentStatus } from './queries';

const invoiceTone = (status: InvoiceStatus) => (status === 'PAID' ? ' badge-success' : status === 'VOID' || status === 'CREDITED' ? ' badge-danger' : status === 'ISSUED' || status === 'PARTIALLY_PAID' ? ' badge-warning' : '');
const paymentTone = (status: PaymentStatus) => (status === 'CONFIRMED' ? ' badge-success' : status === 'FAILED' || status === 'CANCELLED' ? ' badge-danger' : status === 'PENDING' ? ' badge-warning' : '');

export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const { m } = useI18n();
  return <span className={`badge${invoiceTone(status)}`}>{m.finance.invoiceStatuses[status]}</span>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { m } = useI18n();
  return <span className={`badge${paymentTone(status)}`}>{m.finance.paymentStatuses[status]}</span>;
}

/** Détail des lignes et totaux d'une facture. */
export function InvoiceLines({ invoice }: { invoice: InvoiceDetail }) {
  const { m, lang } = useI18n();
  const t = m.finance.totals;
  const money = (value: string) => formatMoney(value, invoice.currency, lang);
  const hasCredit = Number(invoice.creditedTotal) > 0;
  return (
    <table className="table" aria-label={m.finance.common.lines}>
      <tbody>
        {invoice.lines.map((line) => (
          <tr key={line.id}>
            <th scope="row">
              {m.finance.lineKinds[line.kind]} <span className="muted">· {line.description}</span>
            </th>
            <td className="num">{money(line.amount)}</td>
          </tr>
        ))}
        {hasCredit ? (
          <tr>
            <th scope="row">{t.credited}</th>
            <td className="num">−{money(invoice.creditedTotal)}</td>
          </tr>
        ) : null}
        <tr>
          <th scope="row">{t.paid}</th>
          <td className="num">{money(invoice.paidTotal)}</td>
        </tr>
        {Number(invoice.pendingTotal) > 0 ? (
          <tr>
            <th scope="row">{t.pending}</th>
            <td className="num">{money(invoice.pendingTotal)}</td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t.total}</th>
          <td className="num" data-testid="invoice-total">
            {money(invoice.total)}
          </td>
        </tr>
        <tr>
          <th scope="row">{t.balance}</th>
          <td className="num" data-testid="invoice-balance">
            {money(invoice.balance)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Liste des paiements d'une facture, avec téléchargement du reçu ; `actions` ajoute des boutons par paiement (personnel). */
export function PaymentList({ payments, receiptPath, actions }: { payments: Payment[]; receiptPath(paymentId: string): string; actions?(payment: Payment): React.ReactNode }) {
  const { m, lang } = useI18n();
  const f = m.finance;
  const [error, setError] = useState<string | null>(null);

  async function receipt(payment: Payment) {
    setError(null);
    try {
      saveBlob(await apiDownload(receiptPath(payment.id)), `${payment.receiptNumber ?? 'recu'}.pdf`);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  if (payments.length === 0) return <p className="muted">{f.common.noPayments}</p>;
  return (
    <>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <ul className="list-plain" aria-label={f.common.payments}>
        {payments.map((p) => (
          <li key={p.id} className="card" data-testid="payment-item">
            <div className="row-card">
              <div>
                <strong>{formatMoney(p.amount, p.currency, lang)}</strong> · {f.methods[p.method]} <PaymentBadge status={p.status} />
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {p.reference ? <span className="mono">{p.reference} · </span> : null}
                  {formatDateTime(p.createdAt, lang)}
                  {Number(p.refundedTotal) > 0 ? ` · ${f.staff.invoice.refundedTotal} : ${formatMoney(p.refundedTotal, p.currency, lang)}` : ''}
                </p>
                {p.failureReason ? <p className="muted" style={{ margin: '4px 0 0' }}>{p.failureReason}</p> : null}
              </div>
              <div className="form-actions">
                {p.receiptNumber ? (
                  <Button variant="outline" size="sm" aria-label={`${f.common.receipt} ${p.receiptNumber}`} onClick={() => receipt(p)}>
                    {f.common.receipt}
                  </Button>
                ) : null}
                {actions?.(p)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Bouton de téléchargement d'un PDF protégé. */
export function PdfButton({ path, filename, label }: { path: string; filename: string; label: string }) {
  const { m } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          setError(null);
          try {
            saveBlob(await apiDownload(path), filename);
          } catch (e) {
            setError(apiErrorMessage(e, m));
          }
        }}
      >
        {label}
      </Button>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
    </>
  );
}
