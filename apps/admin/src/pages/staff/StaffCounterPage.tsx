import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { RadioGroupField, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { staffKeys, useAgencies, useCan, useWarehouses, type StaffPackage, type TransportMode } from './queries';

interface CounterCustomer {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  hasAccess: boolean;
}

const customerName = (c: CounterCustomer) => c.businessName || `${c.firstName} ${c.lastName}`;

/**
 * Comptoir : on choisit (ou on crée) le client, puis on enregistre le colis avec son destinataire.
 * Un client peut être créé sans e-mail : il n'a alors pas d'accès au site et peut être invité plus tard.
 */
export function StaffCounterPage() {
  const { m, lang } = useI18n();
  const c = m.staff.counter;
  const s = m.staff;
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const agencies = useAgencies();
  const canCreateCustomer = useCan('customer:create');
  const canInvite = useCan('customer:update');

  const [customer, setCustomer] = useState<CounterCustomer | null>(null);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', businessName: '', phone: '', email: '' });
  const [inviteEmail, setInviteEmail] = useState('');
  const [pkg, setPkg] = useState({ warehouseId: '', mode: 'AIR' as TransportMode, recipientName: '', recipientPhone: '', recipientCity: '', agencyId: '', description: '', legacy: '' });
  const [done, setDone] = useState<StaffPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const found = useQuery({
    queryKey: ['staff', 'customers', search],
    queryFn: () => api<{ items: CounterCustomer[] }>(`/v1/admin/customers?q=${encodeURIComponent(search)}&limit=8`),
    enabled: search.length > 0,
  });

  const warehouseList = warehouses.data?.items ?? [];
  const warehouseId = pkg.warehouseId || warehouseList[0]?.id || '';

  const createCustomer = useMutation({
    mutationFn: () =>
      api<CounterCustomer>('/v1/admin/customers', {
        method: 'POST',
        body: {
          firstName: form.firstName,
          lastName: form.lastName,
          ...(form.businessName ? { customerType: 'BUSINESS', businessName: form.businessName } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.email ? { email: form.email, locale: lang } : {}),
        },
      }),
    onSuccess: (created) => {
      setCustomer(created);
      setCreating(false);
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  const invite = useMutation({
    mutationFn: () => api<CounterCustomer>(`/v1/admin/customers/${customer!.id}/invite`, { method: 'POST', body: { email: inviteEmail, locale: lang } }),
    onSuccess: (updated) => {
      setCustomer(updated);
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  const createPackage = useMutation({
    mutationFn: () =>
      api<StaffPackage>('/v1/admin/packages/counter', {
        method: 'POST',
        body: {
          warehouseId,
          customerId: customer!.id,
          transportMode: pkg.mode,
          recipientName: pkg.recipientName,
          ...(pkg.recipientPhone ? { recipientPhone: pkg.recipientPhone } : {}),
          ...(pkg.recipientCity ? { recipientCity: pkg.recipientCity } : {}),
          ...(pkg.agencyId ? { destinationAgencyId: pkg.agencyId } : {}),
          ...(pkg.description ? { contentDescription: pkg.description } : {}),
          ...(pkg.legacy ? { legacyTrackingNumber: pkg.legacy } : {}),
        },
      }),
    onSuccess: (created) => {
      setDone(created);
      setError(null);
      setPkg((p) => ({ ...p, recipientName: '', recipientPhone: '', recipientCity: '', description: '', legacy: '' }));
      void queryClient.invalidateQueries({ queryKey: staffKeys.packages });
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(q.trim());
  }
  function submitPackage(event: FormEvent) {
    event.preventDefault();
    setDone(null);
    createPackage.mutate();
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{c.title}</h1>
      <p className="lead">{c.lead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <h2 style={{ fontSize: '1.2rem' }}>{c.step1}</h2>
      {customer ? (
        <div className="card">
          <div className="row-card">
            <div>
              <strong>{customerName(customer)}</strong> <span className="mono">{customer.customerCode}</span>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {customer.phone ?? '—'} · {customer.hasAccess ? customer.email : c.noAccess}
              </p>
            </div>
            <Button variant="outline" onClick={() => { setCustomer(null); setDone(null); }}>
              {c.change}
            </Button>
          </div>
          {!customer.hasAccess && canInvite ? (
            <div className="form" style={{ marginTop: 12 }}>
              <TextField name="inviteEmail" label={c.inviteEmail} type="email" value={inviteEmail} onChange={setInviteEmail} hint={c.inviteHint} />
              <div className="form-actions">
                <Button onClick={() => invite.mutate()} disabled={!inviteEmail || invite.isPending}>
                  {c.invite}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <form className="form card" onSubmit={submitSearch} role="search">
            <TextField name="customerSearch" label={c.search} value={q} onChange={setQ} spellCheck={false} />
            <div className="form-actions">
              <Button type="submit">{c.searchButton}</Button>
              {canCreateCustomer ? (
                <Button type="button" variant="outline" onClick={() => setCreating((v) => !v)}>
                  {c.newCustomer}
                </Button>
              ) : null}
            </div>
          </form>
          {found.data && found.data.items.length === 0 ? <Alert tone="info">{c.noCustomer}</Alert> : null}
          <ul className="list-plain">
            {(found.data?.items ?? []).map((item) => (
              <li key={item.id} className="card" data-testid="counter-customer">
                <div className="row-card">
                  <div>
                    <strong>{customerName(item)}</strong> <span className="mono">{item.customerCode}</span>{' '}
                    {item.hasAccess ? null : <span className="badge badge-warning">{c.noAccess}</span>}
                  </div>
                  <Button variant="outline" onClick={() => setCustomer(item)}>
                    {c.choose}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {creating ? (
            <form
              className="form card"
              onSubmit={(e) => {
                e.preventDefault();
                createCustomer.mutate();
              }}
            >
              <div className="form-grid form-grid-2">
                <TextField name="firstName" label={c.firstName} value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} />
                <TextField name="lastName" label={c.lastName} value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} />
                <TextField name="businessName" label={c.businessName} optional value={form.businessName} onChange={(v) => setForm({ ...form, businessName: v })} />
                <TextField name="phone" label={c.phone} optional value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} hint={c.phoneHint} />
                <TextField name="email" label={c.email} optional type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} hint={c.emailHint} />
              </div>
              <div className="form-actions">
                <Button type="submit" disabled={createCustomer.isPending}>
                  {c.createCustomer}
                </Button>
              </div>
            </form>
          ) : null}
        </>
      )}

      {customer ? (
        <>
          <h2 style={{ fontSize: '1.2rem' }}>{c.step2}</h2>
          {warehouseList.length === 0 && warehouses.data ? <Alert tone="info">{s.common.noWarehouse}</Alert> : null}
          <form className="form card" onSubmit={submitPackage}>
            {warehouseList.length > 1 ? (
              <SelectField name="warehouse" label={s.common.warehouse} value={warehouseId} onChange={(v) => setPkg({ ...pkg, warehouseId: v })} options={warehouseList.map((w) => ({ value: w.id, label: `${w.name} (${w.city})` }))} />
            ) : null}
            <RadioGroupField
              legend={c.mode}
              name="counterMode"
              value={pkg.mode}
              onChange={(v) => setPkg({ ...pkg, mode: v as TransportMode })}
              options={[
                { value: 'AIR', label: s.common.modes.AIR },
                { value: 'SEA', label: s.common.modes.SEA },
              ]}
            />
            <div className="form-grid form-grid-2">
              <TextField name="recipientName" label={c.recipientName} value={pkg.recipientName} onChange={(v) => setPkg({ ...pkg, recipientName: v })} />
              <TextField name="recipientPhone" label={c.recipientPhone} optional value={pkg.recipientPhone} onChange={(v) => setPkg({ ...pkg, recipientPhone: v })} />
              <TextField name="recipientCity" label={c.recipientCity} optional value={pkg.recipientCity} onChange={(v) => setPkg({ ...pkg, recipientCity: v })} />
              <SelectField
                name="agency"
                label={c.agency}
                optional
                value={pkg.agencyId}
                onChange={(v) => setPkg({ ...pkg, agencyId: v })}
                options={[{ value: '', label: s.common.none }, ...(agencies.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.city})` }))]}
              />
              <TextField name="legacy" label={c.legacy} optional value={pkg.legacy} onChange={(v) => setPkg({ ...pkg, legacy: v })} hint={c.legacyHint} />
            </div>
            <TextAreaField name="description" label={c.description} optional value={pkg.description} onChange={(v) => setPkg({ ...pkg, description: v })} />
            <div className="form-actions">
              <Button type="submit" disabled={!warehouseId || !pkg.recipientName || createPackage.isPending}>
                {c.createPackage}
              </Button>
            </div>
          </form>
          {done ? (
            <Alert tone="success">
              {format(c.created, { tracking: done.trackingNumberDisplay })}{' '}
              <Link to={localizedPath(lang, `/packages/${done.id}`)}>{s.common.open}</Link>
            </Alert>
          ) : null}
        </>
      ) : null}
    </>
  );
}
