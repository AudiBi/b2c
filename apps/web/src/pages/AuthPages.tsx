import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  forgotPasswordSchema,
  loginSchema,
  recoveryCodeSchema,
  totpCodeSchema,
  registerSchema,
  resetPasswordSchema,
  resendVerificationSchema,
  LOCALES,
} from '@b2c/shared';
import { ApiError, api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { config } from '../config';
import { apiErrorMessage } from '../forms/validation';
import { useZodForm } from '../forms/useZodForm';
import { useI18n } from '../i18n';
import { localized } from '../routes';
import { usePageMeta } from '../seo';
import { LocLink } from '../components/LocLink';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { CheckField, FormMessage, PasswordField, RadioGroupField, SelectField, TextField } from '../components/ui/Fields';
import { PageHero } from '../components/ui/Sections';

function AuthCard({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <>
      <PageHero title={title} lead={lead} />
      <div className="container">
        <div className="card auth-card">{children}</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Inscription
// ---------------------------------------------------------------------------------------------

export function RegisterPage() {
  const { m, lang } = useI18n();
  const f = m.auth.fields;
  usePageMeta('register');
  const form = useZodForm(registerSchema, {
    companySlug: config.companySlug,
    accountType: 'INDIVIDUAL',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    businessName: '',
    locale: lang,
    acceptTerms: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
      await api('/v1/auth/register', { method: 'POST', auth: false, body: data });
      setDone(true);
    } catch (e) {
      if (!form.applyServerError(e)) setError(apiErrorMessage(e, m));
      else setError(m.common.fixErrors);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title={m.auth.register.doneTitle}>
        <Alert tone="success" live>
          {m.auth.register.done}
        </Alert>
      </AuthCard>
    );
  }

  const isBusiness = form.values.accountType === 'BUSINESS';
  return (
    <AuthCard title={m.auth.register.title} lead={m.auth.register.lead}>
      <form className="form" onSubmit={submit} noValidate>
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
        <RadioGroupField
          legend={f.accountType}
          name="accountType"
          value={String(form.values.accountType)}
          onChange={(v) => form.set('accountType', v)}
          options={[
            { value: 'INDIVIDUAL', label: f.individual },
            { value: 'BUSINESS', label: f.business },
          ]}
        />
        {isBusiness ? (
          <TextField name="businessName" label={f.businessName} value={String(form.values.businessName)} onChange={(v) => form.set('businessName', v)} error={form.errors.businessName} autoComplete="organization" />
        ) : null}
        <div className="form-grid form-grid-2">
          <TextField name="firstName" label={f.firstName} value={String(form.values.firstName)} onChange={(v) => form.set('firstName', v)} error={form.errors.firstName} autoComplete="given-name" />
          <TextField name="lastName" label={f.lastName} value={String(form.values.lastName)} onChange={(v) => form.set('lastName', v)} error={form.errors.lastName} autoComplete="family-name" />
        </div>
        <TextField name="email" type="email" label={f.email} value={String(form.values.email)} onChange={(v) => form.set('email', v)} error={form.errors.email} autoComplete="email" inputMode="email" />
        <TextField name="phone" type="tel" label={f.phone} optional hint={f.phoneHint} value={String(form.values.phone)} onChange={(v) => form.set('phone', v)} error={form.errors.phone} autoComplete="tel" inputMode="tel" />
        <PasswordField name="password" label={f.password} hint={f.passwordHint} value={String(form.values.password)} onChange={(v) => form.set('password', v)} error={form.errors.password} autoComplete="new-password" />
        <SelectField
          name="locale"
          label={f.language}
          value={String(form.values.locale)}
          onChange={(v) => form.set('locale', v)}
          options={LOCALES.map((code) => ({ value: code, label: m.lang[code] }))}
        />
        <CheckField name="acceptTerms" checked={Boolean(form.values.acceptTerms)} onChange={(v) => form.set('acceptTerms', v)} error={form.errors.acceptTerms}>
          {f.acceptTerms}{' '}
          (<LocLink page="terms">{m.footer.terms}</LocLink>, <LocLink page="privacy">{m.footer.privacy}</LocLink>)
        </CheckField>
        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? m.common.saving : m.auth.register.submit}
          </Button>
        </div>
      </form>
      <p className="auth-links">
        {m.auth.register.haveAccount} <LocLink page="login">{m.nav.login}</LocLink>
      </p>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------------------------

export function LoginPage() {
  const { m, lang } = useI18n();
  const f = m.auth.fields;
  usePageMeta('login');
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useZodForm(loginSchema, { companySlug: config.companySlug, email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // Second facteur : demandé par le serveur une fois le mot de passe accepté
  const [needsCode, setNeedsCode] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [second, setSecond] = useState('');
  const [secondError, setSecondError] = useState<string | undefined>();

  // Redirection uniquement vers une page de l'espace client du même site (jamais vers une URL externe)
  const next = params.get('next');
  const target = next && next.startsWith(`/${lang}/account`) && !next.startsWith('//') ? next : localized(lang, 'account');

  useEffect(() => {
    if (status === 'authenticated') navigate(target, { replace: true });
  }, [status, navigate, target]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCode(null);
    const data = form.validate();
    if (!data) {
      setError(m.common.fixErrors);
      return;
    }
    let proof: { totpCode?: string; recoveryCode?: string } = {};
    if (needsCode) {
      const value = second.trim();
      const schema = useRecovery ? recoveryCodeSchema : totpCodeSchema;
      const checked = schema.safeParse(value);
      if (!checked.success) {
        setSecondError(useRecovery ? m.auth.login.recoveryFormat : m.auth.login.totpFormat);
        return;
      }
      setSecondError(undefined);
      proof = useRecovery ? { recoveryCode: checked.data } : { totpCode: checked.data };
    }
    setBusy(true);
    try {
      await login(data.email, data.password, proof);
      navigate(target, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTP_REQUIRED') {
        setNeedsCode(true);
        setError(null);
      } else {
        setError(apiErrorMessage(e, m));
        if (e instanceof ApiError) setCode(e.code);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    const parsed = resendVerificationSchema.safeParse({ companySlug: config.companySlug, email: String(form.values.email).trim() });
    if (!parsed.success) return;
    try {
      await api('/v1/auth/resend-verification', { method: 'POST', auth: false, body: parsed.data });
    } catch {
      /* la réponse est volontairement identique */
    }
    setResent(true);
  }

  return (
    <AuthCard title={m.auth.login.title} lead={m.auth.login.lead}>
      <form className="form" onSubmit={submit} noValidate>
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
        {code === 'EMAIL_NOT_VERIFIED' ? (
          <div>
            <Button variant="outline" size="sm" onClick={resend}>
              {m.auth.login.resend}
            </Button>
            {resent ? (
              <p role="status" className="muted">
                {m.auth.login.resent}
              </p>
            ) : null}
          </div>
        ) : null}
        <TextField name="email" type="email" label={f.email} value={String(form.values.email)} onChange={(v) => form.set('email', v)} error={form.errors.email} autoComplete="username" inputMode="email" />
        <PasswordField name="password" label={f.password} value={String(form.values.password)} onChange={(v) => form.set('password', v)} error={form.errors.password} autoComplete="current-password" />
        {needsCode ? (
          <>
            <p role="status">{useRecovery ? m.auth.login.recoveryLead : m.auth.login.totpLead}</p>
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
          </>
        ) : null}
        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? m.common.loading : m.auth.login.submit}
          </Button>
          <LocLink page="forgotPassword">{m.auth.login.forgot}</LocLink>
        </div>
      </form>
      <p className="auth-links">
        {m.auth.login.noAccount} <LocLink page="register">{m.nav.register}</LocLink>
      </p>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Mot de passe oublié, nouveau mot de passe, invitation
// ---------------------------------------------------------------------------------------------

export function ForgotPasswordPage() {
  const { m } = useI18n();
  usePageMeta('forgotPassword');
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
    <AuthCard title={m.auth.forgot.title} lead={done ? undefined : m.auth.forgot.lead}>
      {done ? (
        <Alert tone="success" live>
          {m.auth.forgot.done}
        </Alert>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          <TextField name="email" type="email" label={m.auth.fields.email} value={String(form.values.email)} onChange={(v) => form.set('email', v)} error={form.errors.email} autoComplete="email" inputMode="email" />
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? m.common.loading : m.auth.forgot.submit}
            </Button>
          </div>
        </form>
      )}
      <p className="auth-links">
        <LocLink page="login">{m.auth.forgot.back}</LocLink>
      </p>
    </AuthCard>
  );
}

/** Choix d'un mot de passe avec un jeton reçu par e-mail : réinitialisation ou activation d'un compte invité. */
function SetPasswordPage({ variant }: { variant: 'reset' | 'invite' }) {
  const { m } = useI18n();
  const text = variant === 'reset' ? m.auth.reset : m.auth.invite;
  usePageMeta(variant === 'reset' ? 'resetPassword' : 'acceptInvite');
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
      <AuthCard title={text.title}>
        <Alert tone="danger">{m.auth.reset.missing}</Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={text.title} lead={done ? undefined : text.lead}>
      {done ? (
        <>
          <Alert tone="success" live>
            {text.done}
          </Alert>
          <ButtonLink page="login">{m.auth.reset.login}</ButtonLink>
        </>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          <PasswordField name="newPassword" label={m.auth.fields.newPassword} hint={m.auth.fields.passwordHint} value={String(form.values.newPassword)} onChange={(v) => form.set('newPassword', v)} error={form.errors.newPassword} autoComplete="new-password" />
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? m.common.saving : text.submit}
            </Button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

export const ResetPasswordPage = () => <SetPasswordPage variant="reset" />;
export const AcceptInvitePage = () => <SetPasswordPage variant="invite" />;

// Un jeton ne sert qu'une fois : en développement (rendu double de React) on évite de l'envoyer deux fois
const pendingVerifications = new Map<string, Promise<unknown>>();

export function VerifyEmailPage() {
  const { m } = useI18n();
  usePageMeta('verifyEmail');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    let request = pendingVerifications.get(token);
    if (!request) {
      request = api('/v1/auth/verify-email', { method: 'POST', auth: false, body: { token } });
      pendingVerifications.set(token, request);
    }
    request.then(
      () => setState('done'),
      () => setState('failed'),
    );
  }, [token]);

  return (
    <AuthCard title={m.auth.verify.title}>
      {state === 'working' ? <p role="status">{m.auth.verify.working}</p> : null}
      {state === 'done' ? (
        <Alert tone="success" live>
          {m.auth.verify.done}
        </Alert>
      ) : null}
      {state === 'failed' ? (
        <Alert tone="danger" live>
          {m.auth.verify.failed}
        </Alert>
      ) : null}
      {state !== 'working' ? (
        <ButtonLink page="login">{m.auth.verify.login}</ButtonLink>
      ) : null}
    </AuthCard>
  );
}
