import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDownload } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { saveBlob } from '../../lib/download';
import { formatMoney } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

interface Deposit {
  id: string;
  number: string;
  depositDate: string;
  bank: string;
  accountLast4: string | null;
  slipRef: string;
  currency: string;
  expected: string;
  deposited: string;
  difference: string;
}
interface ToDeposit {
  sessions: { id: string; currency: string; closedAt: string; depositable: string }[];
  totals: { currency: string; toDeposit: string }[];
}

/** Dépôts bancaires des caisses clôturées : reste à déposer, écart déposé − attendu, bordereau imprimable. */
export function StaffDepositsPage() {
  const { m, lang } = useI18n();
  const d = m.staff.deposits;
  const queryClient = useQueryClient();
  const canManage = useCan('deposit:manage');
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), bank: '', last4: '', slip: '', amount: '', note: '' });
  const pending = useQuery({ queryKey: ['deposits', 'to-deposit'] as const, queryFn: () => api<ToDeposit>('/v1/admin/deposits/to-deposit') });
  const done = useQuery({ queryKey: ['deposits', 'list'] as const, queryFn: () => api<{ items: Deposit[] }>('/v1/admin/deposits') });

  const create = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/deposits', { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      setChosen(new Set());
      setForm((f) => ({ ...f, slip: '', amount: '', note: '' }));
      void queryClient.invalidateQueries({ queryKey: ['deposits'] });
    },
    onError: (x) => setError(apiErrorMessage(x, m)),
  });

  const sessions = pending.data?.sessions ?? [];
  const selected = sessions.filter((s) => chosen.has(s.id));
  const expected = selected.reduce((acc, s) => acc + Number(s.depositable), 0);
  const currencies = new Set(selected.map((s) => s.currency));

  function toggle(id: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected.length === 0) return setError(d.chooseSessions);
    if (currencies.size > 1) return setError(d.oneCurrency);
    create.mutate({
      sessionIds: selected.map((s) => s.id),
      depositDate: form.date,
      bank: form.bank.trim(),
      ...(form.last4.trim() ? { accountLast4: form.last4.trim() } : {}),
      slipRef: form.slip.trim(),
      depositedAmount: Number(form.amount.replace(',', '.')),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    });
  }
  async function slip(deposit: Deposit) {
    try {
      saveBlob(await apiDownload(`/v1/admin/deposits/${deposit.id}/slip.pdf`), `${deposit.number}.pdf`);
    } catch (x) {
      setError(apiErrorMessage(x, m));
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{d.title}</h1>
      <p className="lead">{d.lead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {(pending.data?.totals ?? []).map((t) => (
        <Alert key={t.currency} tone="info">
          {d.toDeposit} {t.currency} : <strong data-testid={`to-deposit-${t.currency}`}>{formatMoney(t.toDeposit, t.currency, lang)}</strong>
        </Alert>
      ))}
      {pending.data && sessions.length === 0 ? <p className="muted">{d.nothing}</p> : null}

      {canManage && sessions.length > 0 ? (
        <form className="form card" onSubmit={submit}>
          <fieldset>
            <legend>{d.sessions}</legend>
            {sessions.map((s) => (
              <CheckField key={s.id} name={`session-${s.id}`} checked={chosen.has(s.id)} onChange={(on) => toggle(s.id, on)}>
                {String(s.closedAt).slice(0, 10)} · {formatMoney(s.depositable, s.currency, lang)}
              </CheckField>
            ))}
          </fieldset>
          <p>{format(d.expected, { amount: expected.toFixed(2) })}</p>
          <div className="form-grid form-grid-2">
            <TextField name="depDate" label={d.date} type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            <TextField name="depBank" label={d.bank} value={form.bank} onChange={(v) => setForm({ ...form, bank: v })} />
            <TextField name="depLast4" label={d.last4} hint={d.last4Hint} optional maxLength={4} value={form.last4} onChange={(v) => setForm({ ...form, last4: v })} />
            <TextField name="depSlip" label={d.slip} value={form.slip} onChange={(v) => setForm({ ...form, slip: v })} />
            <TextField name="depAmount" label={d.amount} type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
            <TextField name="depNote" label={d.note} optional value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending}>
              {d.save}
            </Button>
          </div>
        </form>
      ) : null}

      <h2 style={{ fontSize: '1.2rem' }}>{d.history}</h2>
      <ul className="list-plain">
        {(done.data?.items ?? []).map((x) => (
          <li key={x.id} className="card row-card" data-testid="deposit">
            <div>
              <strong className="mono">{x.number}</strong> · {x.depositDate} · {x.bank}
              {x.accountLast4 ? ` …${x.accountLast4}` : ''}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {d.expectedShort} {formatMoney(x.expected, x.currency, lang)} · {d.depositedShort} {formatMoney(x.deposited, x.currency, lang)} ·{' '}
                <span className={Number(x.difference) === 0 ? '' : 'badge badge-warning'}>
                  {d.difference} {formatMoney(x.difference, x.currency, lang)}
                </span>
              </p>
            </div>
            <Button variant="outline" onClick={() => slip(x)}>
              {d.slipPdf}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
