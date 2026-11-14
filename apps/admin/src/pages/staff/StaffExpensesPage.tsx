import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXPENSE_CATEGORIES, createExpenseSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

interface Expense {
  id: string;
  spentOn: string;
  category: string;
  agency: string | null;
  description: string;
  amount: string;
  currency: string;
}

/** Dépenses de l'entreprise (loyer, électricité, transport…) : elles alimentent le profit mensuel. */
export function StaffExpensesPage() {
  const { m, lang } = useI18n();
  const e = m.staff.expenses;
  const queryClient = useQueryClient();
  const canManage = useCan('expense:manage');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), category: 'RENT', description: '', amount: '', currency: 'USD', agency: '' });
  const key = ['expenses', month] as const;
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: Expense[] }>(`/v1/admin/expenses?month=${month}`) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['expenses'] }), queryClient.invalidateQueries({ queryKey: ['profit'] })]);

  const create = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/expenses', { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      setForm((f) => ({ ...f, description: '', amount: '' }));
      void refresh();
    },
    onError: (x) => setError(apiErrorMessage(x, m)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => void refresh(),
    onError: (x) => setError(apiErrorMessage(x, m)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createExpenseSchema.safeParse({
      spentOn: form.date,
      category: form.category,
      description: form.description,
      amount: Number(form.amount.replace(',', '.')),
      currency: form.currency,
      ...(form.agency.trim() ? { agency: form.agency.trim() } : {}),
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

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{e.title}</h1>
      <p className="lead">{e.lead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="card form">
        <TextField name="expenseMonth" label={e.month} type="month" value={month} onChange={setMonth} />
      </div>
      {list.isPending ? <p role="status">{m.common.loading}</p> : null}
      {list.data && items.length === 0 ? <Alert tone="info">{e.empty}</Alert> : null}
      <ul className="list-plain">
        {items.map((x) => (
          <li key={x.id} className="card row-card" data-testid="expense">
            <div>
              <strong>{formatMoney(x.amount, x.currency, lang)}</strong> · {e.categories[x.category as keyof typeof e.categories] ?? x.category}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {x.spentOn} · {x.description}
                {x.agency ? ` · ${x.agency}` : ''}
              </p>
            </div>
            {canManage ? (
              <Button variant="outline" onClick={() => remove.mutate(x.id)}>
                {e.remove}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form className="form card" onSubmit={submit}>
          <h2 style={{ fontSize: '1.1rem' }}>{e.add}</h2>
          <div className="form-grid form-grid-2">
            <TextField name="expenseDate" label={e.date} type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} error={errors.spentOn} />
            <SelectField name="expenseCategory" label={e.category} value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: e.categories[c] }))} />
            <TextField name="expenseDescription" label={e.description} value={form.description} onChange={(v) => setForm({ ...form, description: v })} error={errors.description} />
            <TextField name="expenseAmount" label={e.amount} type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} error={errors.amount} />
            <SelectField name="expenseCurrency" label={e.currency} value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} options={[{ value: 'USD', label: 'USD' }, { value: 'HTG', label: 'HTG' }]} />
            <TextField name="expenseAgency" label={e.agency} optional value={form.agency} onChange={(v) => setForm({ ...form, agency: v })} />
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending}>
              {e.save}
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
