import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EVENT_CODES, templateSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { financeKeys, useNotificationLog, useTemplates, type NotificationLogItem } from '../finance/queries';
import { useCan } from './queries';

const statusTone = (status: NotificationLogItem['status']) => (status === 'SENT' ? ' badge-success' : status === 'FAILED' ? ' badge-danger' : status === 'QUEUED' ? ' badge-warning' : '');

function Log() {
  const { m, lang } = useI18n();
  const n = m.finance.staff.notifications;
  const canManage = useCan('notification:template_manage');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const log = useNotificationLog({ status, channel });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function retry(id: string) {
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/admin/notifications/${id}/retry`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: financeKeys.log });
      setNotice(n.retried);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  async function process() {
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ sent: number; retried: number; failed: number }>('/v1/admin/notifications/process', { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: financeKeys.log });
      setNotice(format(n.processed, { sent: res.sent, retried: res.retried, failed: res.failed }));
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <section aria-labelledby="log-title">
      <h2 id="log-title" style={{ fontSize: '1.4rem' }}>{n.log}</h2>
      <div className="form-actions" style={{ alignItems: 'flex-end' }}>
        <SelectField name="logStatus" label={n.status} value={status} onChange={setStatus} options={[{ value: '', label: m.finance.common.all }, ...(Object.keys(n.statuses) as (keyof typeof n.statuses)[]).map((k) => ({ value: k, label: n.statuses[k] }))]} />
        <SelectField name="logChannel" label={n.channel} value={channel} onChange={setChannel} options={[{ value: '', label: m.finance.common.all }, ...(Object.keys(m.finance.channels) as (keyof typeof m.finance.channels)[]).map((k) => ({ value: k, label: m.finance.channels[k] }))]} />
        {canManage ? (
          <Button variant="outline" onClick={() => void process()}>
            {n.process}
          </Button>
        ) : null}
      </div>
      <div aria-live="polite">
        {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      </div>
      {log.isPending ? <p role="status">{m.common.loading}</p> : null}
      {log.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {log.data && log.data.items.length === 0 ? <Alert tone="info">{n.empty}</Alert> : null}
      <ul className="list-plain" aria-label={n.log}>
        {log.data?.items.map((item) => (
          <li key={item.id} className="card" data-testid="log-item">
            <div className="row-card">
              <div>
                <strong>{m.finance.events[item.eventCode as keyof typeof m.finance.events] ?? item.eventCode}</strong> · {m.finance.channels[item.channel]} · {item.customerCode}{' '}
                <span className={`badge${statusTone(item.status)}`}>{n.statuses[item.status]}</span>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {formatDateTime(item.createdAt, lang)}
                  {item.attempts > 0 ? ` · ${item.attempts} ${n.attempts}` : ''}
                  {item.skipReason ? ` · ${n.skipReasons[item.skipReason] ?? item.skipReason}` : ''}
                  {item.status === 'QUEUED' && item.nextAttemptAt ? ` · ${n.nextAttempt} ${formatDateTime(item.nextAttemptAt, lang)}` : ''}
                </p>
                {item.lastError && item.status !== 'SENT' ? <p style={{ margin: '4px 0 0' }}>{item.lastError}</p> : null}
              </div>
              {item.status === 'FAILED' && canManage ? (
                <Button variant="outline" size="sm" aria-label={`${n.retry} : ${item.customerCode} ${m.finance.events[item.eventCode as keyof typeof m.finance.events] ?? item.eventCode}`} onClick={() => void retry(item.id)}>
                  {n.retry}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Templates() {
  const { m } = useI18n();
  const n = m.finance.staff.notifications;
  const canManage = useCan('notification:template_manage');
  const queryClient = useQueryClient();
  const templates = useTemplates();
  const [eventCode, setEventCode] = useState<string>(EVENT_CODES[0]);
  const [channel, setChannel] = useState<'IN_APP' | 'EMAIL'>('EMAIL');
  const [locale, setLocale] = useState<'fr' | 'ht' | 'en'>('fr');
  const current = templates.data?.items.find((t) => t.eventCode === eventCode && t.channel === channel && t.locale === locale);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Le formulaire suit le modèle choisi (ou son rechargement après enregistrement)
  useEffect(() => {
    if (!current) return;
    setSubject(current.subject ?? '');
    setBody(current.body);
    setActive(current.active);
    setErrors({});
  }, [current?.eventCode, current?.channel, current?.locale, current?.source, current?.subject, current?.body, current?.active]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = templateSchema.safeParse({ eventCode, channel, locale, subject: channel === 'EMAIL' ? subject.trim() : undefined, body: body.trim(), active });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return;
    }
    setErrors({});
    try {
      await api('/v1/admin/notification-templates', { method: 'PUT', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: financeKeys.templates });
      setNotice(n.saved);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  async function reset() {
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/admin/notification-templates?${new URLSearchParams({ eventCode, channel, locale }).toString()}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: financeKeys.templates });
      setNotice(n.resetDone);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <section aria-labelledby="templates-title">
      <h2 id="templates-title" style={{ fontSize: '1.4rem' }}>{n.templates}</h2>
      <p className="muted">{n.templatesLead}</p>
      <div className="form-grid form-grid-2">
        <SelectField name="tplEvent" label={n.event} value={eventCode} onChange={setEventCode} options={EVENT_CODES.map((code) => ({ value: code, label: m.finance.events[code] }))} />
        <SelectField name="tplChannel" label={n.channel} value={channel} onChange={(v) => setChannel(v as 'IN_APP' | 'EMAIL')} options={[{ value: 'IN_APP', label: m.finance.channels.IN_APP }, { value: 'EMAIL', label: m.finance.channels.EMAIL }]} />
        <SelectField name="tplLocale" label={n.locale} value={locale} onChange={(v) => setLocale(v as 'fr' | 'ht' | 'en')} options={[{ value: 'fr', label: m.lang.fr }, { value: 'ht', label: m.lang.ht }, { value: 'en', label: m.lang.en }]} />
      </div>
      {templates.isPending ? <p role="status">{m.common.loading}</p> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {current ? (
        <form className="form card" onSubmit={save} noValidate aria-label={n.templates}>
          <p>
            <span className={`badge${current.source === 'COMPANY' ? ' badge-success' : ''}`}>{current.source === 'COMPANY' ? n.sourceCompany : n.sourceDefault}</span>
          </p>
          <p className="muted">
            {n.variables} : {current.variables.map((v) => `{${v}}`).join(' ')}
          </p>
          {current.mandatory ? <Alert tone="info">{n.mandatory}</Alert> : null}
          {channel === 'EMAIL' ? <TextField name="tplSubject" label={n.subject} value={subject} onChange={setSubject} error={errors.subject} disabled={!canManage} /> : null}
          <TextAreaField name="tplBody" label={n.body} value={body} onChange={setBody} error={errors.body} />
          {current.mandatory ? null : (
            <CheckField name="tplActive" checked={active} onChange={setActive}>
              {n.active}
            </CheckField>
          )}
          {canManage ? (
            <div className="form-actions">
              <Button type="submit">{n.save}</Button>
              {current.source === 'COMPANY' ? (
                <Button variant="outline" onClick={() => void reset()}>
                  {n.reset}
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

export function StaffNotificationsPage() {
  const { m } = useI18n();
  const n = m.finance.staff.notifications;
  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{n.title}</h1>
      <p className="lead">{n.lead}</p>
      <Log />
      <Templates />
    </>
  );
}
