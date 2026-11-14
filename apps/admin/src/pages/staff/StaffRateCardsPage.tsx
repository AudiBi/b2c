import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRateCardSchema } from '@b2c/shared';
import { api } from '../../api/client';
import { apiErrorMessage, issuesToErrors } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Fields';
import { useCan } from './queries';

interface Rule {
  categoryCode: string | null;
  weightFrom: string;
  weightTo: string | null;
  pricePerUnit: string;
  flatFee: string;
  minCharge: string;
  basis: 'WEIGHT' | 'VOLUME' | 'UNIT';
  volumetricDivisor: string | null;
}
interface Card {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  version: number;
  transportMode: 'AIR' | 'SEA';
  originCountry: string;
  destinationCountry: string;
  currency: string;
  weightUnit: 'KG' | 'LB';
  dimensionUnit: 'CM' | 'IN';
  volumetricDivisor: string;
  rules: Rule[];
}
interface RuleForm {
  category: string;
  basis: 'WEIGHT' | 'VOLUME' | 'UNIT';
  from: string;
  to: string;
  price: string;
  flat: string;
  min: string;
  divisor: string;
  cost: string;
}

const emptyRule = (): RuleForm => ({ category: '', basis: 'WEIGHT', from: '0', to: '', price: '', flat: '', min: '', divisor: '', cost: '' });
const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));

const cardsKey = ['rate-cards'] as const;

/** Grilles tarifaires : consultation, activation, duplication ; création avec tranches au poids, au volume (pied cube) ou à l'unité (baril). */
export function StaffRateCardsPage() {
  const { m } = useI18n();
  const r = m.staff.rates;
  const queryClient = useQueryClient();
  const canManage = useCan('rate:manage');
  const canCost = useCan('cost:manage');
  const cards = useQuery({ queryKey: cardsKey, queryFn: () => api<{ items: Card[] }>('/v1/admin/rate-cards') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: { code: string; name: { fr: string } }[] }>('/v1/admin/categories') });
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', mode: 'AIR', origin: 'US', destination: 'HT', currency: 'USD', weightUnit: 'LB', dimensionUnit: 'IN', divisor: '166', from: new Date().toISOString().slice(0, 10) });
  const [rules, setRules] = useState<RuleForm[]>([emptyRule()]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: cardsKey });
  const fail = (e: unknown) => setError(apiErrorMessage(e, m));
  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: 'activate' | 'retire' | 'duplicate' }) => api(`/v1/admin/rate-cards/${id}/${verb}`, { method: 'POST' }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: fail,
  });
  const create = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/rate-cards', { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      setRules([emptyRule()]);
      setForm((f) => ({ ...f, name: '' }));
      void refresh();
    },
    onError: fail,
  });

  const setRule = (i: number, patch: Partial<RuleForm>) => setRules((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      name: form.name.trim(),
      transportMode: form.mode,
      originCountry: form.origin,
      destinationCountry: form.destination,
      currency: form.currency,
      weightUnit: form.weightUnit,
      dimensionUnit: form.dimensionUnit,
      volumetricDivisor: num(form.divisor),
      minBillableWeight: 0,
      roundingMode: 'NONE',
      roundingStep: 1,
      validFrom: form.from,
      rules: rules.map((x) => ({
        ...(x.category ? { categoryCode: x.category } : {}),
        basis: x.basis,
        weightFrom: num(x.from) ?? 0,
        ...(num(x.to) !== undefined ? { weightTo: num(x.to) } : {}),
        pricePerUnit: num(x.price),
        ...(num(x.flat) !== undefined ? { flatFee: num(x.flat) } : {}),
        ...(num(x.min) !== undefined ? { minCharge: num(x.min) } : {}),
        ...(num(x.divisor) !== undefined ? { volumetricDivisor: num(x.divisor) } : {}),
        ...(canCost && num(x.cost) !== undefined ? { unitCost: num(x.cost) } : {}),
      })),
      surcharges: [],
    };
    const parsed = createRateCardSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error, m));
      setError(m.common.fixErrors);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  }

  const list = cards.data?.items ?? [];
  const basisLabel = (b: Rule['basis']) => r.bases[b];
  const unit = (c: Card, b: Rule['basis']) => (b === 'WEIGHT' ? (c.weightUnit === 'LB' ? 'lb' : 'kg') : b === 'VOLUME' ? 'pi³' : r.unit);

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{r.title}</h1>
      <p className="lead">{r.lead}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {cards.isPending ? <p role="status">{m.common.loading}</p> : null}
      {cards.data && list.length === 0 ? <Alert tone="info">{r.empty}</Alert> : null}

      <ul className="list-plain">
        {list.map((c) => (
          <li key={c.id} className="card" data-testid="rate-card">
            <div className="row-card">
              <div>
                <strong>{c.name}</strong> <span className={`badge${c.status === 'ACTIVE' ? ' badge-success' : ''}`}>{r.statuses[c.status]}</span>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {c.originCountry} → {c.destinationCountry} · {c.currency} · v{c.version}
                </p>
              </div>
              {canManage ? (
                <div className="form-actions">
                  {c.status === 'DRAFT' ? <Button onClick={() => action.mutate({ id: c.id, verb: 'activate' })}>{r.activate}</Button> : null}
                  {c.status === 'ACTIVE' ? (
                    <Button variant="outline" onClick={() => action.mutate({ id: c.id, verb: 'retire' })}>
                      {r.retire}
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={() => action.mutate({ id: c.id, verb: 'duplicate' })}>
                    {r.duplicate}
                  </Button>
                </div>
              ) : null}
            </div>
            <ul className="list-plain">
              {c.rules.map((x, i) => (
                <li key={i} className="muted">
                  {x.categoryCode ?? r.general} · {basisLabel(x.basis)} · {x.pricePerUnit} {c.currency} / {unit(c, x.basis)}
                  {x.weightFrom !== '0' || x.weightTo ? ` · [${x.weightFrom}–${x.weightTo ?? '∞'}[` : ''}
                  {x.volumetricDivisor ? ` · ÷ ${x.volumetricDivisor}` : ''}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {canManage ? (
        <form className="form card" onSubmit={submit}>
          <h2 style={{ fontSize: '1.1rem' }}>{r.newCard}</h2>
          <div className="form-grid form-grid-2">
            <TextField name="cardName" label={r.name} value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={errors.name} />
            <SelectField name="cardMode" label={r.mode} value={form.mode} onChange={(v) => setForm({ ...form, mode: v })} options={[{ value: 'AIR', label: m.staff.common.modes.AIR }, { value: 'SEA', label: m.staff.common.modes.SEA }]} />
            <TextField name="cardOrigin" label={r.origin} value={form.origin} onChange={(v) => setForm({ ...form, origin: v })} error={errors.originCountry} />
            <TextField name="cardDestination" label={r.destination} value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} error={errors.destinationCountry} />
            <TextField name="cardCurrency" label={r.currency} value={form.currency} onChange={(v) => setForm({ ...form, currency: v.toUpperCase() })} error={errors.currency} />
            <SelectField name="cardWeightUnit" label={r.weightUnit} value={form.weightUnit} onChange={(v) => setForm({ ...form, weightUnit: v })} options={[{ value: 'LB', label: 'lb' }, { value: 'KG', label: 'kg' }]} />
            <SelectField name="cardDimUnit" label={r.dimensionUnit} value={form.dimensionUnit} onChange={(v) => setForm({ ...form, dimensionUnit: v })} options={[{ value: 'IN', label: 'po' }, { value: 'CM', label: 'cm' }]} />
            <TextField name="cardDivisor" label={r.divisor} type="number" value={form.divisor} onChange={(v) => setForm({ ...form, divisor: v })} error={errors.volumetricDivisor} hint={r.divisorHint} />
            <TextField name="cardFrom" label={r.validFrom} type="date" value={form.from} onChange={(v) => setForm({ ...form, from: v })} error={errors.validFrom} />
          </div>

          <h3 style={{ fontSize: '1rem' }}>{r.rules}</h3>
          {errors.rules ? <p role="alert">{errors.rules}</p> : null}
          {rules.map((x, i) => (
            <div key={i} className="form-grid form-grid-2" data-testid="rule-row">
              <SelectField
                name={`ruleCategory-${i}`}
                label={r.category}
                value={x.category}
                onChange={(v) => setRule(i, { category: v })}
                options={[{ value: '', label: r.general }, ...(categories.data?.items ?? []).map((c) => ({ value: c.code, label: c.code }))]}
              />
              <SelectField name={`ruleBasis-${i}`} label={r.basis} value={x.basis} onChange={(v) => setRule(i, { basis: v as RuleForm['basis'] })} options={(['WEIGHT', 'VOLUME', 'UNIT'] as const).map((b) => ({ value: b, label: r.bases[b] }))} hint={r.basisHint} />
              <TextField name={`rulePrice-${i}`} label={r.price} type="number" value={x.price} onChange={(v) => setRule(i, { price: v })} error={errors[`rules.${i}.pricePerUnit`]} />
              <TextField name={`ruleFrom-${i}`} label={r.from} type="number" value={x.from} onChange={(v) => setRule(i, { from: v })} />
              <TextField name={`ruleTo-${i}`} label={r.to} optional type="number" value={x.to} onChange={(v) => setRule(i, { to: v })} />
              {x.basis === 'WEIGHT' ? <TextField name={`ruleDivisor-${i}`} label={r.ruleDivisor} optional type="number" value={x.divisor} onChange={(v) => setRule(i, { divisor: v })} hint={r.ruleDivisorHint} /> : null}
              {canCost ? <TextField name={`ruleCost-${i}`} label={r.unitCost} hint={r.unitCostHint} optional type="number" value={x.cost} onChange={(v) => setRule(i, { cost: v })} /> : null}
              <TextField name={`ruleFlat-${i}`} label={r.flat} optional type="number" value={x.flat} onChange={(v) => setRule(i, { flat: v })} />
              <TextField name={`ruleMin-${i}`} label={r.min} optional type="number" value={x.min} onChange={(v) => setRule(i, { min: v })} />
              {rules.length > 1 ? (
                <Button variant="outline" onClick={() => setRules((l) => l.filter((_, j) => j !== i))}>
                  {r.removeRule}
                </Button>
              ) : null}
            </div>
          ))}
          <div className="form-actions">
            <Button variant="outline" onClick={() => setRules((l) => [...l, emptyRule()])}>
              {r.addRule}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {r.create}
            </Button>
          </div>
          <p className="muted">{r.draftNote}</p>
        </form>
      ) : null}
    </>
  );
}
