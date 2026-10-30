import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TEAM_MAX_MEMBERS, teamInviteSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useZodForm } from '../../forms/useZodForm';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';

type TeamRole = 'READER' | 'OPERATOR';
interface TeamMember {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'LOCKED';
  role: TeamRole | null;
  lastLoginAt: string | null;
}
const teamKey = ['me', 'team'] as const;

function InviteForm({ onDone }: { onDone(): void }) {
  const { m, lang } = useI18n();
  const t = m.account.team;
  const queryClient = useQueryClient();
  const form = useZodForm(teamInviteSchema, { email: '', firstName: '', lastName: '', role: 'READER', locale: lang });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const data = form.validate();
    if (!data) {
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      await api('/v1/me/team', { method: 'POST', body: { ...data, locale: lang } });
      await queryClient.invalidateQueries({ queryKey: teamKey });
      onDone();
    } catch (e) {
      if (!form.applyServerError(e)) setError(apiErrorMessage(e, m));
      else setError(m.common.fixErrors);
    } finally {
      setBusy(false);
    }
  }

  const v = (name: string) => String(form.values[name] ?? '');
  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={t.invite}>
      <h2 style={{ fontSize: '1.2rem' }}>{t.invite}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <div className="form-grid form-grid-2">
        <TextField name="firstName" label={m.auth.fields.firstName} value={v('firstName')} onChange={(x) => form.set('firstName', x)} error={form.errors.firstName} autoComplete="off" />
        <TextField name="lastName" label={m.auth.fields.lastName} value={v('lastName')} onChange={(x) => form.set('lastName', x)} error={form.errors.lastName} autoComplete="off" />
      </div>
      <TextField name="email" type="email" label={m.auth.fields.email} value={v('email')} onChange={(x) => form.set('email', x)} error={form.errors.email} autoComplete="off" />
      <SelectField
        name="role"
        label={t.role}
        value={v('role')}
        onChange={(x) => form.set('role', x)}
        error={form.errors.role}
        hint={t.roleHelp[(v('role') as TeamRole) || 'READER']}
        options={(['READER', 'OPERATOR'] as const).map((r) => ({ value: r, label: t.roles[r] }))}
      />
      <p className="muted">{t.inviteHint}</p>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? m.common.saving : t.sendInvite}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Équipe du compte professionnel : réservée au propriétaire. Un membre ne voit jamais cette page. */
export function TeamPage() {
  const { m } = useI18n();
  const t = m.account.team;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: teamKey, queryFn: () => api<{ limit: number; items: TeamMember[] }>('/v1/me/team'), enabled: !!user?.permissions.includes('team:manage_own') });
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mfaMissing = !!user && !user.mfa?.enabled;

  if (user && !user.permissions.includes('team:manage_own')) return <Alert tone="info">{t.businessOnly}</Alert>;

  async function changeRole(member: TeamMember, role: TeamRole) {
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/me/team/${member.userId}`, { method: 'PATCH', body: { role } });
      await queryClient.invalidateQueries({ queryKey: teamKey });
      setNotice(t.roleChanged);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  async function remove(member: TeamMember) {
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/me/team/${member.userId}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: teamKey });
      setNotice(t.removed);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setConfirming(null);
    }
  }

  const count = list.data?.items.length ?? 0;
  const full = count >= (list.data?.limit ?? TEAM_MAX_MEMBERS);
  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{t.title}</h1>
      <p className="lead">{t.lead}</p>
      <Alert tone="info" title={t.rulesTitle}>
        <ul>
          {t.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </Alert>
      {mfaMissing ? <Alert tone="warning">{t.mfaRequired}</Alert> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}

      {adding ? (
        <InviteForm
          onDone={() => {
            setAdding(false);
            setNotice(t.invited);
          }}
        />
      ) : (
        <p>
          <Button disabled={full} onClick={() => { setNotice(null); setAdding(true); }}>
            {t.invite}
          </Button>{' '}
          <span className="muted">{`${count} / ${list.data?.limit ?? TEAM_MAX_MEMBERS}`}</span>
        </p>
      )}

      {list.isPending ? <p role="status">{m.common.loading}</p> : null}
      {list.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {list.data && list.data.items.length === 0 ? <Alert tone="info">{t.empty}</Alert> : null}
      <ul className="list-plain">
        {list.data?.items.map((member) => {
          const name = `${member.firstName} ${member.lastName}`;
          return (
            <li key={member.userId} className="card">
              <div className="row-card">
                <div>
                  <h2 style={{ fontSize: '1.1rem' }}>{name}</h2>
                  <p className="muted">{member.email}</p>
                  <p>
                    <span className={member.status === 'ACTIVE' ? 'badge badge-success' : 'badge badge-warning'}>{t.status[member.status] ?? member.status}</span>
                  </p>
                </div>
                <div className="form-actions">
                  <SelectField
                    name={`role-${member.userId}`}
                    label={t.role}
                    value={member.role ?? 'READER'}
                    onChange={(x) => changeRole(member, x as TeamRole)}
                    options={(['READER', 'OPERATOR'] as const).map((r) => ({ value: r, label: t.roles[r] }))}
                  />
                  {confirming === member.userId ? (
                    <Button variant="danger" size="sm" onClick={() => remove(member)}>
                      {t.confirmRemove}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(member.userId)} aria-label={`${t.remove} : ${name}`}>
                      {t.remove}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
