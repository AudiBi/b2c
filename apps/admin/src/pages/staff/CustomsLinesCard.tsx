import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

export interface CustomsItem {
  id: string;
  name: string;
  size: string;
  kind: 'FIXED' | 'PERCENT_OF_VALUE' | 'PER_WATT' | 'TO_CONFIRM';
  normalPrice: string | null;
  vipPrice: string | null;
  rate: string | null;
  requiresAuthorization: boolean;
  active: boolean;
}
interface Line {
  id: string;
  item: { id: string; name: string; size: string; requiresAuthorization: boolean };
  quantity: number;
  vip: boolean;
  fee: string;
}

export const useCustomsItems = (all = false) =>
  useQuery({ queryKey: ['customs-items', all] as const, queryFn: () => api<{ items: CustomsItem[] }>(`/v1/admin/customs-items${all ? '?all=true' : ''}`) });

export const itemLabel = (i: { name: string; size: string }) => (i.size ? `${i.name} — ${i.size}` : i.name);

/** Frais CONATEL d'un colis : reversés à l'organisme, figés à la saisie, repris sur la facture en lignes distinctes. */
export function CustomsLinesCard({ packageId, invoiced }: { packageId: string; invoiced: boolean }) {
  const { m, lang } = useI18n();
  const c = m.staff.customs;
  const queryClient = useQueryClient();
  const canEdit = useCan('package:update');
  const items = useCustomsItems();
  const key = ['customs-lines', packageId] as const;
  const lines = useQuery({ queryKey: key, queryFn: () => api<{ items: Line[]; total: string; currency: string }>(`/v1/admin/packages/${packageId}/customs-lines`) });
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [vip, setVip] = useState(false);
  const [value, setValue] = useState('');
  const [watts, setWatts] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chosen = items.data?.items.find((i) => i.id === itemId);
  const add = useMutation({
    mutationFn: () =>
      api(`/v1/admin/packages/${packageId}/customs-lines`, {
        method: 'POST',
        body: { itemId, quantity: Number(quantity) || 1, vip, ...(value ? { declaredValue: Number(value) } : {}), ...(watts ? { watts: Number(watts) } : {}) },
      }),
    onSuccess: () => {
      setError(null);
      setItemId('');
      setValue('');
      setWatts('');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });
  const remove = useMutation({
    mutationFn: (lineId: string) => api(`/v1/admin/packages/${packageId}/customs-lines/${lineId}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  const list = lines.data?.items ?? [];
  if (!canEdit && list.length === 0) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  return (
    <section className="card form" aria-label={c.title}>
      <h2 style={{ fontSize: '1.1rem' }}>{c.title}</h2>
      <p className="muted">{c.lead}</p>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {list.length === 0 ? <p className="muted">{c.none}</p> : null}
      <ul className="list-plain">
        {list.map((l) => (
          <li key={l.id} className="row-card" data-testid="customs-line">
            <span>
              {itemLabel(l.item)} × {l.quantity}
              {l.vip ? ' · VIP' : ''} {l.item.requiresAuthorization ? <span className="badge badge-warning">{c.authorization}</span> : null}
            </span>
            <span>
              <strong>{formatMoney(l.fee, 'USD', lang)}</strong>{' '}
              {canEdit && !invoiced ? (
                <Button variant="outline" onClick={() => remove.mutate(l.id)}>
                  {c.remove}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {list.length > 0 ? (
        <p>
          <strong>{c.total}</strong> : {formatMoney(lines.data?.total ?? '0', 'USD', lang)}
        </p>
      ) : null}

      {canEdit && !invoiced ? (
        <form onSubmit={submit} className="form">
          <SelectField
            name="customsItem"
            label={c.item}
            value={itemId}
            onChange={setItemId}
            options={[{ value: '', label: '—' }, ...(items.data?.items ?? []).map((i) => ({ value: i.id, label: itemLabel(i) }))]}
          />
          <div className="form-grid form-grid-2">
            <TextField name="customsQuantity" label={c.quantity} type="number" min={1} value={quantity} onChange={setQuantity} />
            {chosen?.kind === 'PERCENT_OF_VALUE' ? <TextField name="customsValue" label={c.value} type="number" value={value} onChange={setValue} /> : null}
            {chosen?.kind === 'PER_WATT' ? <TextField name="customsWatts" label={c.watts} type="number" value={watts} onChange={setWatts} /> : null}
          </div>
          {chosen?.kind === 'FIXED' ? (
            <CheckField name="customsVip" checked={vip} onChange={setVip}>
              {c.vip}
            </CheckField>
          ) : null}
          <div className="form-actions">
            <Button type="submit" disabled={!itemId || add.isPending}>
              {c.add}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
