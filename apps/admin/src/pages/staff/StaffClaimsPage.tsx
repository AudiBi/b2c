import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { CLAIM_STATUSES, claimMessageSchema, claimStatusSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { claimTone } from '../../lib/tones';
import { deliveryKeys, useStaffClaim, useStaffClaims, type ClaimStatus } from '../delivery/queries';
import { CompensationCard } from './CompensationCard';
import { useCan } from './queries';

export function StaffClaimsPage() {
  const { m, lang } = useI18n();
  const c = m.delivery.staff.claims;
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const claims = useStaffClaims({ status, q: applied });
  const items = claims.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{c.title}</h1>
      <p className="lead">{c.lead}</p>
      <form
        className="form-actions"
        style={{ alignItems: 'flex-end' }}
        role="search"
        aria-label={c.filter}
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(q.trim());
        }}
      >
        <TextField name="claimSearch" label={c.search} value={q} onChange={setQ} />
        <SelectField
          name="claimStatus"
          label={c.status}
          value={status}
          onChange={setStatus}
          options={[{ value: '', label: m.finance.common.all }, ...CLAIM_STATUSES.map((s) => ({ value: s, label: m.delivery.claims.statuses[s] }))]}
        />
        <Button type="submit" variant="outline">
          {c.filter}
        </Button>
      </form>
      {claims.isPending ? <p role="status">{m.common.loading}</p> : null}
      {claims.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {claims.data && items.length === 0 ? <Alert tone="info">{c.empty}</Alert> : null}
      <ul className="list-plain" aria-label={c.title}>
        {items.map((item) => (
          <li key={item.id} className="card" data-testid="staff-claim">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  <span className="mono">{item.number}</span> <span className={`badge${claimTone(item.status)}`}>{m.delivery.claims.statuses[item.status]}</span>
                </h2>
                <p style={{ margin: 0 }}>
                  {item.customer?.customerCode} · {item.customer?.name} · {item.subject} · {m.delivery.claims.categories[item.category]}
                </p>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {formatDateTime(item.openedAt, lang)}
                  {item.assignedTo ? ` · ${c.assignedTo} ${item.assignedTo.name}` : ` · ${c.unassigned}`}
                </p>
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/claims/${item.id}`)} aria-label={`${m.finance.common.open} : ${item.number}`}>
                {m.finance.common.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {claims.hasNextPage ? (
        <Button variant="outline" onClick={() => claims.fetchNextPage()} disabled={claims.isFetchingNextPage}>
          {m.finance.common.loadMore}
        </Button>
      ) : null}
    </>
  );
}

export function StaffClaimDetailPage() {
  const { id = '' } = useParams();
  const { m, lang } = useI18n();
  const c = m.delivery.staff.claims;
  const queryClient = useQueryClient();
  const query = useStaffClaim(id);
  const canManage = useCan('claim:manage');
  const data = query.data;
  const staff = useQuery({ queryKey: ['staff', 'claim-staff'] as const, enabled: canManage, queryFn: () => api<{ items: { id: string; name: string }[] }>('/v1/admin/claims/assignees') });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [newStatus, setNewStatus] = useState<string>('');
  const [resolution, setResolution] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: deliveryKeys.claims });

  async function call(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(success);
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, m));
      return false;
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const parsed = claimMessageSchema.safeParse({ body: body.trim(), internal: internal || undefined });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return;
    }
    setErrors({});
    if (await call(() => api(`/v1/admin/claims/${id}/messages`, { method: 'POST', body: parsed.data }), internal ? c.noteAdded : c.replied)) {
      setBody('');
      setInternal(false);
    }
  }

  async function changeStatus(event: FormEvent) {
    event.preventDefault();
    const parsed = claimStatusSchema.safeParse({ status: newStatus, resolution: resolution.trim() === '' ? undefined : resolution.trim() });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return;
    }
    setErrors({});
    if (await call(() => api(`/v1/admin/claims/${id}/status`, { method: 'POST', body: parsed.data }), c.statusChanged)) {
      setNewStatus('');
      setResolution('');
    }
  }

  const closing = newStatus === 'RESOLVED' || newStatus === 'REJECTED';
  return (
    <>
      <p>
        <Link to={localizedPath(lang, '/claims')}>← {m.finance.common.back}</Link>
      </p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.auth.errors.CLAIM_NOT_FOUND}</Alert> : null}
      {data ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            <span className="mono">{data.number}</span> <span className={`badge${claimTone(data.status)}`}>{m.delivery.claims.statuses[data.status]}</span>
          </h1>
          <p>
            {data.customer?.customerCode} · {data.customer?.name} · <strong>{data.subject}</strong> · {m.delivery.claims.categories[data.category]}
            {data.package ? (
              <>
                {' · '}
                <Link to={localizedPath(lang, `/packages/${data.package.id}`)} className="mono">
                  {data.package.trackingNumber}
                </Link>
              </>
            ) : null}
          </p>
          {data.resolution ? <Alert tone="info" title={m.delivery.claims.resolution}>{data.resolution}</Alert> : null}
          <div aria-live="polite">
            {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
            {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          </div>

          <ol className="timeline" aria-label={m.delivery.claims.messages} data-testid="claim-messages">
            {data.messages.map((message) => (
              <li key={message.id}>
                <strong>{message.author === 'STAFF' ? c.staffAuthor : c.customerAuthor}</strong> {message.internal ? <span className="badge badge-warning">{c.internal}</span> : null}{' '}
                <span className="muted">· {formatDateTime(message.createdAt, lang)}</span>
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{message.body}</p>
              </li>
            ))}
          </ol>

          <CompensationCard claimId={id} />

          {canManage ? (
            <>
              <section className="card" aria-label={c.assign}>
                <h2 style={{ fontSize: '1.1rem' }}>{c.assign}</h2>
                <SelectField
                  name="claimAssignee"
                  label={c.assignedTo}
                  value={data.assignedTo?.id ?? ''}
                  onChange={(value) => void call(() => api(`/v1/admin/claims/${id}/assign`, { method: 'POST', body: { userId: value || null } }), c.assigned)}
                  options={[{ value: '', label: c.unassigned }, ...(staff.data?.items ?? []).map((u) => ({ value: u.id, label: u.name }))]}
                />
              </section>

              <form className="form card" onSubmit={send} noValidate aria-label={c.reply}>
                <h2 style={{ fontSize: '1.1rem' }}>{c.reply}</h2>
                <TextAreaField name="staffReply" label={c.message} value={body} onChange={setBody} error={errors.body} />
                <CheckField name="internalNote" checked={internal} onChange={setInternal}>
                  {c.internalNote}
                </CheckField>
                <div className="form-actions">
                  <Button type="submit">{internal ? c.addNote : c.send}</Button>
                </div>
              </form>

              <form className="form card" onSubmit={changeStatus} noValidate aria-label={c.changeStatus}>
                <h2 style={{ fontSize: '1.1rem' }}>{c.changeStatus}</h2>
                <SelectField
                  name="newStatus"
                  label={c.newStatus}
                  value={newStatus}
                  onChange={setNewStatus}
                  error={errors.status}
                  options={[{ value: '', label: '—' }, ...CLAIM_STATUSES.filter((s) => s !== data.status).map((s: ClaimStatus) => ({ value: s, label: m.delivery.claims.statuses[s] }))]}
                />
                {closing ? <TextAreaField name="resolution" label={c.resolution} value={resolution} onChange={setResolution} error={errors.resolution} /> : null}
                <div className="form-actions">
                  <Button type="submit" disabled={newStatus === ''}>
                    {c.apply}
                  </Button>
                </div>
              </form>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
