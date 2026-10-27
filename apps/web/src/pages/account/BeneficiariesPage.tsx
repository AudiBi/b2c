import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ID_DOCUMENT_TYPES, createBeneficiarySchema, updateBeneficiarySchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useZodForm } from '../../forms/useZodForm';
import { useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { keys, useBeneficiaries, type Beneficiary } from './queries';

function BeneficiaryForm({ initial, onDone }: { initial?: Beneficiary; onDone(): void }) {
  const { m } = useI18n();
  const b = m.account.beneficiaries;
  const f = m.auth.fields;
  const queryClient = useQueryClient();
  const editing = !!initial;
  const form = useZodForm(editing ? updateBeneficiarySchema : createBeneficiarySchema, {
    fullName: initial?.fullName ?? '',
    idDocumentType: initial?.idDocumentType ?? '',
    idDocumentLast4: initial?.idDocumentLast4 ?? '',
    phone: initial?.phone ?? '',
    validFrom: initial?.validFrom ?? '',
    validTo: initial?.validTo ?? '',
  });
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
      if (initial) await api(`/v1/me/beneficiaries/${initial.id}`, { method: 'PATCH', body: data });
      else await api('/v1/me/beneficiaries', { method: 'POST', body: data });
      await queryClient.invalidateQueries({ queryKey: keys.beneficiaries });
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
    <form className="form card" onSubmit={submit} noValidate aria-label={editing ? b.edit : b.add}>
      <h2 style={{ fontSize: '1.2rem' }}>{editing ? b.edit : b.add}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <TextField name="fullName" label={b.fullName} value={v('fullName')} onChange={(x) => form.set('fullName', x)} error={form.errors.fullName} autoComplete="off" />
      <div className="form-grid form-grid-2">
        <SelectField
          name="idDocumentType"
          label={b.idDocumentType}
          optional
          value={v('idDocumentType')}
          onChange={(x) => form.set('idDocumentType', x)}
          error={form.errors.idDocumentType}
          options={[{ value: '', label: '—' }, ...ID_DOCUMENT_TYPES.map((type) => ({ value: type, label: b.idTypes[type] }))]}
        />
        <TextField name="idDocumentLast4" label={b.idLast4} optional value={v('idDocumentLast4')} onChange={(x) => form.set('idDocumentLast4', x)} error={form.errors.idDocumentLast4} maxLength={4} autoComplete="off" />
      </div>
      <TextField name="phone" type="tel" label={f.phone} optional hint={f.phoneHint} value={v('phone')} onChange={(x) => form.set('phone', x)} error={form.errors.phone} inputMode="tel" autoComplete="off" />
      <div className="form-grid form-grid-2">
        <TextField name="validFrom" type="date" label={b.validFrom} optional value={v('validFrom')} onChange={(x) => form.set('validFrom', x)} error={form.errors.validFrom} />
        <TextField name="validTo" type="date" label={b.validTo} optional value={v('validTo')} onChange={(x) => form.set('validTo', x)} error={form.errors.validTo} />
      </div>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? m.common.saving : m.common.save}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

export function BeneficiariesPage() {
  const { m } = useI18n();
  const b = m.account.beneficiaries;
  const queryClient = useQueryClient();
  const list = useBeneficiaries();
  const [mode, setMode] = useState<{ type: 'idle' } | { type: 'add' } | { type: 'edit'; item: Beneficiary }>({ type: 'idle' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/v1/me/beneficiaries/${id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: keys.beneficiaries });
      setNotice(b.revoked);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setConfirming(null);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{b.title}</h1>
      <p className="lead">{b.lead}</p>
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}

      {mode.type === 'add' ? <BeneficiaryForm onDone={() => setMode({ type: 'idle' })} /> : null}
      {mode.type === 'edit' ? <BeneficiaryForm initial={mode.item} onDone={() => setMode({ type: 'idle' })} /> : null}
      {mode.type === 'idle' ? (
        <p>
          <Button onClick={() => { setNotice(null); setMode({ type: 'add' }); }}>{b.add}</Button>
        </p>
      ) : null}

      {list.isPending ? <p role="status">{m.common.loading}</p> : null}
      {list.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {list.data && list.data.items.length === 0 ? <Alert tone="info">{b.empty}</Alert> : null}
      <ul className="list-plain">
        {list.data?.items.map((item) => (
          <li key={item.id} className="card">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.1rem' }}>{item.fullName}</h2>
                <dl className="kv">
                  {item.idDocumentType ? (
                    <>
                      <dt>{b.idDocumentType}</dt>
                      <dd>
                        {b.idTypes[item.idDocumentType as keyof typeof b.idTypes] ?? item.idDocumentType}
                        {item.idDocumentLast4 ? ` …${item.idDocumentLast4}` : ''}
                      </dd>
                    </>
                  ) : null}
                  {item.phone ? (
                    <>
                      <dt>{m.auth.fields.phone}</dt>
                      <dd>{item.phone}</dd>
                    </>
                  ) : null}
                  <dt>{b.validity}</dt>
                  <dd>
                    {item.validFrom ?? '…'} → {item.validTo ?? b.noLimit}
                  </dd>
                </dl>
              </div>
              <div className="form-actions">
                <Button variant="outline" size="sm" onClick={() => { setNotice(null); setMode({ type: 'edit', item }); }} aria-label={`${m.common.edit} : ${item.fullName}`}>
                  {m.common.edit}
                </Button>
                {confirming === item.id ? (
                  <Button variant="danger" size="sm" onClick={() => revoke(item.id)}>
                    {m.common.confirmDelete}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(item.id)} aria-label={`${b.revoke} : ${item.fullName}`}>
                    {b.revoke}
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
