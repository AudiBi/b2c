import { useState } from 'react';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Fields';
import { useAudit } from '../delivery/queries';

/** Journal d'audit en lecture seule (qui a fait quoi, quand), filtrable par action et type d'objet. */
export function StaffAuditPage() {
  const { m, lang } = useI18n();
  const a = m.delivery.staff.audit;
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [applied, setApplied] = useState({ action: '', entityType: '' });
  const [open, setOpen] = useState<string | null>(null);
  const audit = useAudit(applied);
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{a.title}</h1>
      <p className="lead">{a.lead}</p>
      <form
        className="form-actions"
        style={{ alignItems: 'flex-end' }}
        role="search"
        aria-label={a.title}
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ action: action.trim(), entityType: entityType.trim() });
        }}
      >
        <TextField name="auditAction" label={a.action} hint={a.actionHint} value={action} onChange={setAction} />
        <TextField name="auditEntity" label={a.entityType} hint={a.entityHint} value={entityType} onChange={setEntityType} />
        <Button type="submit" variant="outline">
          {a.filter}
        </Button>
      </form>
      {audit.isPending ? <p role="status">{m.common.loading}</p> : null}
      {audit.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {audit.data && items.length === 0 ? <Alert tone="info">{a.empty}</Alert> : null}
      <ul className="list-plain" aria-label={a.title}>
        {items.map((item) => (
          <li key={item.id} className="card" data-testid="audit-item">
            <div className="row-card">
              <div>
                <strong className="mono">{item.action}</strong>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {formatDateTime(item.createdAt, lang)} · {item.actorType}
                  {item.entityType ? ` · ${item.entityType}` : ''}
                </p>
              </div>
              {item.before || item.after ? (
                <Button variant="ghost" size="sm" aria-expanded={open === item.id} aria-label={`${a.details} : ${item.action}`} onClick={() => setOpen(open === item.id ? null : item.id)}>
                  {a.details}
                </Button>
              ) : null}
            </div>
            {open === item.id ? (
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
                {JSON.stringify({ before: item.before, after: item.after }, null, 2)}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
      {audit.hasNextPage ? (
        <Button variant="outline" onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
          {m.finance.common.loadMore}
        </Button>
      ) : null}
    </>
  );
}
