import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PETTY_CASH_CATEGORIES, createPettyCashSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

interface Entry {
  id: string;
  number: string;
  entryDate: string;
  kind: 'EXPENSE' | 'FUNDING';
  category: string | null;
  description: string;
  counterparty: string | null;
  amount: string;
  currency: string;
}
interface Balance {
  currency: string;
  balance: string;
  threshold: number | null;
  low: boolean;
}

/** Petite caisse : approvisionnements et dépenses par devise, solde courant, alerte de solde bas. Les écritures ne se modifient pas. */
export function StaffPettyCashPage() {
  const { m, lang } = useI18n();
  const c = m.staff.pettyCash;
  const queryClient = useQueryClient();
  const canManage = useCan('petty_cash:manage');
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), kind: 'EXPENSE', category: 'TRANSPORT', description: '', counterparty: '', receipt: '', amount: '', currency: 'USD' });
  const list = useQuery({ queryKey: ['petty-cash'] as const, queryFn: () => api<{ items: Entry[]; balances: Balance[] }>('/v1/admin/petty-cash') });
  const create = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/petty-cash', { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      setForm((f) => ({ ...f, description: '', counterparty: '', receipt: '', amount: '' }));
      void queryClient.invalidateQueries({ queryKey: ['petty-cash'] });
    },
    onError: (x) => setError(apiErrorMessage(x, m)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createPettyCashSchema.safeParse({
      entryDate: form.date,
      kind: form.kind,
      ...(form.kind === 'EXPENSE' ? { category: form.category } : {}),
      description: form.description,
      ...(form.counterparty.trim() ? { counterparty: form.counterparty.trim() } : {}),
      ...(form.receipt.trim() ? { receiptRef: form.receipt.trim() } : {}),
      amount: Number(form.amount.replace(',', '.')),
      currency: form.currency,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      setError(m.common.fixErrors);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{c.title}</h1>
      <p className="lead">{c.lead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {list.isPending ? <p role="status">{m.common.loading}</p> : null}
      {(list.data?.balances ?? []).map((b) => (
        <Alert key={b.currency} tone={b.low ? 'warning' : 'info'}>
          <span data-testid={`petty-balance-${b.currency}`}>
            {c.balance} {b.currency} : <strong>{formatMoney(b.balance, b.currency, lang)}</strong>
          </span>
          {b.low ? ` — ${c.low}` : ''}
        </Alert>
      ))}
      <ul className="list-plain">
        {(list.data?.items ?? []).map((x) => (
          <li key={x.id} className="card row-card" data-testid="petty-entry">
            <div>
              <strong>
                {x.kind === 'EXPENSE' ? '−' : '+'}
                {formatMoney(x.amount, x.currency, lang)}
              </strong>{' '}
              · {x.kind === 'FUNDING' ? c.funding : (c.categories[x.category as keyof typeof c.categories] ?? x.category)}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                <span className="mono">{x.number}</span> · {x.entryDate} · {x.description}
                {x.counterparty ? ` · ${x.counterparty}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {canManage ? (
        <form className="form card" onSubmit={submit}>
          <h2 style={{ fontSize: '1.1rem' }}>{c.add}</h2>
          <div className="form-grid form-grid-2">
            <SelectField name="pcKind" label={c.kind} value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={[{ value: 'EXPENSE', label: c.expense }, { value: 'FUNDING', label: c.funding }]} />
            {form.kind === 'EXPENSE' ? (
              <SelectField name="pcCategory" label={c.category} value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={PETTY_CASH_CATEGORIES.map((x) => ({ value: x, label: c.categories[x] }))} />
            ) : null}
            <TextField name="pcDate" label={c.date} type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} error={errors.entryDate} />
            <TextField name="pcDescription" label={c.description} value={form.description} onChange={(v) => setForm({ ...form, description: v })} error={errors.description} />
            <TextField name="pcCounterparty" label={c.counterparty} optional value={form.counterparty} onChange={(v) => setForm({ ...form, counterparty: v })} />
            <TextField name="pcReceipt" label={c.receipt} optional value={form.receipt} onChange={(v) => setForm({ ...form, receipt: v })} />
            <TextField name="pcAmount" label={c.amount} type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} error={errors.amount} />
            <SelectField name="pcCurrency" label={c.currency} value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} options={[{ value: 'USD', label: 'USD' }, { value: 'HTG', label: 'HTG' }]} />
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending}>
              {c.save}
            </Button>
          </div>
          <p className="muted">{c.immutable}</p>
        </form>
      ) : null}
    </>
  );
}
