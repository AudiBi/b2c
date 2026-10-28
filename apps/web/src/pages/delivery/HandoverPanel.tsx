import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { FormMessage } from '../../components/ui/Fields';
import { useCan } from '../staff/queries';
import { HandoverForm } from './HandoverForm';
import { useDeliveryAttempts, useHandoverInfo } from './queries';

const ATTEMPT_STATUSES = ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Remise au comptoir de l'agence (colis « prêt pour retrait ») et historique des tentatives. */
export function HandoverPanel({ packageId, status, onDone }: { packageId: string; status: string; onDone(): Promise<unknown> }) {
  const { m, lang } = useI18n();
  const h = m.delivery.handover;
  const queryClient = useQueryClient();
  const canConfirmOnly = useCan('delivery:confirm');
  const canOverride = useCan('delivery:override_balance');
  const canSee = useCan('delivery:read');
  const canConfirm = canConfirmOnly && canSee;
  const [notice, setNotice] = useState<string | null>(null);
  const ready = canConfirm && status === 'READY_FOR_PICKUP';
  const info = useHandoverInfo(packageId, ready);
  const attempts = useDeliveryAttempts(packageId, canSee && ATTEMPT_STATUSES.includes(status));
  const rows = attempts.data?.items ?? [];

  if (!ready && rows.length === 0) return null;
  return (
    <section className="card form" aria-label={h.title}>
      <h2 style={{ fontSize: '1.1rem' }}>{h.title}</h2>
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {ready && info.isPending ? <p role="status">{m.common.loading}</p> : null}
      {ready && info.data ? (
        <>
          <p>
            {h.customer} : <strong>{info.data.customer.name}</strong> ({info.data.customer.customerCode})
          </p>
          {info.data.failedAttempts > 0 ? <Alert tone="info">{h.previousFailures.replace('{count}', String(info.data.failedAttempts))}</Alert> : null}
          <HandoverForm
            packageId={packageId}
            settings={info.data.settings}
            beneficiaries={info.data.beneficiaries}
            balance={info.data.balance.blocked ? { due: info.data.balance.due, currency: info.data.balance.currency, unbilled: info.data.balance.unbilled } : null}
            canOverride={canOverride}
            submitLabel={h.confirm}
            onSubmit={async (body) => {
              await api(`/v1/admin/packages/${packageId}/handover`, { method: 'POST', body });
              setNotice(h.done);
              await Promise.all([onDone(), queryClient.invalidateQueries({ queryKey: ['staff', 'delivery-attempts', packageId] }), queryClient.invalidateQueries({ queryKey: ['staff', 'handover-info', packageId] })]);
            }}
          />
        </>
      ) : null}
      {rows.length > 0 ? (
        <>
          <h3 style={{ fontSize: '1rem' }}>{h.attempts}</h3>
          <ul className="list-plain" aria-label={h.attempts} data-testid="attempts">
            {rows.map((a) => (
              <li key={a.id}>
                <strong>{a.outcome === 'SUCCEEDED' ? h.succeeded : h.failed}</strong> · {a.channel === 'ROUTE' ? h.byRoute : h.atCounter} · {formatDateTime(a.attemptedAt, lang)}
                {a.outcome === 'SUCCEEDED' ? (
                  <span className="muted">
                    {' '}
                    — {a.recipientName}
                    {a.idDocumentLast4 ? ` (…${a.idDocumentLast4})` : ''}
                    {a.otpVerified ? ` · ${h.otpOk}` : ''}
                    {a.balanceOverridden ? ` · ${h.overridden} : ${a.overrideReason}` : ''}
                  </span>
                ) : (
                  <span className="muted">
                    {' '}
                    — {a.failureReason ? m.delivery.failureReasons[a.failureReason as keyof typeof m.delivery.failureReasons] ?? a.failureReason : ''}
                    {a.note ? ` · ${a.note}` : ''}
                    {a.rescheduleFor ? ` · ${h.rescheduled} ${a.rescheduleFor}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
