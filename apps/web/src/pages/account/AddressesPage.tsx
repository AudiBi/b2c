import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createAddressSchema, updateAddressSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useZodForm } from '../../forms/useZodForm';
import { useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, RadioGroupField, TextAreaField, TextField } from '../../components/ui/Fields';
import { countryName } from '../LocationsPage';
import { keys, useAddresses, type Address } from './queries';

const empty = { kind: 'DELIVERY', label: '', recipientName: '', phone: '', line1: '', line2: '', city: '', region: '', country: 'HT', postalCode: '', instructions: '', isDefault: false };

function AddressForm({ initial, onDone }: { initial?: Address; onDone(): void }) {
  const { m } = useI18n();
  const a = m.account.addresses;
  const f = m.auth.fields;
  const queryClient = useQueryClient();
  const editing = !!initial;
  const form = useZodForm(editing ? updateAddressSchema : createAddressSchema, initial
    ? { kind: initial.kind, label: initial.label, recipientName: initial.recipientName, phone: initial.phone ?? '', line1: initial.line1, line2: initial.line2 ?? '', city: initial.city, region: initial.region ?? '', country: initial.country, postalCode: initial.postalCode ?? '', instructions: initial.instructions ?? '', isDefault: initial.isDefault }
    : empty);
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
      if (initial) await api(`/v1/me/addresses/${initial.id}`, { method: 'PATCH', body: data });
      else await api('/v1/me/addresses', { method: 'POST', body: data });
      await queryClient.invalidateQueries({ queryKey: keys.addresses });
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
    <form className="form card" onSubmit={submit} noValidate aria-label={editing ? a.edit : a.add}>
      <h2 style={{ fontSize: '1.2rem' }}>{editing ? a.edit : a.add}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <RadioGroupField legend={a.kind} name="kind" value={v('kind')} onChange={(x) => form.set('kind', x)} options={[{ value: 'DELIVERY', label: a.kinds.DELIVERY }, { value: 'PERSONAL', label: a.kinds.PERSONAL }]} />
      <div className="form-grid form-grid-2">
        <TextField name="label" label={a.label} hint={a.labelHint} value={v('label')} onChange={(x) => form.set('label', x)} error={form.errors.label} />
        <TextField name="recipientName" label={a.recipientName} value={v('recipientName')} onChange={(x) => form.set('recipientName', x)} error={form.errors.recipientName} autoComplete="name" />
      </div>
      <TextField name="line1" label={a.line1} value={v('line1')} onChange={(x) => form.set('line1', x)} error={form.errors.line1} autoComplete="address-line1" />
      <TextField name="line2" label={a.line2} optional value={v('line2')} onChange={(x) => form.set('line2', x)} error={form.errors.line2} autoComplete="address-line2" />
      <div className="form-grid form-grid-2">
        <TextField name="city" label={a.city} value={v('city')} onChange={(x) => form.set('city', x)} error={form.errors.city} autoComplete="address-level2" />
        <TextField name="region" label={a.region} optional value={v('region')} onChange={(x) => form.set('region', x)} error={form.errors.region} autoComplete="address-level1" />
      </div>
      <div className="form-grid form-grid-2">
        <TextField name="country" label={a.country} hint={a.countryHint} value={v('country')} onChange={(x) => form.set('country', x)} error={form.errors.country} maxLength={2} autoComplete="country" />
        <TextField name="postalCode" label={a.postalCode} optional value={v('postalCode')} onChange={(x) => form.set('postalCode', x)} error={form.errors.postalCode} autoComplete="postal-code" />
      </div>
      <TextField name="phone" type="tel" label={f.phone} optional hint={f.phoneHint} value={v('phone')} onChange={(x) => form.set('phone', x)} error={form.errors.phone} autoComplete="tel" inputMode="tel" />
      <TextAreaField name="instructions" label={a.instructions} optional value={v('instructions')} onChange={(x) => form.set('instructions', x)} error={form.errors.instructions} />
      <CheckField name="isDefault" checked={Boolean(form.values.isDefault)} onChange={(x) => form.set('isDefault', x)}>
        {a.isDefault}
      </CheckField>
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

export function AddressesPage() {
  const { m, lang } = useI18n();
  const a = m.account.addresses;
  const queryClient = useQueryClient();
  const addresses = useAddresses();
  const [mode, setMode] = useState<{ type: 'idle' } | { type: 'add' } | { type: 'edit'; address: Address }>({ type: 'idle' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/v1/me/addresses/${id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: keys.addresses });
      setNotice(a.deleted);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setConfirming(null);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{a.title}</h1>
      <p className="lead">{a.lead}</p>
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}

      {mode.type === 'add' ? <AddressForm onDone={() => setMode({ type: 'idle' })} /> : null}
      {mode.type === 'edit' ? <AddressForm initial={mode.address} onDone={() => setMode({ type: 'idle' })} /> : null}
      {mode.type === 'idle' ? (
        <p>
          <Button onClick={() => { setNotice(null); setMode({ type: 'add' }); }}>{a.add}</Button>
        </p>
      ) : null}

      {addresses.isPending ? <p role="status">{m.common.loading}</p> : null}
      {addresses.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {addresses.data && addresses.data.items.length === 0 ? <Alert tone="info">{a.empty}</Alert> : null}
      <ul className="list-plain">
        {addresses.data?.items.map((address) => (
          <li key={address.id} className="card">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.1rem' }}>
                  {address.label} <span className="badge">{a.kinds[address.kind]}</span>{' '}
                  {address.isDefault ? <span className="badge badge-success">{a.defaultBadge}</span> : null}
                </h2>
                <p style={{ margin: 0 }}>
                  {address.recipientName}
                  <br />
                  {address.line1}
                  {address.line2 ? <><br />{address.line2}</> : null}
                  <br />
                  {address.city}
                  {address.region ? `, ${address.region}` : ''} {address.postalCode ?? ''}
                  <br />
                  {countryName(address.country, lang)}
                </p>
                {address.instructions ? <p className="muted">{address.instructions}</p> : null}
              </div>
              <div className="form-actions">
                <Button variant="outline" size="sm" onClick={() => { setNotice(null); setMode({ type: 'edit', address }); }} aria-label={`${m.common.edit} : ${address.label}`}>
                  {m.common.edit}
                </Button>
                {confirming === address.id ? (
                  <Button variant="danger" size="sm" onClick={() => remove(address.id)}>
                    {m.common.confirmDelete}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(address.id)} aria-label={`${m.common.delete} : ${address.label}`}>
                    {m.common.delete}
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
