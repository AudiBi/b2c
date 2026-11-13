import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, SelectField, TextField } from '../../components/ui/Fields';
import { itemLabel, useCustomsItems, type CustomsItem } from './CustomsLinesCard';
import { useCan } from './queries';

const priceText = (i: CustomsItem) =>
  i.kind === 'FIXED' ? `${i.normalPrice} $ / VIP ${i.vipPrice} $` : i.kind === 'PERCENT_OF_VALUE' ? `${i.rate} %` : i.kind === 'PER_WATT' ? `${i.rate} $ / W` : '—';

/** Table des frais CONATEL (reversés) : consultation pour tous ceux qui voient les tarifs, modification pour ceux qui les gèrent. */
export function StaffCustomsPage() {
  const { m } = useI18n();
  const c = m.staff.customs;
  const queryClient = useQueryClient();
  const canManage = useCan('rate:manage');
  const items = useCustomsItems(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', size: '', kind: 'FIXED', normal: '', vip: '', rate: '', auth: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customs-items'] });
  const fail = (e: unknown) => {
    setMessage(null);
    setError(apiErrorMessage(e, m));
  };

  const defaults = useMutation({
    mutationFn: () => api<{ added: number }>('/v1/admin/customs-items/defaults', { method: 'POST' }),
    onSuccess: (r) => {
      setError(null);
      setMessage(format(c.defaultsLoaded, { n: String(r.added) }));
      void refresh();
    },
    onError: fail,
  });
  const create = useMutation({
    mutationFn: () =>
      api('/v1/admin/customs-items', {
        method: 'POST',
        body: {
          name: form.name,
          size: form.size,
          kind: form.kind,
          requiresAuthorization: form.auth,
          ...(form.kind === 'FIXED' ? { normalPrice: Number(form.normal), vipPrice: Number(form.vip || form.normal) } : {}),
          ...(form.kind === 'PERCENT_OF_VALUE' || form.kind === 'PER_WATT' ? { rate: Number(form.rate) } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setForm({ name: '', size: '', kind: 'FIXED', normal: '', vip: '', rate: '', auth: false });
      void refresh();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (i: CustomsItem) => api(`/v1/admin/customs-items/${i.id}`, { method: 'PATCH', body: { active: !i.active } }),
    onSuccess: () => void refresh(),
    onError: fail,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  const list = items.data?.items ?? [];

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{c.pageTitle}</h1>
      <p className="lead">{c.pageLead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      {items.isPending ? <p role="status">{m.common.loading}</p> : null}
      {items.data && list.length === 0 ? <Alert tone="info">{c.empty}</Alert> : null}
      {canManage && list.length === 0 ? (
        <Button onClick={() => defaults.mutate()} disabled={defaults.isPending}>
          {c.loadDefaults}
        </Button>
      ) : null}

      <ul className="list-plain">
        {list.map((i) => (
          <li key={i.id} className="card row-card" data-testid="customs-item">
            <div>
              <strong>{itemLabel(i)}</strong> {i.requiresAuthorization ? <span className="badge badge-warning">{c.authorization}</span> : null}
              {i.active ? null : <span className="badge">{c.inactive}</span>}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {i.kind === 'TO_CONFIRM' ? c.toConfirm : priceText(i)}
              </p>
            </div>
            {canManage ? (
              <Button variant="outline" onClick={() => toggle.mutate(i)}>
                {i.active ? c.deactivate : c.activate}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form className="form card" onSubmit={submit}>
          <h2 style={{ fontSize: '1.1rem' }}>{c.newItem}</h2>
          <div className="form-grid form-grid-2">
            <TextField name="itemName" label={c.name} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <TextField name="itemSize" label={c.size} optional value={form.size} onChange={(v) => setForm({ ...form, size: v })} />
            <SelectField
              name="itemKind"
              label={c.kind}
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: v })}
              options={[
                { value: 'FIXED', label: c.kinds.FIXED },
                { value: 'PERCENT_OF_VALUE', label: c.kinds.PERCENT_OF_VALUE },
                { value: 'PER_WATT', label: c.kinds.PER_WATT },
                { value: 'TO_CONFIRM', label: c.kinds.TO_CONFIRM },
              ]}
            />
            {form.kind === 'FIXED' ? (
              <>
                <TextField name="itemNormal" label={c.normalPrice} type="number" value={form.normal} onChange={(v) => setForm({ ...form, normal: v })} />
                <TextField name="itemVip" label={c.vipPrice} optional type="number" value={form.vip} onChange={(v) => setForm({ ...form, vip: v })} />
              </>
            ) : null}
            {form.kind === 'PERCENT_OF_VALUE' || form.kind === 'PER_WATT' ? (
              <TextField name="itemRate" label={form.kind === 'PER_WATT' ? c.ratePerWatt : c.ratePercent} type="number" value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} />
            ) : null}
          </div>
          <CheckField name="itemAuth" checked={form.auth} onChange={(v) => setForm({ ...form, auth: v })}>
            {c.authorization}
          </CheckField>
          <div className="form-actions">
            <Button type="submit" disabled={!form.name || create.isPending}>
              {c.create}
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
