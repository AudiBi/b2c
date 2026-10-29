import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { forgotPasswordSchema, loginSchema, recoveryCodeSchema, resetPasswordSchema, totpCodeSchema } from '@b2c/shared';
import { ApiError, api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { config } from '../config';
import { apiErrorMessage } from '../forms/validation';
import { useZodForm } from '../forms/useZodForm';
import { LANGS, useI18n } from '../i18n';
import { paths } from '../routes';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { FormMessage, PasswordField, TextField } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';

/** Mise en page des écrans d'accès : panneau de présentation à gauche, formulaire à droite. */
function AuthLayout({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  const { m, lang, setLang } = useI18n();
  const points = m.admin.login.points;
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="plate">
          <img src="/logo-mark.svg" alt={config.brandName} width="80" height="44" />
        </div>
        <div>
          <h2>{m.admin.login.asideTitle}</h2>
          <p>{m.admin.login.asideText}</p>
          <ul>
            {points.map((point) => (
              <li key={point}>
                <Icon name="check" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <small style={{ color: '#7f93a8' }}>© {new Date().getFullYear()} {config.brandName}</small>
      </aside>
      <main className="auth-main">
        <div className="auth-box">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <div className="lang-switcher" role="group" aria-label={m.admin.topbar.language}>
              {LANGS.map((l) => (
                <button key={l} type="button" lang={l} aria-pressed={l === lang} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <h1>{title}</h1>
          {lead ? <p className="lead">{lead}</p> : null}
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { m } = useI18n();
  const f = m.auth.fields;
  const { login, logout, status, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useZodForm(loginSchema, { email: '', password: '' });
  const [platform, setPlatform] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Second facteur : demandé par le serveur une fois le mot de passe accepté
  const [needsCode, setNeedsCode] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [second, setSecond] = useState('');
  const [secondError, setSecondError] = useState<string | undefined>();

  // Redirection uniquement vers un écran du panel (jamais vers une adresse externe)
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith(paths.login) ? next : paths.home;

  useEffect(() => {
    if (status === 'authenticated' && user && user.kind !== 'CUSTOMER') navigate(target, { replace: true });
  }, [status, user, navigate, target]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const data = form.validate();
    if (!data) {
      setError(m.common.fixErrors);
      return;
    }
    let proof: { totpCode?: string; recoveryCode?: string } = {};
    if (needsCode) {
      const schema = useRecovery ? recoveryCodeSchema : totpCodeSchema;
      const checked = schema.safeParse(second.trim());
      if (!checked.success) {
        setSecondError(useRecovery ? m.auth.login.recoveryFormat : m.auth.login.totpFormat);
        return;
      }
      setSecondError(undefined);
      proof = useRecovery ? { recoveryCode: checked.data } : { totpCode: checked.data };
    }
    setBusy(true);
    try {
      const signedIn = await login(data.email, data.password, proof, { platform });
      if (signedIn.kind === 'CUSTOMER') {
        // Un compte client n'a rien à faire ici : on referme la session aussitôt
        await logout();
        setError(m.admin.login.staffOnly);
        return;
      }
      navigate(target, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTP_REQUIRED') {
        setNeedsCode(true);
        setError(null);
      } else {
        setError(apiErrorMessage(e, m));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={m.admin.login.title} lead={m.admin.login.lead}>
      <form className="form" onSubmit={submit} noValidate>
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
        <TextField name="email" type="email" label={f.email} value={String(form.values.email)} onChange={(v) => form.set('email', v)} error={form.errors.email} autoComplete="username" inputMode="email" />
        <PasswordField name="password" label={f.password} value={String(form.values.password)} onChange={(v) => form.set('password', v)} error={form.errors.password} autoComplete="current-password" />
        {needsCode ? (
          <>
            <p role="status" className="muted" style={{ margin: 0 }}>{useRecovery ? m.auth.login.recoveryLead : m.auth.login.totpLead}</p>
            <TextField
              name="secondFactor"
              label={useRecovery ? m.auth.login.recoveryCode : m.auth.login.totpCode}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={useRecovery ? 9 : 6}
              value={second}
              onChange={setSecond}
              error={secondError}
              spellCheck={false}
            />
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setSecond('');
                  setSecondError(undefined);
                }}
              >
                {useRecovery ? m.auth.login.useApp : m.auth.login.useRecovery}
              </Button>
            </div>
          </>
        ) : null}
        <div className="form-actions">
          <Button type="submit" block disabled={busy}>
            {busy ? m.common.loading : m.auth.login.submit}
          </Button>
        </div>
      </form>
      <div className="auth-links">
        <Link to={paths.forgotPassword}>{m.auth.login.forgot}</Link>
      </div>
      <div className="auth-switch">
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={platform} onClick={() => { setPlatform(!platform); setNeedsCode(false); setSecond(''); setError(null); }}>
          {platform ? m.admin.login.tenantMode : m.admin.login.platformMode}
        </button>
        {platform ? <p className="muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>{m.admin.nav.platform}</p> : null}
      </div>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { m } = useI18n();
  const form = useZodForm(forgotPasswordSchema, { companySlug: config.companySlug, email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const data = form.validate();
    if (!data) return;
    setBusy(true);
    try {
      await api('/v1/auth/forgot-password', { method: 'POST', auth: false, body: data });
      setDone(true);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={m.auth.forgot.title} lead={done ? undefined : m.auth.forgot.lead}>
      {done ? (
        <Alert tone="success" live>{m.auth.forgot.done}</Alert>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          <TextField name="email" type="email" label={m.auth.fields.email} value={String(form.values.email)} onChange={(v) => form.set('email', v)} error={form.errors.email} autoComplete="email" inputMode="email" />
          <div className="form-actions">
            <Button type="submit" block disabled={busy}>{busy ? m.common.loading : m.auth.forgot.submit}</Button>
          </div>
        </form>
      )}
      <div className="auth-links">
        <Link to={paths.login}>{m.auth.forgot.back}</Link>
      </div>
    </AuthLayout>
  );
}

/** Choix d'un mot de passe avec un jeton reçu par e-mail : réinitialisation ou activation d'un compte invité. */
function SetPasswordPage({ variant }: { variant: 'reset' | 'invite' }) {
  const { m } = useI18n();
  const text = variant === 'reset' ? m.auth.reset : m.auth.invite;
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const form = useZodForm(resetPasswordSchema, { token, newPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const data = form.validate();
    if (!data) return;
    setBusy(true);
    try {
      await api('/v1/auth/reset-password', { method: 'POST', auth: false, body: data });
      setDone(true);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title={text.title}>
        <Alert tone="danger">{m.auth.reset.missing}</Alert>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={text.title} lead={done ? undefined : text.lead}>
      {done ? (
        <>
          <Alert tone="success" live>{text.done}</Alert>
          <Link className="btn btn-primary" to={paths.login}>{m.auth.reset.login}</Link>
        </>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          <PasswordField name="newPassword" label={m.auth.fields.newPassword} hint={m.auth.fields.passwordHint} value={String(form.values.newPassword)} onChange={(v) => form.set('newPassword', v)} error={form.errors.newPassword} autoComplete="new-password" />
          <div className="form-actions">
            <Button type="submit" block disabled={busy}>{busy ? m.common.saving : text.submit}</Button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

export const ResetPasswordPage = () => <SetPasswordPage variant="reset" />;
export const AcceptInvitePage = () => <SetPasswordPage variant="invite" />;
