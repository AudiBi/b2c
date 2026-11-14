import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

interface Compensation {
  indemnity: string;
  reimbursement: string;
  net: string;
  currency: string;
  paidOn: string | null;
  note: string | null;
}

/** Incident : indemnité payée au client et remboursement obtenu du transporteur. Jamais visible du client ; le net alimente le profit du mois de paiement. */
export function CompensationCard({ claimId }: { claimId: string }) {
  const { m, lang } = useI18n();
  const c = m.staff.compensation;
  const allowed = useCan('claim:compensate');
  const queryClient = useQueryClient();
  const key = ['claim-compensation', claimId] as const;
  const current = useQuery({ queryKey: key, enabled: allowed, queryFn: () => api<Compensation | null>(`/v1/admin/claims/${claimId}/compensation`) });
  const [form, setForm] = useState({ indemnity: '', reimbursement: '', currency: 'USD', paidOn: '', note: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = current.data;
    if (d) setForm({ indemnity: d.indemnity, reimbursement: d.reimbursement, currency: d.currency, paidOn: d.paidOn ?? '', note: d.note ?? '' });
  }, [current.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/claims/${claimId}/compensation`, {
        method: 'PUT',
        body: {
          indemnity: Number(form.indemnity.replace(',', '.')) || 0,
          reimbursement: Number(form.reimbursement.replace(',', '.')) || 0,
          currency: form.currency,
          ...(form.paidOn ? { paidOn: form.paidOn } : {}),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setNotice(c.saved);
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['profit'] });
    },
    onError: (e) => {
      setNotice(null);
      setError(apiErrorMessage(e, m));
    },
  });

  if (!allowed) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="card form" aria-label={c.title}>
      <h2 style={{ fontSize: '1.1rem' }}>{c.title}</h2>
      <p className="muted">{c.lead}</p>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {current.data ? (
        <p data-testid="compensation-net">
          {c.net} : <strong>{formatMoney(current.data.net, current.data.currency, lang)}</strong>
        </p>
      ) : null}
      <form onSubmit={submit} className="form">
        <div className="form-grid form-grid-2">
          <TextField name="compIndemnity" label={c.indemnity} type="number" optional value={form.indemnity} onChange={(v) => setForm({ ...form, indemnity: v })} />
          <TextField name="compReimbursement" label={c.reimbursement} type="number" optional value={form.reimbursement} onChange={(v) => setForm({ ...form, reimbursement: v })} />
          <SelectField name="compCurrency" label={c.currency} value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} options={[{ value: 'USD', label: 'USD' }, { value: 'HTG', label: 'HTG' }]} />
          <TextField name="compPaidOn" label={c.paidOn} type="date" optional value={form.paidOn} onChange={(v) => setForm({ ...form, paidOn: v })} hint={c.paidOnHint} />
          <TextField name="compNote" label={c.note} optional value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
        </div>
        <div className="form-actions">
          <Button type="submit" disabled={save.isPending}>
            {c.save}
          </Button>
        </div>
      </form>
    </section>
  );
}
