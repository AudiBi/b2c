import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createCompanySchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useZodForm } from '../../forms/useZodForm';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { Icon } from '../../components/ui/Icon';
import { PageHead } from '../../components/ui/PageHead';
import { adminKeys, useCompanies } from './queries';

const EMPTY = { name: '', slug: '', trackingPrefix: '', customerCodePrefix: '', defaultCurrency: 'USD', defaultLocale: 'fr', paymentPolicy: 'PAY_BEFORE_SHIPMENT', adminEmail: '', adminFirstName: '', adminLastName: '' };

function CreateDialog({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const { m } = useI18n();
  const c = m.admin.companies;
  const f = c.fields;
  const form = useZodForm(createCompanySchema, EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = (name: keyof typeof EMPTY, label: string, extra: { hint?: string; type?: string; inputMode?: 'email' } = {}) => (
    <TextField name={name} label={label} value={String(form.values[name])} onChange={(v) => form.set(name, v)} error={form.errors[name]} autoComplete="off" {...extra} />
  );

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
      await api('/v1/platform/companies', { method: 'POST', body: data });
      onCreated();
    } catch (e) {
      if (!form.applyServerError(e)) setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={c.create} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted" style={{ margin: 0 }}>{c.createLead}</p>
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
        <div className="form-grid form-grid-2">
          {text('name', f.name)}
          {text('slug', f.slug, { hint: f.slugHint })}
          {text('trackingPrefix', f.trackingPrefix, { hint: f.trackingHint })}
          {text('customerCodePrefix', f.customerCodePrefix, { hint: f.customerHint })}
          <SelectField name="defaultCurrency" label={f.currency} value={String(form.values.defaultCurrency)} onChange={(v) => form.set('defaultCurrency', v)} options={[{ value: 'USD', label: 'USD' }, { value: 'HTG', label: 'HTG' }]} />
          <SelectField name="defaultLocale" label={f.locale} value={String(form.values.defaultLocale)} onChange={(v) => form.set('defaultLocale', v)} options={(['fr', 'ht', 'en'] as const).map((l) => ({ value: l, label: m.lang[l] }))} />
        </div>
        <SelectField name="paymentPolicy" label={f.paymentPolicy} value={String(form.values.paymentPolicy)} onChange={(v) => form.set('paymentPolicy', v)} options={[{ value: 'PAY_BEFORE_SHIPMENT', label: f.policies.PAY_BEFORE_SHIPMENT }, { value: 'PAY_BEFORE_RELEASE', label: f.policies.PAY_BEFORE_RELEASE }]} />
        <div className="form-grid form-grid-2">
          {text('adminFirstName', f.adminFirstName)}
          {text('adminLastName', f.adminLastName)}
        </div>
        {text('adminEmail', f.adminEmail, { type: 'email', inputMode: 'email' })}
        <div className="form-actions">
          <Button type="submit" disabled={busy}>{busy ? m.common.saving : c.create}</Button>
          <Button variant="outline" onClick={onClose}>{c.cancel}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Gestion des entreprises par l'équipe de la plateforme : création, suspension, réactivation. Aucune donnée métier. */
export function CompaniesPage() {
  const { m, lang } = useI18n();
  const c = m.admin.companies;
  const queryClient = useQueryClient();
  const companies = useCompanies();
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = companies.data?.items ?? [];

  async function setStatus(id: string, action: 'suspend' | 'activate') {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/platform/companies/${id}/${action}`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: adminKeys.companies });
      setNotice(action === 'suspend' ? c.suspended : c.activated);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={c.title} lead={c.lead} actions={<Button onClick={() => setCreating(true)}><Icon name="plus" width={16} height={16} /> {c.create}</Button>} />
      {notice ? <Alert tone="success" live>{notice}</Alert> : null}
      {error ? <Alert tone="danger" live>{error}</Alert> : null}
      {companies.isLoading ? <p role="status">{m.common.loading}</p> : null}
      {companies.isError ? <Alert tone="danger" live>{m.common.errorLoad}</Alert> : null}
      {!companies.isLoading && !companies.isError && items.length === 0 ? <div className="empty"><Icon name="building" /><p>{c.empty}</p></div> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{c.fields.name}</th>
                <th scope="col">{c.slugColumn}</th>
                <th scope="col">{c.fields.trackingPrefix}</th>
                <th scope="col">{m.admin.users.filterStatus}</th>
                <th scope="col">{c.createdAt}</th>
                <th scope="col"><span className="sr-only">{m.admin.users.filterStatus}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong><div className="muted" style={{ fontSize: '0.85rem' }}>{item.defaultCurrency} · {m.lang[item.defaultLocale as 'fr' | 'ht' | 'en'] ?? item.defaultLocale}</div></td>
                  <td className="mono">{item.slug}</td>
                  <td className="mono">{item.trackingPrefix ?? '—'}</td>
                  <td><span className={`badge ${item.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{c.status[item.status]}</span></td>
                  <td className="muted">{formatDateTime(item.createdAt, lang)}</td>
                  <td className="num">
                    {asking === item.id ? (
                      <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => { setAsking(null); void setStatus(item.id, 'suspend'); }}>{c.confirm}</Button>
                        <Button size="sm" variant="outline" onClick={() => setAsking(null)}>{c.cancel}</Button>
                      </div>
                    ) : item.status === 'ACTIVE' ? (
                      <Button size="sm" variant="outline" onClick={() => setAsking(item.id)}>{c.suspend}</Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(item.id, 'activate')}>{c.activate}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {asking ? <Alert tone="warning">{c.suspendAsk}</Alert> : null}
      {creating ? (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setNotice(c.created);
            void queryClient.invalidateQueries({ queryKey: adminKeys.companies });
          }}
        />
      ) : null}
    </>
  );
}
