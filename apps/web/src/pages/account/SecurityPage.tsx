import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { changePasswordSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../forms/validation';
import { useZodForm } from '../../forms/useZodForm';
import { useI18n } from '../../i18n';
import { localized } from '../../routes';
import { Button } from '../../components/ui/Button';
import { FormMessage, PasswordField } from '../../components/ui/Fields';
import { Alert } from '../../components/ui/Alert';
import { TwoFactorSection } from './TwoFactorSection';

export function SecurityPage() {
  const { m, lang } = useI18n();
  const s = m.account.security;
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const form = useZodForm(changePasswordSchema, { currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    const data = form.validate();
    if (!data) {
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      await api('/v1/auth/change-password', { method: 'POST', body: data });
      form.reset({ currentPassword: '', newPassword: '' });
      setDone(true);
    } catch (e) {
      if (!form.applyServerError(e)) setError(apiErrorMessage(e, m));
      else setError(m.common.fixErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{s.title}</h1>
      <p className="lead">{s.lead}</p>
      {user?.mfa?.enrollmentRequired ? <Alert tone="warning">{s.twoFactor.enrollmentRequired}</Alert> : null}
      <TwoFactorSection />
      <form className="form card" onSubmit={submit} noValidate aria-label={s.submit}>
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
        {done ? <FormMessage tone="success">{s.done}</FormMessage> : null}
        <PasswordField name="currentPassword" label={m.auth.fields.currentPassword} value={String(form.values.currentPassword)} onChange={(v) => form.set('currentPassword', v)} error={form.errors.currentPassword} autoComplete="current-password" />
        <PasswordField name="newPassword" label={m.auth.fields.newPassword} hint={m.auth.fields.passwordHint} value={String(form.values.newPassword)} onChange={(v) => form.set('newPassword', v)} error={form.errors.newPassword} autoComplete="new-password" />
        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? m.common.saving : s.submit}
          </Button>
        </div>
      </form>
      <div className="card">
        <Button
          variant="outline"
          onClick={async () => {
            await logout({ allSessions: true });
            navigate(localized(lang, 'login'));
          }}
        >
          {s.logoutAll}
        </Button>
      </div>
    </>
  );
}
