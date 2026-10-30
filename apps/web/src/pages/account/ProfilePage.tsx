import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LOCALES, updateProfileSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../forms/validation';
import { useZodForm } from '../../forms/useZodForm';
import { useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { keys, useProfile, type NotificationPrefs } from './queries';

export function ProfilePage() {
  const { m } = useI18n();
  const p = m.account.profile;
  const f = m.auth.fields;
  const queryClient = useQueryClient();
  const { reload } = useAuth();
  const profile = useProfile();
  const form = useZodForm(updateProfileSchema, {});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const data = profile.data;
    if (!data || loaded) return;
    form.reset({
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone ?? '',
      locale: data.locale,
      businessName: data.businessName ?? '',
      notificationPrefs: data.customer?.notificationPrefs,
    });
    setLoaded(true);
  }, [profile.data, loaded, form]);

  if (profile.isPending) return <p role="status">{m.common.loading}</p>;
  if (profile.isError || !profile.data) return <Alert tone="danger">{m.common.errorLoad}</Alert>;

  const data = profile.data;
  const isBusiness = data.customer?.customerType === 'BUSINESS';
  const prefs = (form.values.notificationPrefs ?? data.customer?.notificationPrefs) as NotificationPrefs | undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = form.validate();
    if (!parsed) {
      setError(m.common.fixErrors);
      return;
    }
    // Un téléphone vidé est envoyé comme null pour être effacé
    const payload = { ...parsed, ...(parsed.phone === undefined && data.phone ? { phone: null } : {}) };
    setBusy(true);
    try {
      await api('/v1/me/profile', { method: 'PATCH', body: payload });
      await queryClient.invalidateQueries({ queryKey: keys.profile });
      await queryClient.invalidateQueries({ queryKey: keys.receiving });
      await reload();
      setSaved(true);
    } catch (e) {
      if (!form.applyServerError(e)) setError(apiErrorMessage(e, m));
      else setError(m.common.fixErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{p.title}</h1>
      <p className="lead">{p.lead}</p>
      <form className="form card" onSubmit={submit} noValidate>
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
        {saved ? <FormMessage tone="success">{m.common.saved}</FormMessage> : null}
        <div className="field">
          <span className="label-like" style={{ fontWeight: 600 }}>{f.email}</span>
          <span>
            {data.email}{' '}
            {data.emailVerified ? <span className="badge badge-success">{p.emailVerified}</span> : null}
          </span>
          <span className="hint">{p.emailLocked}</span>
        </div>
        <div className="form-grid form-grid-2">
          <TextField name="firstName" label={f.firstName} value={String(form.values.firstName ?? '')} onChange={(v) => form.set('firstName', v)} error={form.errors.firstName} autoComplete="given-name" />
          <TextField name="lastName" label={f.lastName} value={String(form.values.lastName ?? '')} onChange={(v) => form.set('lastName', v)} error={form.errors.lastName} autoComplete="family-name" />
        </div>
        {isBusiness ? (
          <TextField name="businessName" label={f.businessName} value={String(form.values.businessName ?? '')} onChange={(v) => form.set('businessName', v)} error={form.errors.businessName} autoComplete="organization" />
        ) : null}
        <TextField name="phone" type="tel" label={f.phone} optional hint={data.phone && !data.phoneVerified ? `${f.phoneHint} (${p.phoneNotVerified})` : f.phoneHint} value={String(form.values.phone ?? '')} onChange={(v) => form.set('phone', v)} error={form.errors.phone} autoComplete="tel" inputMode="tel" />
        <SelectField
          name="locale"
          label={f.language}
          value={String(form.values.locale ?? data.locale)}
          onChange={(v) => form.set('locale', v)}
          options={LOCALES.map((code) => ({ value: code, label: m.lang[code] }))}
        />

        {prefs ? (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{p.notificationsTitle}</legend>
            <p className="hint">{p.notificationsText}</p>
            {(['email', 'whatsapp', 'inApp'] as const).map((channel) => (
              <CheckField key={channel} name={`pref-${channel}`} checked={prefs[channel]} onChange={(checked) => form.set('notificationPrefs', { ...prefs, [channel]: checked })}>
                {p.channels[channel]}
              </CheckField>
            ))}
            <p className="hint">{p.channelsNote}</p>
          </fieldset>
        ) : null}

        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? m.common.saving : m.common.save}
          </Button>
        </div>
      </form>
    </>
  );
}
