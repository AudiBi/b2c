import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createReferrerSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

interface Referrer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  rate: string;
  active: boolean;
  customers: number;
}
interface Statement {
  currency: string;
  month: string;
  customers: number;
  newCustomers: number;
  packages: number;
  revenue: string;
  cost: string;
  profit: string;
  commission: string;
  payout: { amount: string; paidOn: string; note: string | null } | null;
}

/** Référents : pourcentage du profit des clients amenés, relevé du mois, paiement de la commission (une fois par mois). */
export function StaffReferrersPage() {
  const { m, lang } = useI18n();
  const r = m.staff.referrers;
  const queryClient = useQueryClient();
  const canManage = useCan('referrer:manage');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', rate: '10' });
  const list = useQuery({ queryKey: ['referrers'] as const, queryFn: () => api<{ items: Referrer[] }>('/v1/admin/referrers') });
  const statement = useQuery({
    queryKey: ['referrer-statement', selected, month] as const,
    enabled: !!selected,
    queryFn: () => api<Statement>(`/v1/admin/referrers/${selected}/statement?month=${month}`),
  });
  const fail = (e: unknown) => setError(apiErrorMessage(e, m));
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['referrers'] }), queryClient.invalidateQueries({ queryKey: ['referrer-statement'] }), queryClient.invalidateQueries({ queryKey: ['profit'] })]);

  const create = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/referrers', { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      setForm({ name: '', phone: '', email: '', rate: '10' });
      void refresh();
    },
    onError: fail,
  });
  const pay = useMutation({
    mutationFn: () => api(`/v1/admin/referrers/${selected}/payouts`, { method: 'POST', body: { month, paidOn: new Date().toISOString().slice(0, 10) } }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: fail,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createReferrerSchema.safeParse({
      name: form.name.trim(),
      rate: Number(form.rate.replace(',', '.')),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      setError(m.common.fixErrors);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  }

  const items = list.data?.items ?? [];
  const s = statement.data;
  const money = (v: string) => formatMoney(v, s?.currency ?? 'USD', lang);

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{r.title}</h1>
      <p className="lead">{r.lead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {list.data && items.length === 0 ? <Alert tone="info">{r.empty}</Alert> : null}
      <ul className="list-plain">
        {items.map((x) => (
          <li key={x.id} className="card row-card" data-testid="referrer">
            <div>
              <strong>{x.name}</strong> · {x.rate} % {x.active ? '' : <span className="badge">{r.inactive}</span>}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {format(r.customersCount, { n: String(x.customers) })}
                {x.phone ? ` · ${x.phone}` : ''}
              </p>
            </div>
            <Button variant="outline" onClick={() => setSelected(x.id)}>
              {r.statement}
            </Button>
          </li>
        ))}
      </ul>

      {selected ? (
        <section className="card form" aria-label={r.statement}>
          <TextField name="refMonth" label={r.month} type="month" value={month} onChange={setMonth} />
          {s ? (
            <>
              <dl className="kv" data-testid="statement">
                <dt>{r.customers}</dt>
                <dd>{s.customers} ({format(r.newInMonth, { n: String(s.newCustomers) })})</dd>
                <dt>{r.packages}</dt>
                <dd>{s.packages}</dd>
                <dt>{r.revenue}</dt>
                <dd>{money(s.revenue)}</dd>
                <dt>{r.cost}</dt>
                <dd>{money(s.cost)}</dd>
                <dt>{r.profit}</dt>
                <dd>{money(s.profit)}</dd>
                <dt>{r.commission}</dt>
                <dd>
                  <strong data-testid="commission">{money(s.commission)}</strong>
                </dd>
              </dl>
              {s.payout ? (
                <Alert tone="success">{format(r.paid, { amount: money(s.payout.amount), date: s.payout.paidOn })}</Alert>
              ) : canManage && Number(s.commission) > 0 ? (
                <div className="form-actions">
                  <Button onClick={() => pay.mutate()} disabled={pay.isPending}>
                    {r.pay}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {canManage ? (
        <form className="form card" onSubmit={submit}>
          <h2 style={{ fontSize: '1.1rem' }}>{r.add}</h2>
          <div className="form-grid form-grid-2">
            <TextField name="refName" label={r.name} value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={errors.name} />
            <TextField name="refRate" label={r.rate} type="number" value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} error={errors.rate} hint={r.rateHint} />
            <TextField name="refPhone" label={r.phone} optional value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} error={errors.phone} />
            <TextField name="refEmail" label={r.email} optional type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} error={errors.email} />
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending}>
              {r.save}
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
