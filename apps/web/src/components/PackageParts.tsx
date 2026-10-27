import { format, useI18n } from '../i18n';
import { formatDateTime } from '../lib/format';

/** Tonalité du badge selon l'avancement : l'information ne repose jamais sur la couleur seule (le libellé est toujours écrit). */
const tone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (status === 'DELIVERED') return 'success';
  if (status === 'ON_HOLD') return 'warning';
  if (status === 'CANCELLED' || status === 'RETURNED') return 'danger';
  return 'neutral';
};

export function statusLabel(m: ReturnType<typeof useI18n>['m'], status: string): string {
  return (m.packageStatus as Record<string, string>)[status] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  const { m } = useI18n();
  const t = tone(status);
  return <span className={`badge${t === 'neutral' ? '' : ` badge-${t}`}`}>{statusLabel(m, status)}</span>;
}

export interface TimelineEvent {
  type: string;
  status: string | null;
  occurredAt: string;
  location: string | null;
  reasonCode: string | null;
}

/** Historique du plus récent au plus ancien ; seuls les événements qui changent le statut sont montrés. */
export function Timeline({ events, label }: { events: TimelineEvent[]; label: string }) {
  const { m, lang } = useI18n();
  const shown = events.filter((event) => event.status).slice().reverse();
  return (
    <ol className="timeline" aria-label={label}>
      {shown.map((event, index) => (
        <li key={`${event.occurredAt}-${event.status}-${index}`} aria-current={index === 0 ? 'step' : undefined}>
          <strong>{statusLabel(m, event.status as string)}</strong>
          {event.reasonCode ? <span className="muted"> — {(m.holdReasons as Record<string, string>)[event.reasonCode] ?? event.reasonCode}</span> : null}
          <br />
          <span className="muted">
            {formatDateTime(event.occurredAt, lang)}
            {event.location ? ` · ${event.location}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

export const reasonText = (m: ReturnType<typeof useI18n>['m'], code: string | null): string | null =>
  code ? format(m.tracking.result.reason, { reason: (m.holdReasons as Record<string, string>)[code] ?? code }) : null;
