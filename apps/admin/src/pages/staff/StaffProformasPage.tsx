import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDownload } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { saveBlob } from '../../lib/download';
import { formatMoney } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { RadioGroupField, SelectField, TextField } from '../../components/ui/Fields';
import { useCan, useWarehouses } from './queries';

interface Proforma {
  id: string;
  number: string;
  customerId: string;
  currency: string;
  total: string;
  validUntil: string;
  expired: boolean;
  convertedPackageId: string | null;
  card: { name: string };
}
interface CustomerHit {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
}

const nameOf = (c: CustomerHit) => c.businessName || `${c.firstName} ${c.lastName}`;

/** Proforma : estimation chiffrée figée pour un client, valable N jours, imprimable, transformable en colis de comptoir. */
export function StaffProformasPage() {
  const { m, lang } = useI18n();
  const p = m.staff.proformas;
  const queryClient = useQueryClient();
  const canConvert = useCan('package:receive');
  const warehouses = useWarehouses();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [form, setForm] = useState({ mode: 'AIR', origin: 'US', destination: 'HT', weight: '', unit: 'LB', length: '', width: '', height: '', quantity: '1', category: '', days: '30' });
  const [converting, setConverting] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const list = useQuery({ queryKey: ['proformas'] as const, queryFn: () => api<{ items: Proforma[] }>('/v1/admin/proformas') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['proformas'] });
  const fail = (e: unknown) => setError(apiErrorMessage(e, m));

  const create = useMutation({
    mutationFn: () => {
      const dims = form.length && form.width && form.height ? { dimensions: { length: Number(form.length), width: Number(form.width), height: Number(form.height), unit: form.unit === 'LB' ? 'IN' : 'CM' } } : {};
      return api('/v1/admin/proformas', {
        method: 'POST',
        body: {
          customerId: customer!.id,
          validDays: Number(form.days) || 30,
          quote: {
            transportMode: form.mode,
            originCountry: form.origin.toUpperCase(),
            destinationCountry: form.destination.toUpperCase(),
            weight: { value: Number(form.weight.replace(',', '.')), unit: form.unit },
            ...dims,
            ...(form.category.trim() ? { categoryCode: form.category.trim().toUpperCase() } : {}),
            quantity: Number(form.quantity) || 1,
          },
        },
      });
    },
    onSuccess: () => {
      setError(null);
      setForm((f) => ({ ...f, weight: '', length: '', width: '', height: '' }));
      void refresh();
    },
    onError: fail,
  });
  const convert = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/proformas/${id}/convert`, { method: 'POST', body: { warehouseId: warehouses.data?.items[0]?.id, recipientName: recipient.trim() } }),
    onSuccess: () => {
      setError(null);
      setConverting(null);
      setRecipient('');
      void refresh();
    },
    onError: fail,
  });

  async function find() {
    setError(null);
    try {
      const res = await api<{ items: CustomerHit[] }>(`/v1/admin/customers?limit=8&q=${encodeURIComponent(search.trim())}`);
      setHits(res.items);
    } catch (e) {
      fail(e);
    }
  }
  async function pdf(x: Proforma) {
    try {
      saveBlob(await apiDownload(`/v1/admin/proformas/${x.id}/pdf`), `${x.number}.pdf`);
    } catch (e) {
      fail(e);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!customer) return setError(p.chooseCustomer);
    create.mutate();
  }

  const items = list.data?.items ?? [];

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{p.title}</h1>
      <p className="lead">{p.lead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <form className="form card" onSubmit={submit}>
        <h2 style={{ fontSize: '1.1rem' }}>{p.add}</h2>
        {customer ? (
          <p>
            <strong>{nameOf(customer)}</strong> <span className="mono">{customer.customerCode}</span>{' '}
            <Button variant="outline" onClick={() => setCustomer(null)}>
              {p.change}
            </Button>
          </p>
        ) : (
          <>
            <TextField name="pfSearch" label={p.customerSearch} value={search} onChange={setSearch} />
            <div className="form-actions">
              <Button variant="outline" onClick={() => void find()}>
                {p.searchButton}
              </Button>
            </div>
            {hits.map((h) => (
              <p key={h.id}>
                {nameOf(h)} <span className="mono">{h.customerCode}</span>{' '}
                <Button variant="outline" onClick={() => setCustomer(h)}>
                  {p.choose}
                </Button>
              </p>
            ))}
          </>
        )}
        <RadioGroupField legend={p.mode} name="pfMode" value={form.mode} onChange={(v) => setForm({ ...form, mode: v })} options={[{ value: 'AIR', label: m.staff.common.modes.AIR }, { value: 'SEA', label: m.staff.common.modes.SEA }]} />
        <div className="form-grid form-grid-2">
          <TextField name="pfOrigin" label={p.origin} value={form.origin} onChange={(v) => setForm({ ...form, origin: v })} />
          <TextField name="pfDestination" label={p.destination} value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} />
          <TextField name="pfWeight" label={p.weight} type="number" value={form.weight} onChange={(v) => setForm({ ...form, weight: v })} />
          <SelectField name="pfUnit" label={p.unit} value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} options={[{ value: 'LB', label: 'lb · po' }, { value: 'KG', label: 'kg · cm' }]} />
          <TextField name="pfLength" label={p.length} optional type="number" value={form.length} onChange={(v) => setForm({ ...form, length: v })} />
          <TextField name="pfWidth" label={p.width} optional type="number" value={form.width} onChange={(v) => setForm({ ...form, width: v })} />
          <TextField name="pfHeight" label={p.height} optional type="number" value={form.height} onChange={(v) => setForm({ ...form, height: v })} />
          <TextField name="pfQuantity" label={p.quantity} type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
          <TextField name="pfCategory" label={p.category} optional value={form.category} onChange={(v) => setForm({ ...form, category: v })} hint={p.categoryHint} />
          <TextField name="pfDays" label={p.days} type="number" value={form.days} onChange={(v) => setForm({ ...form, days: v })} />
        </div>
        <div className="form-actions">
          <Button type="submit" disabled={create.isPending}>
            {p.create}
          </Button>
        </div>
      </form>

      {list.data && items.length === 0 ? <Alert tone="info">{p.empty}</Alert> : null}
      <ul className="list-plain">
        {items.map((x) => (
          <li key={x.id} className="card" data-testid="proforma">
            <div className="row-card">
              <div>
                <strong className="mono">{x.number}</strong> · <strong>{formatMoney(x.total, x.currency, lang)}</strong>{' '}
                {x.convertedPackageId ? <span className="badge badge-success">{p.converted}</span> : x.expired ? <span className="badge badge-warning">{p.expired}</span> : null}
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {format(p.validUntil, { date: x.validUntil })} · {x.card.name}
                </p>
              </div>
              <div className="form-actions">
                <Button variant="outline" onClick={() => void pdf(x)}>
                  {p.pdf}
                </Button>
                {canConvert && !x.convertedPackageId && !x.expired ? (
                  <Button variant="outline" onClick={() => setConverting(converting === x.id ? null : x.id)}>
                    {p.convert}
                  </Button>
                ) : null}
              </div>
            </div>
            {converting === x.id ? (
              <div className="form">
                <TextField name={`pfRecipient-${x.id}`} label={p.recipient} value={recipient} onChange={setRecipient} />
                <div className="form-actions">
                  <Button onClick={() => convert.mutate(x.id)} disabled={!recipient.trim() || convert.isPending}>
                    {p.convertSubmit}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
