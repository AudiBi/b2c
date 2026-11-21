import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { totpCodeSchema, recoveryCodeSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { QrCode } from '../../components/QrCode';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, PasswordField, TextField } from '../../components/ui/Fields';

interface Status {
  enabled: boolean;
  pending: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

const groups = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/** Un code d'application (6 chiffres) ou de secours (xxxx-xxxx). */
function proofBody(code: string): { totpCode?: string; recoveryCode?: string } | null {
  const value = code.trim();
  if (totpCodeSchema.safeParse(value).success) return { totpCode: value };
  const recovery = recoveryCodeSchema.safeParse(value);
  return recovery.success ? { recoveryCode: recovery.data } : null;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone(): void }) {
  const { m } = useI18n();
  const t = m.account.security.twoFactor;
  return (
    <Alert tone="success" title={t.recoveryTitle}>
      <p>{t.recoveryLead}</p>
      <ul className="list-plain mono" aria-label={t.recoveryTitle} data-testid="recovery-codes" style={{ columns: 2, gap: 4 }}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button size="sm" onClick={onDone}>
        {t.recoverySaved}
      </Button>
    </Alert>
  );
}

/** Double authentification : activation (secret + premier code), codes de secours, désactivation. */
export function TwoFactorSection() {
  const { m } = useI18n();
  const t = m.account.security.twoFactor;
  const queryClient = useQueryClient();
  const { reload } = useAuth();
  const status = useQuery({ queryKey: ['me', '2fa'] as const, queryFn: () => api<Status>('/v1/me/2fa') });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<null | 'disable' | 'regenerate'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = status.data;

  async function run(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['me', '2fa'] });
    await reload();
  };

  const startSetup = (event: FormEvent) => {
    event.preventDefault();
    if (password === '') return setError(m.validation.required);
    void run(async () => {
      setSecret(await api('/v1/me/2fa/setup', { method: 'POST', body: { password } }));
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['me', '2fa'] });
    });
  };

  const enable = (event: FormEvent) => {
    event.preventDefault();
    if (!totpCodeSchema.safeParse(code.trim()).success) return setError(t.codeFormat);
    void run(async () => {
      const res = await api<{ recoveryCodes: string[] }>('/v1/me/2fa/enable', { method: 'POST', body: { code: code.trim() } });
      setCodes(res.recoveryCodes);
      setSecret(null);
      setCode('');
      await refresh();
    });
  };

  const confirmSensitive = (event: FormEvent) => {
    event.preventDefault();
    const proof = proofBody(code);
    if (password === '') return setError(m.validation.required);
    if (!proof) return setError(t.codeFormatAny);
    void run(async () => {
      if (mode === 'disable') {
        await api('/v1/me/2fa/disable', { method: 'POST', body: { password, ...proof } });
        setNotice(t.disabled);
      } else {
        const res = await api<{ recoveryCodes: string[] }>('/v1/me/2fa/recovery-codes', { method: 'POST', body: { password, ...proof } });
        setCodes(res.recoveryCodes);
      }
      setMode(null);
      setPassword('');
      setCode('');
      await refresh();
    });
  };

  return (
    <section className="card" aria-labelledby="twofa-title">
      <h2 id="twofa-title" style={{ fontSize: '1.2rem' }}>{t.title}</h2>
      <p>{t.lead}</p>
      {status.isPending ? <p role="status">{m.common.loading}</p> : null}
      {status.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> : null}

      {data && !data.enabled && !secret ? (
        <form className="form" onSubmit={startSetup} noValidate aria-label={t.activate}>
          {data.required ? <Alert tone="warning">{t.requiredNotice}</Alert> : <p className="muted">{t.off}</p>}
          <div className="card" data-testid="twofa-steps">
            <strong>{t.stepsTitle}</strong>
            <ol>
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3}</li>
              <li>{t.step4}</li>
            </ol>
          </div>
          <PasswordField name="twofaPassword" label={t.password} value={password} onChange={setPassword} autoComplete="current-password" />
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {t.activate}
            </Button>
          </div>
        </form>
      ) : null}

      {secret ? (
        <form className="form" onSubmit={enable} noValidate aria-label={t.confirmTitle}>
          <h3 style={{ fontSize: '1.05rem' }}>{t.scanTitle}</h3>
          <p>{t.scanLead}</p>
          <p>
            <QrCode value={secret.otpauthUri} alt={t.qrAlt} />
          </p>
          <details>
            <summary>{t.manualTitle}</summary>
            <p>{t.manualLead}</p>
            <p>
              {t.secret} : <strong className="mono" data-testid="twofa-secret">{groups(secret.secret)}</strong>
            </p>
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>
              {t.uri} : <span className="mono">{secret.otpauthUri}</span>
            </p>
          </details>
          <Alert tone="info">{t.timeHint}</Alert>
          <TextField name="twofaCode" label={t.code} hint={t.codeHint} inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={setCode} />
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {t.confirm}
            </Button>
          </div>
        </form>
      ) : null}

      {data?.enabled ? (
        <>
          <p>
            <span className="badge badge-success">{t.on}</span> · {format(t.codesLeft, { count: data.recoveryCodesLeft })}
          </p>
          {data.recoveryCodesLeft <= 2 ? <Alert tone="warning">{t.fewCodes}</Alert> : null}
          {mode ? (
            <form className="form" onSubmit={confirmSensitive} noValidate aria-label={mode === 'disable' ? t.disable : t.regenerate}>
              <PasswordField name="twofaPassword2" label={t.password} value={password} onChange={setPassword} autoComplete="current-password" />
              <TextField name="twofaProof" label={t.codeAny} hint={t.codeAnyHint} autoComplete="one-time-code" value={code} onChange={setCode} />
              <div className="form-actions">
                <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} disabled={busy}>
                  {mode === 'disable' ? t.disable : t.regenerate}
                </Button>
                <Button variant="outline" onClick={() => setMode(null)}>
                  {m.common.cancel}
                </Button>
              </div>
            </form>
          ) : (
            <div className="form-actions">
              <Button variant="outline" onClick={() => setMode('regenerate')}>
                {t.regenerate}
              </Button>
              {data.required ? null : (
                <Button variant="ghost" onClick={() => setMode('disable')}>
                  {t.disable}
                </Button>
              )}
            </div>
          )}
          {data.required ? <p className="muted">{t.requiredLocked}</p> : null}
        </>
      ) : null}
    </section>
  );
}
