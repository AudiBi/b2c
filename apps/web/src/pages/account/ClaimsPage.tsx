import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { CLAIM_CATEGORIES, createClaimSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { deliveryKeys, useMyClaim, useMyClaims, type ClaimStatus } from '../delivery/queries';
import { usePackages } from './queries';

export const claimTone = (status: ClaimStatus) => (status === 'RESOLVED' ? ' badge-success' : status === 'REJECTED' ? ' badge-danger' : status === 'IN_PROGRESS' ? ' badge-warning' : '');

function NewClaimForm({ onDone }: { onDone(): void }) {
  const { m, lang } = useI18n();
  const c = m.delivery.claims;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const packages = usePackages({ status: '', q: '' });
  const options = packages.data?.pages.flatMap((p) => p.items) ?? [];
  const preselected = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('package') ?? '' : '';
  const [category, setCategory] = useState<string>(CLAIM_CATEGORIES[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [packageId, setPackageId] = useState(preselected);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createClaimSchema.safeParse({ category, subject: subject.trim(), message: message.trim(), packageId: packageId || undefined });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/v1/me/claims', { method: 'POST', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.myClaims });
      navigate(localizedPath(lang, `/account/claims/${created.id}`));
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={c.new}>
      <h2 style={{ fontSize: '1.2rem' }}>{c.new}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <SelectField name="category" label={c.fields.category} value={category} onChange={setCategory} options={CLAIM_CATEGORIES.map((x) => ({ value: x, label: c.categories[x] }))} error={errors.category} />
      <SelectField
        name="package"
        label={c.fields.package}
        optional
        value={packageId}
        onChange={setPackageId}
        options={[{ value: '', label: c.fields.noPackage }, ...options.map((p) => ({ value: p.id, label: p.trackingNumberDisplay }))]}
        error={errors.packageId}
      />
      <TextField name="subject" label={c.fields.subject} value={subject} onChange={setSubject} error={errors.subject} />
      <TextAreaField name="message" label={c.fields.message} value={message} onChange={setMessage} error={errors.message} />
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? m.common.saving : c.submit}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

export function ClaimsPage() {
  const { m, lang } = useI18n();
  const c = m.delivery.claims;
  const claims = useMyClaims();
  const [adding, setAdding] = useState(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('package'));

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{c.title}</h1>
      <p className="lead">{c.lead}</p>
      {adding ? (
        <NewClaimForm onDone={() => setAdding(false)} />
      ) : (
        <p>
          <Button onClick={() => setAdding(true)}>{c.new}</Button>
        </p>
      )}
      {claims.isPending ? <p role="status">{m.common.loading}</p> : null}
      {claims.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {claims.data && claims.data.items.length === 0 ? <Alert tone="info">{c.empty}</Alert> : null}
      <ul className="list-plain" aria-label={c.title}>
        {claims.data?.items.map((item) => (
          <li key={item.id} className="card" data-testid="claim-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  <span className="mono">{item.number}</span> <span className={`badge${claimTone(item.status)}`}>{c.statuses[item.status]}</span>
                </h2>
                <p style={{ margin: 0 }}>
                  {item.subject} · {c.categories[item.category]}
                </p>
                <p className="muted" style={{ margin: '4px 0 0' }}>{formatDateTime(item.openedAt, lang)}</p>
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/account/claims/${item.id}`)} aria-label={`${c.open} : ${item.number}`}>
                {c.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ClaimDetailPage() {
  const { id = '' } = useParams();
  const { m, lang } = useI18n();
  const c = m.delivery.claims;
  const queryClient = useQueryClient();
  const query = useMyClaim(id);
  const data = query.data;
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (body.trim() === '') {
      setFieldError(m.validation.required);
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    try {
      await api(`/v1/me/claims/${id}/messages`, { method: 'POST', body: { body: body.trim() } });
      setBody('');
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.myClaims });
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  const closed = data?.status === 'RESOLVED' || data?.status === 'REJECTED';
  return (
    <>
      <p>
        <Link to={localizedPath(lang, '/account/claims')}>← {c.back}</Link>
      </p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.auth.errors.CLAIM_NOT_FOUND}</Alert> : null}
      {data ? (
        <>
          <h1 style={{ fontSize: '1.7rem' }}>
            <span className="mono">{data.number}</span> <span className={`badge${claimTone(data.status)}`}>{c.statuses[data.status]}</span>
          </h1>
          <p>
            <strong>{data.subject}</strong> · {c.categories[data.category]}
            {data.package ? (
              <>
                {' · '}
                <Link to={localizedPath(lang, `/account/packages/${data.package.id}`)} className="mono">
                  {data.package.trackingNumber}
                </Link>
              </>
            ) : null}
          </p>
          {data.resolution ? (
            <Alert tone={data.status === 'RESOLVED' ? 'success' : 'info'} title={c.resolution}>
              {data.resolution}
            </Alert>
          ) : null}
          <ol className="timeline" aria-label={c.messages} data-testid="claim-messages">
            {data.messages.map((message) => (
              <li key={message.id}>
                <strong>{message.author === 'STAFF' ? c.fromStaff : c.fromYou}</strong> <span className="muted">· {formatDateTime(message.createdAt, lang)}</span>
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{message.body}</p>
              </li>
            ))}
          </ol>
          {closed ? (
            <Alert tone="info">{c.closed}</Alert>
          ) : (
            <form className="form card" onSubmit={send} noValidate>
              {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
              <TextAreaField name="reply" label={c.reply} value={body} onChange={setBody} error={fieldError} />
              <div className="form-actions">
                <Button type="submit" disabled={busy}>
                  {busy ? m.common.saving : c.send}
                </Button>
              </div>
            </form>
          )}
        </>
      ) : null}
    </>
  );
}
