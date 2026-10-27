import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { quoteInputSchema } from '@b2c/shared';
import { requestCustomerQuote, requestPublicQuote, usePublicRates, type QuoteLine, type QuoteRequest, type QuoteResponse, type RateCorridor } from '../api/public';
import { useAuth } from '../auth/AuthProvider';
import { issuesToErrors, apiErrorMessage, type FieldErrors } from '../forms/validation';
import { format, useI18n } from '../i18n';
import { formatMoney, formatWeight, parseDecimal } from '../lib/format';
import { usePageMeta } from '../seo';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { CheckField, FormMessage, RadioGroupField, SelectField, TextField } from '../components/ui/Fields';
import { Card, CtaBand, PageHero, Section } from '../components/ui/Sections';
import { countryName } from './LocationsPage';

const corridorKey = (c: RateCorridor) => `${c.transportMode}:${c.originCountry}:${c.destinationCountry}`;

interface FormState {
  corridor: string;
  weight: string;
  weightUnit: 'KG' | 'LB';
  length: string;
  width: string;
  height: string;
  dimensionUnit: 'CM' | 'IN';
  category: string;
  declaredValue: string;
  services: string[];
}

const blank: FormState = { corridor: '', weight: '', weightUnit: 'KG', length: '', width: '', height: '', dimensionUnit: 'CM', category: '', declaredValue: '', services: [] };

export function CalculatorPage() {
  const { m, lang } = useI18n();
  const c = m.calculator;
  usePageMeta('calculator');
  const rates = usePublicRates();
  const { status, user } = useAuth();
  const signedInCustomer = status === 'authenticated' && user?.kind === 'CUSTOMER';

  const [form, setForm] = useState<FormState>(blank);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const corridors = rates.data?.corridors ?? [];
  const selected = useMemo(() => corridors.find((x) => corridorKey(x) === form.corridor) ?? corridors[0], [corridors, form.corridor]);

  // Le premier trajet est sélectionné par défaut, avec les unités de sa grille
  useEffect(() => {
    if (corridors.length > 0 && !form.corridor) {
      setForm((f) => ({ ...f, corridor: corridorKey(corridors[0]), weightUnit: corridors[0].weightUnit, dimensionUnit: corridors[0].dimensionUnit }));
    }
  }, [corridors, form.corridor]);

  useEffect(() => {
    if (quote) resultRef.current?.focus();
  }, [quote]);

  const set = <K extends keyof FormState>(name: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(next)) if (key === name || key.startsWith(`${name}.`)) delete next[key];
      return next;
    });
  };

  function chooseCorridor(key: string) {
    const next = corridors.find((x) => corridorKey(x) === key);
    setForm((f) => ({ ...f, corridor: key, weightUnit: next?.weightUnit ?? f.weightUnit, dimensionUnit: next?.dimensionUnit ?? f.dimensionUnit, services: [] }));
    setQuote(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!selected) return;

    // Conversion des saisies : un nombre illisible est signalé, un champ vide est simplement absent
    const next: FieldErrors = {};
    const num = (key: string, text: string): number | undefined => {
      if (text.trim() === '') return undefined;
      const value = parseDecimal(text);
      if (value === null) next[key] = m.validation.number;
      return value ?? undefined;
    };
    const weightValue = num('weight.value', form.weight);
    const length = num('dimensions.length', form.length);
    const width = num('dimensions.width', form.width);
    const height = num('dimensions.height', form.height);
    const declared = num('declaredValue', form.declaredValue);
    const hasDimensions = [form.length, form.width, form.height].some((x) => x.trim() !== '');

    const payload = {
      transportMode: selected.transportMode,
      originCountry: selected.originCountry,
      destinationCountry: selected.destinationCountry,
      weight: { value: weightValue, unit: form.weightUnit },
      ...(hasDimensions ? { dimensions: { length, width, height, unit: form.dimensionUnit } } : {}),
      ...(form.category ? { categoryCode: form.category } : {}),
      ...(declared !== undefined ? { declaredValue: declared } : {}),
      optionalSurcharges: form.services,
    };
    const parsed = quoteInputSchema.safeParse(payload);
    if (!parsed.success) Object.assign(next, { ...issuesToErrors(parsed.error, m), ...next });
    if (!parsed.success || Object.keys(next).length > 0) {
      setErrors(next);
      setError(m.common.fixErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const body = parsed.data as QuoteRequest;
      setQuote(signedInCustomer ? await requestCustomerQuote(body) : await requestPublicQuote(body));
    } catch (e) {
      setQuote(null);
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  const corridorLabel = (x: RateCorridor) =>
    `${m.account.prealerts.fields.modes[x.transportMode]} · ${countryName(x.originCountry, lang)} → ${countryName(x.destinationCountry, lang)} (${x.currency})`;

  const lineLabel = (line: QuoteLine) => (line.kind === 'FREIGHT' ? c.result.freight : (line.label?.[lang] ?? line.label?.fr ?? line.code));

  return (
    <>
      <PageHero title={c.title} lead={c.lead} />
      <Section>
        {rates.isPending ? <p role="status">{m.common.loading}</p> : null}
        {rates.isError ? <Alert tone="warning">{c.unavailable}</Alert> : null}
        {rates.data && corridors.length === 0 ? (
          <Alert tone="info" title={c.noRatesTitle}>
            {c.noRates}
          </Alert>
        ) : null}

        {selected ? (
          <div className="calc-layout">
            <form className="form card" onSubmit={submit} noValidate aria-label={c.form.title}>
              <h2 style={{ fontSize: '1.2rem' }}>{c.form.title}</h2>
              {error ? <FormMessage tone="danger">{error}</FormMessage> : null}

              <SelectField
                name="corridor"
                label={c.form.corridor}
                value={corridorKey(selected)}
                onChange={chooseCorridor}
                options={corridors.map((x) => ({ value: corridorKey(x), label: corridorLabel(x) }))}
              />

              <div className="form-grid form-grid-2" style={{ alignItems: 'start' }}>
                <TextField name="weight" label={c.form.weight} inputMode="decimal" value={form.weight} onChange={(x) => set('weight', x)} error={errors['weight.value']} />
                <RadioGroupField
                  legend={c.form.weightUnit}
                  name="weightUnit"
                  value={form.weightUnit}
                  onChange={(x) => set('weightUnit', x as 'KG' | 'LB')}
                  options={[
                    { value: 'KG', label: c.form.units.KG },
                    { value: 'LB', label: c.form.units.LB },
                  ]}
                />
              </div>

              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend>{c.form.dimensionsTitle}</legend>
                <p className="hint" style={{ marginTop: 0 }}>
                  {c.form.dimensionsHint}
                </p>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
                  <TextField name="length" label={c.form.length} optional inputMode="decimal" value={form.length} onChange={(x) => set('length', x)} error={errors['dimensions.length']} />
                  <TextField name="width" label={c.form.width} optional inputMode="decimal" value={form.width} onChange={(x) => set('width', x)} error={errors['dimensions.width']} />
                  <TextField name="height" label={c.form.height} optional inputMode="decimal" value={form.height} onChange={(x) => set('height', x)} error={errors['dimensions.height']} />
                </div>
                <RadioGroupField
                  legend={c.form.dimensionUnit}
                  name="dimensionUnit"
                  value={form.dimensionUnit}
                  onChange={(x) => set('dimensionUnit', x as 'CM' | 'IN')}
                  options={[
                    { value: 'CM', label: c.form.dimUnits.CM },
                    { value: 'IN', label: c.form.dimUnits.IN },
                  ]}
                />
              </fieldset>

              {(rates.data?.categories.length ?? 0) > 0 ? (
                <SelectField
                  name="category"
                  label={c.form.category}
                  optional
                  value={form.category}
                  onChange={(x) => set('category', x)}
                  options={[{ value: '', label: c.form.categoryNone }, ...(rates.data?.categories ?? []).map((cat) => ({ value: cat.code, label: cat.name[lang] ?? cat.name.fr }))]}
                />
              ) : null}

              <TextField
                name="declaredValue"
                label={c.form.declaredValue}
                optional
                hint={format(c.form.declaredHint, { currency: selected.currency })}
                inputMode="decimal"
                value={form.declaredValue}
                onChange={(x) => set('declaredValue', x)}
                error={errors.declaredValue}
              />

              {selected.optionalSurcharges.length > 0 ? (
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend>{c.form.services}</legend>
                  {selected.optionalSurcharges.map((service) => (
                    <CheckField
                      key={service.code}
                      name={`service-${service.code}`}
                      checked={form.services.includes(service.code)}
                      onChange={(on) => set('services', on ? [...form.services, service.code] : form.services.filter((x) => x !== service.code))}
                    >
                      {service.name[lang] ?? service.name.fr}
                    </CheckField>
                  ))}
                </fieldset>
              ) : null}

              <div className="form-actions">
                <Button type="submit" disabled={busy}>
                  {busy ? c.form.working : c.form.submit}
                </Button>
                {quote ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuote(null);
                      setForm((f) => ({ ...blank, corridor: f.corridor, weightUnit: selected.weightUnit, dimensionUnit: selected.dimensionUnit }));
                    }}
                  >
                    {c.form.reset}
                  </Button>
                ) : null}
              </div>
            </form>

            {quote ? (
              <section className="card quote-result" aria-labelledby="quote-title" data-testid="quote-result">
                <h2 id="quote-title" tabIndex={-1} ref={resultRef} style={{ fontSize: '1.2rem', outline: 'none' }}>
                  {c.result.title} <span className="badge">{c.result.badge}</span>
                </h2>
                <dl className="kv">
                  <dt>{c.result.actualWeight}</dt>
                  <dd>{formatWeight(quote.result.actualWeight, quote.result.weightUnit, lang)}</dd>
                  <dt>{c.result.volumetricWeight}</dt>
                  <dd>{quote.result.volumetricWeight ? formatWeight(quote.result.volumetricWeight, quote.result.weightUnit, lang) : c.result.notProvided}</dd>
                  <dt>{c.result.billableWeight}</dt>
                  <dd>
                    <strong data-testid="billable-weight">{formatWeight(quote.result.billableWeight, quote.result.weightUnit, lang)}</strong>
                  </dd>
                </dl>
                <h3 style={{ fontSize: '1.05rem', marginTop: 20 }}>{c.result.linesTitle}</h3>
                <table className="table">
                  <tbody>
                    {quote.result.lines.map((line) => (
                      <tr key={line.code}>
                        <th scope="row">{lineLabel(line)}</th>
                        <td className="num">{formatMoney(line.amount, quote.result.currency, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">{c.result.total}</th>
                      <td className="num" data-testid="quote-total">
                        {formatMoney(quote.result.total, quote.result.currency, lang)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="muted">{format(c.result.grid, { name: quote.card.name, version: quote.card.version })}</p>
                <Alert tone="info">{c.result.disclaimer}</Alert>
                {quote.id ? <p className="muted">{c.result.saved}</p> : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title={c.principlesTitle} alt>
        <div className="grid grid-2">
          {c.principles.map((item) => (
            <Card key={item.title} title={item.title}>
              <p>{item.text}</p>
            </Card>
          ))}
        </div>
        <h3 style={{ marginTop: 32 }}>{c.exampleTitle}</h3>
        <p className="prose">{c.example}</p>
      </Section>
      <Section>
        <CtaBand title={c.cta} text={c.ctaText} primary={{ page: 'register', label: c.cta }} secondary={{ page: 'faq', label: m.nav.faq }} />
      </Section>
    </>
  );
}
