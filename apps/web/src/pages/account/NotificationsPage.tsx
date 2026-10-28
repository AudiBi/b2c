import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage } from '../../components/ui/Fields';
import { financeKeys, useMyNotifications } from '../finance/queries';

export function NotificationsPage() {
  const { m, lang } = useI18n();
  const n = m.finance.notifications;
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useMyNotifications(unreadOnly);
  const [error, setError] = useState<string | null>(null);

  async function mark(id: string | null) {
    setError(null);
    try {
      await api(id ? `/v1/me/notifications/${id}/read` : '/v1/me/notifications/read-all', { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: financeKeys.notifications });
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  const unread = query.data?.unread ?? 0;
  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{n.title}</h1>
      <p className="lead">{n.lead}</p>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <div className="form-actions" style={{ alignItems: 'center' }}>
        <p style={{ margin: 0 }} role="status">
          {unread > 0 ? format(n.unread, { count: unread }) : n.none}
        </p>
        <CheckField name="unreadOnly" checked={unreadOnly} onChange={setUnreadOnly}>
          {n.unreadOnly}
        </CheckField>
        <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => mark(null)}>
          {n.markAll}
        </Button>
      </div>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {query.data && query.data.items.length === 0 ? <Alert tone="info">{n.empty}</Alert> : null}
      <ul className="list-plain" aria-label={n.list}>
        {query.data?.items.map((item) => (
          <li key={item.id} className="card" data-testid="notification-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  {item.subject ?? m.finance.events[item.eventCode as keyof typeof m.finance.events] ?? item.eventCode}{' '}
                  {item.readAt ? null : <span className="badge badge-warning">{n.isNew}</span>}
                </h2>
                <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{item.body}</p>
                <p className="muted" style={{ margin: '4px 0 0' }}>{formatDateTime(item.createdAt, lang)}</p>
              </div>
              {item.readAt ? null : (
                <Button variant="outline" size="sm" onClick={() => mark(item.id)} aria-label={`${n.markRead} : ${item.subject ?? ''}`}>
                  {n.markRead}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
