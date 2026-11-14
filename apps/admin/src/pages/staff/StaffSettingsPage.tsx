import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { addressTemplateSchema, createAgencySchema, createWarehouseSchema, publicContactSchema, runSetup, setFxRateSchema, type Call } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors, type FieldErrors } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckField, FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

// ---------------------------------------------------------------------------------------------
// Types des réponses de l'API
// ---------------------------------------------------------------------------------------------
interface Contact {
  email?: string;
  phones: string[];
  whatsapp?: string;
  address?: string;
  hours?: string;
}
interface Fx {
  current: { htgPerUsd: number; note: string | null; setAt: string } | null;
  history: { htgPerUsd: number; note: string | null; setAt: string }[];
}
interface Warehouse {
  id: string;
  reference: string;
  name: string;
  country: string;
  city: string;
  addressLine: string;
  publicVisible: boolean;
  addressTemplate: string[];
  status: 'ACTIVE' | 'INACTIVE';
}
interface Agency {
  id: string;
  code: string;
  name: string;
  kind: 'AGENCY' | 'PICKUP_POINT';
  country: string;
  city: string;
  addressLine: string;
  phone: string | null;
  hours: string | null;
  publicVisible: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}
interface Category {
  id: string;
  code: string;
  name: { fr: string; ht: string; en: string };
  restricted: boolean;
  active: boolean;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card form" aria-label={title}>
      <h2 style={{ fontSize: '1.2rem' }}>{title}</h2>
      {hint ? <p className="muted">{hint}</p> : null}
      {children}
    </section>
  );
}

const DEFAULT_TEMPLATE = '{customerName}\n{customerCode} {mode}\n';

// ---------------------------------------------------------------------------------------------
// Coordonnées publiques
// ---------------------------------------------------------------------------------------------
function ContactSection() {
  const { m } = useI18n();
  const s = m.staff.settings;
  const can = useCan('settings:update');
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ['settings', 'contact'] as const, queryFn: () => api<Contact>('/v1/admin/settings/public-contact') });
  const [v, setV] = useState({ email: '', phones: '', whatsapp: '', address: '', hours: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data.data) setV({ email: data.data.email ?? '', phones: data.data.phones.join(', '), whatsapp: data.data.whatsapp ?? '', address: data.data.address ?? '', hours: data.data.hours ?? '' });
  }, [data.data]);

  const save = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/settings/public-contact', { method: 'PUT', body }),
    onSuccess: () => {
      setError(null);
      setNotice(s.saved);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'contact'] });
    },
    onError: (e) => {
      setNotice(null);
      setError(apiErrorMessage(e, m));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = publicContactSchema.safeParse({
      ...(v.email.trim() ? { email: v.email.trim() } : {}),
      phones: v.phones.split(/[,;\n]/).map((x) => x.replace(/[\s().-]/g, '')).filter(Boolean),
      ...(v.whatsapp.trim() ? { whatsapp: v.whatsapp.replace(/[\s().-]/g, '') } : {}),
      ...(v.address.trim() ? { address: v.address.trim() } : {}),
      ...(v.hours.trim() ? { hours: v.hours.trim() } : {}),
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      setError(m.common.fixErrors);
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <Section title={s.contact.title} hint={s.contact.hint}>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      <form className="form" onSubmit={submit}>
        <div className="form-grid form-grid-2">
          <TextField name="contactEmail" label={s.contact.email} optional type="email" value={v.email} onChange={(x) => setV({ ...v, email: x })} error={errors.email} />
          <TextField name="contactPhones" label={s.contact.phones} optional value={v.phones} onChange={(x) => setV({ ...v, phones: x })} hint={s.contact.phonesHint} error={errors.phones} />
          <TextField name="contactWhatsapp" label={s.contact.whatsapp} optional value={v.whatsapp} onChange={(x) => setV({ ...v, whatsapp: x })} error={errors.whatsapp} />
          <TextField name="contactHours" label={s.contact.hours} optional value={v.hours} onChange={(x) => setV({ ...v, hours: x })} error={errors.hours} />
        </div>
        <TextAreaField name="contactAddress" label={s.contact.address} optional value={v.address} onChange={(x) => setV({ ...v, address: x })} />
        {can ? (
          <div className="form-actions">
            <Button type="submit" disabled={save.isPending}>
              {s.save}
            </Button>
          </div>
        ) : null}
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Taux gourdes / dollar
// ---------------------------------------------------------------------------------------------
function FxSection() {
  const { m, lang } = useI18n();
  const s = m.staff.settings;
  const can = useCan('settings:update');
  const queryClient = useQueryClient();
  const fx = useQuery({ queryKey: ['settings', 'fx'] as const, queryFn: () => api<Fx>('/v1/admin/settings/fx-rate') });
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/settings/fx-rate', { method: 'PUT', body }),
    onSuccess: () => {
      setError(null);
      setRate('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['settings', 'fx'] });
      void queryClient.invalidateQueries({ queryKey: ['fx-rate'] });
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = setFxRateSchema.safeParse({ htgPerUsd: Number(rate.replace(',', '.')), ...(note.trim() ? { note: note.trim() } : {}) });
    if (!parsed.success) return setError(m.common.fixErrors);
    save.mutate(parsed.data);
  }

  return (
    <Section title={s.fx.title} hint={s.fx.hint}>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <p data-testid="fx-current">
        {fx.data?.current ? format(s.fx.current, { rate: String(fx.data.current.htgPerUsd), date: formatDateTime(fx.data.current.setAt, lang) }) : s.fx.none}
      </p>
      {can ? (
        <form className="form" onSubmit={submit}>
          <div className="form-grid form-grid-2">
            <TextField name="fxRate" label={s.fx.rate} type="number" value={rate} onChange={setRate} />
            <TextField name="fxNote" label={s.fx.note} optional value={note} onChange={setNote} />
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={save.isPending}>
              {s.fx.save}
            </Button>
          </div>
        </form>
      ) : null}
      {fx.data && fx.data.history.length > 1 ? (
        <details>
          <summary>{s.fx.history}</summary>
          <ul className="list-plain">
            {fx.data.history.map((h) => (
              <li key={h.setAt} className="muted">
                {formatDateTime(h.setAt, lang)} · {h.htgPerUsd}
                {h.note ? ` · ${h.note}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Seuil d'alerte de la petite caisse
// ---------------------------------------------------------------------------------------------
function ThresholdSection() {
  const { m } = useI18n();
  const s = m.staff.settings;
  const can = useCan('petty_cash:manage');
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ['petty-cash'] as const, queryFn: () => api<{ balances: { currency: string; threshold: number | null }[] }>('/v1/admin/petty-cash'), enabled: useCan('petty_cash:read') });
  const [usd, setUsd] = useState('');
  const [htg, setHtg] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const by = new Map((data.data?.balances ?? []).map((b) => [b.currency, b.threshold]));
    setUsd(by.get('USD') != null ? String(by.get('USD')) : '');
    setHtg(by.get('HTG') != null ? String(by.get('HTG')) : '');
  }, [data.data]);

  const save = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/petty-cash/thresholds', { method: 'PUT', body }),
    onSuccess: () => {
      setError(null);
      setNotice(s.saved);
      void queryClient.invalidateQueries({ queryKey: ['petty-cash'] });
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  if (!can) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    const thresholds: Record<string, number> = {};
    if (usd.trim()) thresholds.USD = Number(usd.replace(',', '.'));
    if (htg.trim()) thresholds.HTG = Number(htg.replace(',', '.'));
    save.mutate({ thresholds });
  }

  return (
    <Section title={s.threshold.title} hint={s.threshold.hint}>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      <form className="form" onSubmit={submit}>
        <div className="form-grid form-grid-2">
          <TextField name="thresholdUsd" label={s.threshold.usd} optional type="number" value={usd} onChange={setUsd} />
          <TextField name="thresholdHtg" label={s.threshold.htg} optional type="number" value={htg} onChange={setHtg} />
        </div>
        <div className="form-actions">
          <Button type="submit" disabled={save.isPending}>
            {s.save}
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Entrepôts
// ---------------------------------------------------------------------------------------------
const emptyWarehouse = { reference: '', name: '', country: 'US', city: '', addressLine: '', template: DEFAULT_TEMPLATE, publicVisible: true };

function WarehousesSection() {
  const { m } = useI18n();
  const s = m.staff.settings;
  const can = useCan('warehouse:manage');
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['settings', 'warehouses'] as const, queryFn: () => api<{ items: Warehouse[] }>('/v1/admin/warehouses') });
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [v, setV] = useState(emptyWarehouse);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['settings', 'warehouses'] }), queryClient.invalidateQueries({ queryKey: ['staff', 'warehouses'] })]);
  const save = useMutation({
    mutationFn: (body: unknown) => (editing ? api(`/v1/admin/warehouses/${editing.id}`, { method: 'PATCH', body }) : api('/v1/admin/warehouses', { method: 'POST', body })),
    onSuccess: () => {
      setError(null);
      setEditing(null);
      setV(emptyWarehouse);
      void refresh();
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });
  const toggle = useMutation({
    mutationFn: (w: Warehouse) => api(`/v1/admin/warehouses/${w.id}`, { method: 'PATCH', body: { status: w.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }),
    onSuccess: () => void refresh(),
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  function edit(w: Warehouse) {
    setEditing(w);
    setV({ reference: w.reference, name: w.name, country: w.country, city: w.city, addressLine: w.addressLine, template: w.addressTemplate.join('\n'), publicVisible: w.publicVisible });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const lines = v.template.split('\n').map((l) => l.trim()).filter(Boolean);
    const fields = { name: v.name.trim(), country: v.country.trim().toUpperCase(), city: v.city.trim(), addressLine: v.addressLine.trim(), addressTemplate: lines, publicVisible: v.publicVisible };
    if (editing) {
      const template = addressTemplateSchema.safeParse(lines);
      if (!template.success) {
        setErrors({ addressTemplate: template.error.issues[0]?.message ?? m.common.fixErrors });
        return setError(m.common.fixErrors);
      }
      setErrors({});
      return save.mutate(fields);
    }
    const parsed = createWarehouseSchema.safeParse({ reference: v.reference.trim(), ...fields });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return setError(m.common.fixErrors);
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  const items = list.data?.items ?? [];
  return (
    <Section title={s.warehouses.title} hint={s.warehouses.hint}>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {list.data && items.length === 0 ? <Alert tone="info">{s.warehouses.empty}</Alert> : null}
      <ul className="list-plain">
        {items.map((w) => (
          <li key={w.id} className="card row-card" data-testid="settings-warehouse">
            <div>
              <strong>{w.name}</strong> <span className="mono">{w.reference}</span> {w.status === 'INACTIVE' ? <span className="badge">{s.inactive}</span> : null}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {w.city}, {w.country} · {w.addressLine}
              </p>
            </div>
            {can ? (
              <div className="form-actions">
                <Button variant="outline" onClick={() => edit(w)}>
                  {s.edit}
                </Button>
                <Button variant="outline" onClick={() => toggle.mutate(w)}>
                  {w.status === 'ACTIVE' ? s.deactivate : s.activate}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {can ? (
        <form className="form" onSubmit={submit}>
          <h3 style={{ fontSize: '1rem' }}>{editing ? format(s.warehouses.editing, { name: editing.name }) : s.warehouses.add}</h3>
          <div className="form-grid form-grid-2">
            {editing ? null : <TextField name="whReference" label={s.warehouses.reference} value={v.reference} onChange={(x) => setV({ ...v, reference: x })} error={errors.reference} hint={s.warehouses.referenceHint} />}
            <TextField name="whName" label={s.name} value={v.name} onChange={(x) => setV({ ...v, name: x })} error={errors.name} />
            <TextField name="whCountry" label={s.country} value={v.country} onChange={(x) => setV({ ...v, country: x })} error={errors.country} hint={s.countryHint} />
            <TextField name="whCity" label={s.city} value={v.city} onChange={(x) => setV({ ...v, city: x })} error={errors.city} />
          </div>
          <TextField name="whAddress" label={s.addressLine} value={v.addressLine} onChange={(x) => setV({ ...v, addressLine: x })} error={errors.addressLine} />
          <TextAreaField name="whTemplate" label={s.warehouses.template} value={v.template} onChange={(x) => setV({ ...v, template: x })} />
          <p className="muted">{s.warehouses.templateHint}</p>
          {errors.addressTemplate ? <p role="alert">{errors.addressTemplate}</p> : null}
          <CheckField name="whPublic" checked={v.publicVisible} onChange={(x) => setV({ ...v, publicVisible: x })}>
            {s.publicVisible}
          </CheckField>
          <div className="form-actions">
            <Button type="submit" disabled={save.isPending}>
              {editing ? s.save : s.add}
            </Button>
            {editing ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setV(emptyWarehouse);
                }}
              >
                {s.cancel}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Agences et points de retrait
// ---------------------------------------------------------------------------------------------
const emptyAgency = { code: '', name: '', kind: 'AGENCY', country: 'HT', city: '', addressLine: '', phone: '', hours: '', publicVisible: true };

function AgenciesSection() {
  const { m } = useI18n();
  const s = m.staff.settings;
  const can = useCan('agency:manage');
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['settings', 'agencies'] as const, queryFn: () => api<{ items: Agency[] }>('/v1/admin/agencies') });
  const [editing, setEditing] = useState<Agency | null>(null);
  const [v, setV] = useState(emptyAgency);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['settings', 'agencies'] }), queryClient.invalidateQueries({ queryKey: ['staff', 'agencies'] })]);

  const save = useMutation({
    mutationFn: (body: unknown) => (editing ? api(`/v1/admin/agencies/${editing.id}`, { method: 'PATCH', body }) : api('/v1/admin/agencies', { method: 'POST', body })),
    onSuccess: () => {
      setError(null);
      setEditing(null);
      setV(emptyAgency);
      void refresh();
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });
  const toggle = useMutation({
    mutationFn: (a: Agency) => api(`/v1/admin/agencies/${a.id}`, { method: 'PATCH', body: { status: a.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }),
    onSuccess: () => void refresh(),
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  function edit(a: Agency) {
    setEditing(a);
    setV({ code: a.code, name: a.name, kind: a.kind, country: a.country, city: a.city, addressLine: a.addressLine, phone: a.phone ?? '', hours: a.hours ?? '', publicVisible: a.publicVisible });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const phone = v.phone.replace(/[\s().-]/g, '');
    if (editing) {
      setErrors({});
      return save.mutate({ name: v.name.trim(), kind: v.kind, country: v.country.trim().toUpperCase(), city: v.city.trim(), addressLine: v.addressLine.trim(), phone: phone || null, hours: v.hours.trim() || null, publicVisible: v.publicVisible });
    }
    const parsed = createAgencySchema.safeParse({
      code: v.code.trim(),
      name: v.name.trim(),
      kind: v.kind,
      country: v.country.trim().toUpperCase(),
      city: v.city.trim(),
      addressLine: v.addressLine.trim(),
      ...(phone ? { phone } : {}),
      ...(v.hours.trim() ? { hours: v.hours.trim() } : {}),
      publicVisible: v.publicVisible,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      return setError(m.common.fixErrors);
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  const items = list.data?.items ?? [];
  return (
    <Section title={s.agencies.title} hint={s.agencies.hint}>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {list.data && items.length === 0 ? <Alert tone="info">{s.agencies.empty}</Alert> : null}
      <ul className="list-plain">
        {items.map((a) => (
          <li key={a.id} className="card row-card" data-testid="settings-agency">
            <div>
              <strong>{a.name}</strong> <span className="mono">{a.code}</span> {a.status === 'INACTIVE' ? <span className="badge">{s.inactive}</span> : null}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {a.city}, {a.country} · {a.addressLine}
                {a.phone ? ` · ${a.phone}` : ''}
              </p>
            </div>
            {can ? (
              <div className="form-actions">
                <Button variant="outline" onClick={() => edit(a)}>
                  {s.edit}
                </Button>
                <Button variant="outline" onClick={() => toggle.mutate(a)}>
                  {a.status === 'ACTIVE' ? s.deactivate : s.activate}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {can ? (
        <form className="form" onSubmit={submit}>
          <h3 style={{ fontSize: '1rem' }}>{editing ? format(s.agencies.editing, { name: editing.name }) : s.agencies.add}</h3>
          <div className="form-grid form-grid-2">
            {editing ? null : <TextField name="agCode" label={s.agencies.code} value={v.code} onChange={(x) => setV({ ...v, code: x })} error={errors.code} hint={s.warehouses.referenceHint} />}
            <TextField name="agName" label={s.name} value={v.name} onChange={(x) => setV({ ...v, name: x })} error={errors.name} />
            <SelectField name="agKind" label={s.agencies.kind} value={v.kind} onChange={(x) => setV({ ...v, kind: x })} options={[{ value: 'AGENCY', label: s.agencies.kinds.AGENCY }, { value: 'PICKUP_POINT', label: s.agencies.kinds.PICKUP_POINT }]} />
            <TextField name="agCountry" label={s.country} value={v.country} onChange={(x) => setV({ ...v, country: x })} error={errors.country} hint={s.countryHint} />
            <TextField name="agCity" label={s.city} value={v.city} onChange={(x) => setV({ ...v, city: x })} error={errors.city} />
            <TextField name="agPhone" label={s.agencies.phone} optional value={v.phone} onChange={(x) => setV({ ...v, phone: x })} error={errors.phone} />
            <TextField name="agHours" label={s.agencies.hours} optional value={v.hours} onChange={(x) => setV({ ...v, hours: x })} error={errors.hours} />
          </div>
          <TextField name="agAddress" label={s.addressLine} value={v.addressLine} onChange={(x) => setV({ ...v, addressLine: x })} error={errors.addressLine} />
          <CheckField name="agPublic" checked={v.publicVisible} onChange={(x) => setV({ ...v, publicVisible: x })}>
            {s.publicVisible}
          </CheckField>
          <div className="form-actions">
            <Button type="submit" disabled={save.isPending}>
              {editing ? s.save : s.add}
            </Button>
            {editing ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setV(emptyAgency);
                }}
              >
                {s.cancel}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Catégories de marchandises
// ---------------------------------------------------------------------------------------------
function CategoriesSection() {
  const { m } = useI18n();
  const s = m.staff.settings;
  const can = useCan('rate:manage');
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['categories'] as const, queryFn: () => api<{ items: Category[] }>('/v1/admin/categories') });
  const [v, setV] = useState({ code: '', fr: '', ht: '', en: '', restricted: false });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['categories'] });

  const create = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/categories', { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      setV({ code: '', fr: '', ht: '', en: '', restricted: false });
      void refresh();
    },
    onError: (e) => setError(apiErrorMessage(e, m)),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/v1/admin/categories/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void refresh(),
    onError: (e) => setError(apiErrorMessage(e, m)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = { fr: v.fr.trim() || v.en.trim() || v.ht.trim(), ht: v.ht.trim() || v.fr.trim() || v.en.trim(), en: v.en.trim() || v.fr.trim() || v.ht.trim() };
    create.mutate({ code: v.code.trim().toUpperCase(), name, restricted: v.restricted });
  }

  const items = list.data?.items ?? [];
  return (
    <Section title={s.categories.title} hint={s.categories.hint}>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <ul className="list-plain">
        {items.map((c) => (
          <li key={c.id} className="card row-card" data-testid="settings-category">
            <div>
              <strong className="mono">{c.code}</strong> · {c.name.fr}
              {c.restricted ? <span className="badge badge-warning">{s.categories.restricted}</span> : null}
              {c.active ? null : <span className="badge">{s.inactive}</span>}
            </div>
            {can ? (
              <div className="form-actions">
                <Button variant="outline" onClick={() => patch.mutate({ id: c.id, body: { restricted: !c.restricted } })}>
                  {c.restricted ? s.categories.unrestrict : s.categories.restrict}
                </Button>
                <Button variant="outline" onClick={() => patch.mutate({ id: c.id, body: { active: !c.active } })}>
                  {c.active ? s.deactivate : s.activate}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {can ? (
        <form className="form" onSubmit={submit}>
          <h3 style={{ fontSize: '1rem' }}>{s.categories.add}</h3>
          <div className="form-grid form-grid-2">
            <TextField name="catCode" label={s.categories.code} value={v.code} onChange={(x) => setV({ ...v, code: x })} hint={s.categories.codeHint} />
            <TextField name="catFr" label={s.categories.nameFr} value={v.fr} onChange={(x) => setV({ ...v, fr: x })} />
            <TextField name="catHt" label={s.categories.nameHt} optional value={v.ht} onChange={(x) => setV({ ...v, ht: x })} />
            <TextField name="catEn" label={s.categories.nameEn} optional value={v.en} onChange={(x) => setV({ ...v, en: x })} />
          </div>
          <CheckField name="catRestricted" checked={v.restricted} onChange={(x) => setV({ ...v, restricted: x })}>
            {s.categories.restrictedHint}
          </CheckField>
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending || !v.code.trim() || !(v.fr.trim() || v.en.trim() || v.ht.trim())}>
              {s.add}
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Valeurs de départ (remplace le script de mise en place)
// ---------------------------------------------------------------------------------------------
/** Adaptateur : les appels du panel (jeton et cookies déjà gérés) au format attendu par la mise en place partagée. */
const panelCall: Call = async (method, path, body) => {
  try {
    return { status: 200, body: await api<unknown>(path, { method, ...(body !== undefined ? { body } : {}) }) };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
    throw e;
  }
};

function StartSection() {
  const { m } = useI18n();
  const s = m.staff.settings;
  const allowed = useCan('warehouse:manage') && useCan('agency:manage') && useCan('rate:manage') && useCan('settings:update');
  const queryClient = useQueryClient();
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<{ created: number; kept: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!allowed) return null;
  async function run() {
    setBusy(true);
    setError(null);
    setLog([]);
    setResult(null);
    try {
      const lines: string[] = [];
      const r = await runSetup(panelCall, { validFrom: new Date().toISOString().slice(0, 10), log: (line) => { lines.push(line.trim()); setLog([...lines]); } });
      setResult({ created: r.created.length, kept: r.kept.length });
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Section title={s.start.title} hint={s.start.hint}>
      <ul>
        {s.start.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <Alert tone="info">{s.start.safe}</Alert>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {result ? <FormMessage tone="success">{format(s.start.done, { created: String(result.created), kept: String(result.kept) })}</FormMessage> : null}
      {log.length > 0 ? (
        <pre className="mono" data-testid="start-log" style={{ whiteSpace: 'pre-wrap' }}>
          {log.join('\n')}
        </pre>
      ) : null}
      <div className="form-actions">
        {confirm ? (
          <>
            <Button onClick={() => void run()} disabled={busy}>
              {s.start.confirm}
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {s.cancel}
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirm(true)} disabled={busy}>
            {s.start.button}
          </Button>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------
/** Paramètres de l'entreprise : tout ce qu'il faut régler avant de travailler, sans passer par un script. */
export function StaffSettingsPage() {
  const { m, lang } = useI18n();
  const s = m.staff.settings;
  const canRates = useCan('rate:read');
  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{s.title}</h1>
      <p className="lead">{s.lead}</p>
      <nav aria-label={s.shortcuts} className="card">
        <p style={{ margin: 0 }}>
          <strong>{s.shortcuts}</strong> :{' '}
          {canRates ? (
            <>
              <Link to={localizedPath(lang, '/rates')}>{m.staff.nav.rates}</Link> · <Link to={localizedPath(lang, '/customs')}>{m.staff.nav.customs}</Link>
            </>
          ) : null}
        </p>
      </nav>
      <StartSection />
      <ContactSection />
      <WarehousesSection />
      <AgenciesSection />
      <CategoriesSection />
      <FxSection />
      <ThresholdSection />
    </>
  );
}
