import { useState, type FormEvent } from 'react';
import { handoverSchema } from '@b2c/shared';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, RadioGroupField, SelectField, TextField } from '../../components/ui/Fields';
import { useFiles } from '../shared/queries';
import type { BeneficiaryOption, HandoverSettings } from './queries';

export const ID_TYPES = ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE', 'OTHER'] as const;

interface Props {
  packageId: string;
  settings: HandoverSettings;
  beneficiaries: BeneficiaryOption[];
  /** Solde dû ou colis non facturé : bloque la remise, sauf dérogation (si le droit existe). */
  balance: { due: string; currency: string | null; unbilled: boolean } | null;
  canOverride: boolean;
  submitLabel: string;
  onSubmit(body: Record<string, unknown>): Promise<void>;
}

/** Formulaire de remise : preuves exigées par la règle de l'entreprise, contrôlées avec le schéma partagé puis par le serveur. */
export function HandoverForm({ packageId, settings, beneficiaries, balance, canOverride, submitLabel, onSubmit }: Props) {
  const { m, lang } = useI18n();
  const h = m.delivery.handover;
  const files = useFiles('PACKAGE', packageId);
  const photos = (files.data?.items ?? []).filter((f) => f.kind === 'PHOTO');

  const [kind, setKind] = useState<'CUSTOMER' | 'BENEFICIARY'>('CUSTOMER');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [name, setName] = useState('');
  const [idType, setIdType] = useState<string>(ID_TYPES[0]);
  const [last4, setLast4] = useState('');
  const [otp, setOtp] = useState('');
  const [photoId, setPhotoId] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const body = {
      recipientKind: kind,
      beneficiaryId: kind === 'BENEFICIARY' ? beneficiaryId || undefined : undefined,
      recipientName: name.trim() === '' ? undefined : name.trim(),
      idDocumentType: last4.trim() === '' ? undefined : idType,
      idDocumentLast4: last4.trim() === '' ? undefined : last4.trim(),
      otp: otp.trim() === '' ? undefined : otp.trim(),
      proofFileId: photoId || undefined,
      overrideBalance: override ? { reason: reason.trim() } : undefined,
    };
    const parsed = handoverSchema.safeParse(body);
    const manual: FieldErrors = {};
    if (settings.requireOtp && !body.otp) manual.otp = m.validation.required;
    if (settings.requireIdDocument && !body.idDocumentLast4) manual.idDocumentLast4 = m.validation.required;
    if (settings.requirePhoto && !body.proofFileId) manual.proofFileId = m.validation.required;
    const all = { ...(parsed.success ? {} : issuesToErrors(parsed.error, m)), ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      setError(m.common.fixErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data as Record<string, unknown>);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  const blocked = !!balance;
  return (
    <form className="form" onSubmit={submit} noValidate aria-label={submitLabel}>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {balance ? (
        <Alert tone="warning">
          {balance.unbilled ? h.unbilled : format(h.balanceDue, { amount: formatMoney(balance.due, balance.currency ?? 'USD', lang) })} {canOverride ? h.overrideHint : h.blocked}
        </Alert>
      ) : null}

      <RadioGroupField
        legend={h.recipient}
        name={`recipient-${packageId}`}
        value={kind}
        onChange={(v) => setKind(v as 'CUSTOMER' | 'BENEFICIARY')}
        options={[
          { value: 'CUSTOMER', label: h.recipientCustomer },
          { value: 'BENEFICIARY', label: h.recipientBeneficiary },
        ]}
      />
      {kind === 'BENEFICIARY' ? (
        beneficiaries.length === 0 ? (
          <Alert tone="info">{h.noBeneficiary}</Alert>
        ) : (
          <SelectField
            name={`beneficiary-${packageId}`}
            label={h.beneficiary}
            value={beneficiaryId}
            onChange={setBeneficiaryId}
            error={errors.beneficiaryId}
            options={[{ value: '', label: '—' }, ...beneficiaries.map((b) => ({ value: b.id, label: `${b.fullName}${b.idDocumentLast4 ? ` · …${b.idDocumentLast4}` : ''}` }))]}
          />
        )
      ) : null}
      <TextField name={`name-${packageId}`} label={h.recipientName} optional value={name} onChange={setName} error={errors.recipientName} />

      <div className="form-grid form-grid-2">
        <SelectField name={`idtype-${packageId}`} label={h.idType} value={idType} onChange={setIdType} options={ID_TYPES.map((x) => ({ value: x, label: h.idTypes[x] }))} />
        <TextField
          name={`last4-${packageId}`}
          label={h.idLast4}
          hint={h.idLast4Hint}
          optional={!settings.requireIdDocument}
          maxLength={4}
          autoComplete="off"
          value={last4}
          onChange={setLast4}
          error={errors.idDocumentLast4}
        />
      </div>
      <TextField
        name={`otp-${packageId}`}
        label={h.otp}
        hint={h.otpHint}
        optional={!settings.requireOtp}
        inputMode="numeric"
        maxLength={6}
        autoComplete="off"
        value={otp}
        onChange={setOtp}
        error={errors.otp}
      />
      {settings.requirePhoto || photos.length > 0 ? (
        <SelectField
          name={`photo-${packageId}`}
          label={h.photo}
          hint={photos.length === 0 ? h.photoNone : undefined}
          optional={!settings.requirePhoto}
          value={photoId}
          onChange={setPhotoId}
          error={errors.proofFileId}
          options={[{ value: '', label: '—' }, ...photos.map((p) => ({ value: p.id, label: p.name }))]}
        />
      ) : null}

      {blocked && canOverride ? (
        <>
          <CheckField name={`override-${packageId}`} checked={override} onChange={setOverride}>
            {h.override}
          </CheckField>
          {override ? <TextField name={`override-reason-${packageId}`} label={h.overrideReason} value={reason} onChange={setReason} error={errors['overrideBalance.reason']} /> : null}
        </>
      ) : null}

      <div className="form-actions">
        <Button type="submit" disabled={busy || (blocked && !override)}>
          {busy ? m.common.saving : submitLabel}
        </Button>
      </div>
    </form>
  );
}
