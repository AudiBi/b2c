import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { MANUAL_LINE_KINDS, createInvoiceSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatDateTime, formatMoney, parseDecimal } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { InvoiceBadge } from '../finance/FinanceParts';
import { financeKeys, useStaffInvoices } from '../finance/queries';
import { useCan, type StaffPackage } from './queries';

interface CustomerHit {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
}

interface ExtraLine {
  kind: (typeof MANUAL_LINE_KINDS)[number];
  description: string;
  amount: string;
  packageId: string;
}

const customerName = (c: CustomerHit) => c.businessName || `${c.firstName} ${c.lastName}`.trim();

function NewInvoiceForm({ onDone }: { onDone(): void }) {
  const { m, lang } = useI18n();
  const f = m.finance.staff.billing.form;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canDiscount = useCan('discount:apply');
  const canOverride = useCan('price:override');
  const [adjust, setAdjust] = useState<Record<string, { unit: string; price: string; reason: string }>>({});
  const setAdj = (id: string, patch: Partial<{ unit: string; price: string; reason: string }>) => setAdjust((a) => ({ ...a, [id]: { ...(a[id] ?? { unit: '', price: '', reason: '' }), ...patch } }));

  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Colis du client prêts à être facturés : pesés, ou en attente de paiement après une facture annulée
  const billable = useQuery({
    queryKey: ['staff', 'billable-packages', customerId] as const,
    enabled: !!customerId,
    queryFn: async () => {
      const [weighed, awaiting] = await Promise.all(
        ['REGISTERED_WEIGHED', 'AWAITING_PAYMENT'].map((status) => api<{ items: StaffPackage[] }>(`/v1/admin/packages?limit=100&customerId=${customerId}&status=${status}`)),
      );
      return [...weighed.items, ...awaiting.items];
    },
  });

  async function find() {
    setError(null);
    if (search.trim() === '') return;
    try {
      const res = await api<{ items: CustomerHit[] }>(`/v1/admin/customers?limit=10&q=${encodeURIComponent(search.trim())}`);
      setHits(res.items);
      setCustomerId(res.items.length === 1 ? res.items[0].id : '');
      setSelected(new Set());
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const setExtra = (index: number, patch: Partial<ExtraLine>) => setExtras((list) => list.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!customerId) {
      await find(); // Entrée dans le champ de recherche : on cherche d'abord le client
      return;
    }
    const manual: FieldErrors = {};
    const extraLines = extras.map((line, i) => {
      const amount = parseDecimal(line.amount);
      if (amount === null) manual[`extraLines.${i}.amount`] = m.validation.number;
      return { kind: line.kind, description: line.description.trim(), amount: amount ?? undefined, packageId: line.packageId || undefined };
    });
    const percent = discount.trim() === '' ? undefined : parseDecimal(discount);
    if (discount.trim() !== '' && percent === null) manual.discountPercent = m.validation.number;
    // Ajustements par colis : rabais par unité (baril) et prix convenu avec motif
    const unitDiscounts: { packageId: string; perUnit: number }[] = [];
    const priceOverrides: { packageId: string; amount: number; reason: string }[] = [];
    for (const id of selected) {
      const a = adjust[id];
      if (!a) continue;
      if (canDiscount && a.unit.trim() !== '') {
        const perUnit = parseDecimal(a.unit);
        if (perUnit === null) manual[`adjust.${id}.unit`] = m.validation.number;
        else unitDiscounts.push({ packageId: id, perUnit });
      }
      if (canOverride && a.price.trim() !== '') {
        const amount = parseDecimal(a.price);
        if (amount === null) manual[`adjust.${id}.price`] = m.validation.number;
        else if (a.reason.trim() === '') manual[`adjust.${id}.reason`] = m.validation.required;
        else priceOverrides.push({ packageId: id, amount, reason: a.reason.trim() });
      }
    }
    const parsed = createInvoiceSchema.safeParse({
      customerId,
      packageIds: [...selected],
      unitDiscounts,
      priceOverrides,
      extraLines,
      discountPercent: percent ?? undefined,
      dueDate: dueDate.trim() === '' ? undefined : dueDate.trim(),
      notes: notes.trim() === '' ? undefined : notes.trim(),
    });
    const issues = parsed.success ? {} : issuesToErrors(parsed.error, m);
    const all = { ...issues, ...manual };
    if (!parsed.success || Object.keys(all).length > 0) {
      setErrors(all);
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/v1/admin/invoices', { method: 'POST', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: financeKeys.invoices });
      navigate(localizedPath(lang, `/billing/${created.id}`));
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={f.title}>
      <h2 style={{ fontSize: '1.2rem' }}>{f.title}</h2>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}

      <div className="form-actions" style={{ alignItems: 'flex-end' }}>
        <TextField name="customerSearch" label={f.customer} value={search} onChange={setSearch} />
        <Button variant="outline" onClick={() => void find()}>
          {f.find}
        </Button>
      </div>
      {hits && hits.length === 0 ? <Alert tone="info">{f.none}</Alert> : null}
      {hits && hits.length > 0 ? (
        <SelectField
          name="customerId"
          label={f.choose}
          value={customerId}
          onChange={(value) => {
            setCustomerId(value);
            setSelected(new Set());
          }}
          options={[{ value: '', label: '—' }, ...hits.map((h) => ({ value: h.id, label: `${h.customerCode} · ${customerName(h)}` }))]}
        />
      ) : null}

      {customerId ? (
        <fieldset>
          <legend>{f.packages}</legend>
          {billable.isPending ? <p role="status">{m.common.loading}</p> : null}
          {billable.data && billable.data.length === 0 ? <p className="muted">{f.noPackages}</p> : null}
          {errors.packageIds ? <p role="alert">{errors.packageIds}</p> : null}
          {billable.data?.map((p) => (
            <CheckField key={p.id} name={`pkg-${p.id}`} checked={selected.has(p.id)} onChange={(on) => toggle(p.id, on)}>
              <span className="mono">{p.trackingNumberDisplay}</span> · {p.contentDescription ?? ''}{' '}
              {p.measures.billableWeight ? `· ${p.measures.billableWeight} ${p.measures.weightUnit === 'LB' ? 'lb' : 'kg'}` : ''}
            </CheckField>
          ))}
        </fieldset>
      ) : null}

      {customerId && selected.size > 0 && (canDiscount || canOverride) ? (
        <fieldset>
          <legend>{f.adjustTitle}</legend>
          {[...selected].map((id) => {
            const p = billable.data?.find((x) => x.id === id);
            const a = adjust[id] ?? { unit: '', price: '', reason: '' };
            return (
              <div key={id} className="form-grid form-grid-2" data-testid="adjust-row">
                <p className="mono">{p?.trackingNumberDisplay ?? id}</p>
                {canDiscount ? <TextField name={`unit-${id}`} label={f.unitDiscount} hint={f.unitDiscountHint} inputMode="decimal" optional value={a.unit} onChange={(v) => setAdj(id, { unit: v })} error={errors[`adjust.${id}.unit`]} /> : null}
                {canOverride ? (
                  <>
                    <TextField name={`price-${id}`} label={f.agreedPrice} hint={f.agreedPriceHint} inputMode="decimal" optional value={a.price} onChange={(v) => setAdj(id, { price: v })} error={errors[`adjust.${id}.price`]} />
                    <TextField name={`reason-${id}`} label={f.agreedReason} optional value={a.reason} onChange={(v) => setAdj(id, { reason: v })} error={errors[`adjust.${id}.reason`]} />
                  </>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      {customerId ? (
        <fieldset>
          <legend>{f.extras}</legend>
          {extras.map((line, i) => (
            <div key={i} className="form-grid form-grid-2" data-testid="extra-line">
              <SelectField name={`kind-${i}`} label={f.kind} value={line.kind} onChange={(v) => setExtra(i, { kind: v as ExtraLine['kind'] })} options={MANUAL_LINE_KINDS.map((k) => ({ value: k, label: m.finance.lineKinds[k] }))} />
              <TextField name={`desc-${i}`} label={f.description} value={line.description} onChange={(v) => setExtra(i, { description: v })} error={errors[`extraLines.${i}.description`]} />
              <TextField name={`amount-${i}`} label={f.amount} inputMode="decimal" value={line.amount} onChange={(v) => setExtra(i, { amount: v })} error={errors[`extraLines.${i}.amount`]} />
              <SelectField
                name={`forpkg-${i}`}
                label={f.forPackage}
                optional
                value={line.packageId}
                onChange={(v) => setExtra(i, { packageId: v })}
                options={[{ value: '', label: '—' }, ...[...selected].map((id) => ({ value: id, label: billable.data?.find((p) => p.id === id)?.trackingNumberDisplay ?? id }))]}
              />
              <div>
                <Button variant="ghost" size="sm" onClick={() => setExtras((list) => list.filter((_, idx) => idx !== i))}>
                  {f.removeLine}
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setExtras((list) => [...list, { kind: 'FREIGHT', description: '', amount: '', packageId: '' }])}>
            {f.addLine}
          </Button>
        </fieldset>
      ) : null}

      {customerId ? (
        <>
          <div className="form-grid form-grid-2">
            {canDiscount ? <TextField name="discount" label={f.discount} hint={f.discountHint} inputMode="decimal" optional value={discount} onChange={setDiscount} error={errors.discountPercent} /> : null}
            <TextField name="dueDate" label={f.dueDate} optional value={dueDate} onChange={setDueDate} error={errors.dueDate} />
          </div>
          <TextAreaField name="notes" label={f.notes} optional value={notes} onChange={setNotes} error={errors.notes} />
        </>
      ) : null}
      <div className="form-actions">
        <Button type="submit" disabled={busy || !customerId}>
          {busy ? m.common.saving : f.submit}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {m.common.cancel}
        </Button>
      </div>
    </form>
  );
}

export function StaffInvoicesPage() {
  const { m, lang } = useI18n();
  const b = m.finance.staff.billing;
  const canCreate = useCan('invoice:create');
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const invoices = useStaffInvoices({ status, q: applied });
  const items = invoices.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{b.title}</h1>
      <p className="lead">{b.lead}</p>
      {canCreate && !adding ? (
        <p>
          <Button onClick={() => setAdding(true)}>{b.new}</Button>
        </p>
      ) : null}
      {adding ? <NewInvoiceForm onDone={() => setAdding(false)} /> : null}

      <form
        className="form-actions"
        style={{ alignItems: 'flex-end' }}
        role="search"
        aria-label={b.search}
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(q.trim());
        }}
      >
        <TextField name="invoiceSearch" label={b.search} value={q} onChange={setQ} />
        <SelectField
          name="invoiceStatus"
          label={b.status}
          value={status}
          onChange={setStatus}
          options={[{ value: '', label: m.finance.common.all }, ...(Object.keys(m.finance.invoiceStatuses) as (keyof typeof m.finance.invoiceStatuses)[]).map((s) => ({ value: s, label: m.finance.invoiceStatuses[s] }))]}
        />
        <Button type="submit" variant="outline">
          {b.filter}
        </Button>
      </form>

      {invoices.isPending ? <p role="status">{m.common.loading}</p> : null}
      {invoices.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {invoices.data && items.length === 0 ? <Alert tone="info">{b.empty}</Alert> : null}
      <ul className="list-plain" aria-label={b.title}>
        {items.map((inv) => (
          <li key={inv.id} className="card" data-testid="staff-invoice-item">
            <div className="row-card">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  <span className="mono">{inv.number ?? m.finance.common.draftNumber}</span> <InvoiceBadge status={inv.status} />
                </h2>
                <p style={{ margin: 0 }}>
                  {inv.customer.customerCode} · {inv.customer.name} · <strong>{formatMoney(inv.total, inv.currency, lang)}</strong>
                  {inv.status !== 'DRAFT' && inv.status !== 'VOID' ? ` · ${m.finance.totals.balance} : ${formatMoney(inv.balance, inv.currency, lang)}` : ''}
                </p>
                <p className="muted" style={{ margin: '4px 0 0' }}>{formatDateTime(inv.createdAt, lang)}</p>
              </div>
              <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/billing/${inv.id}`)} aria-label={`${m.finance.common.open} : ${inv.number ?? m.finance.common.draftNumber} ${inv.customer.customerCode}`}>
                {m.finance.common.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {invoices.hasNextPage ? (
        <Button variant="outline" onClick={() => invoices.fetchNextPage()} disabled={invoices.isFetchingNextPage}>
          {m.finance.common.loadMore}
        </Button>
      ) : null}
    </>
  );
}
