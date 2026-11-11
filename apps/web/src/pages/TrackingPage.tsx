import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { trackPackage } from '../api/public';
import { apiErrorMessage } from '../forms/validation';
import { format, useI18n } from '../i18n';
import { formatDateTime } from '../lib/format';
import { usePageMeta } from '../seo';
import { RelatedPages } from '../components/RelatedPages';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { TextField } from '../components/ui/Fields';
import { PageHero, Section } from '../components/ui/Sections';
import { StatusBadge, Timeline } from '../components/PackageParts';
import { countryName } from './LocationsPage';

export function TrackingPage() {
  const { m, lang } = useI18n();
  const t = m.tracking;
  usePageMeta('tracking');

  // Le numéro vit dans l'adresse (?n=…) : un lien de suivi peut être partagé ou enregistré
  const [params, setParams] = useSearchParams();
  const number = params.get('n')?.trim() ?? '';
  const [input, setInput] = useState(number);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const query = useQuery({
    queryKey: ['public', 'tracking', number],
    queryFn: ({ signal }) => trackPackage(number, signal),
    enabled: number.length > 0,
    retry: false,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (query.data) resultRef.current?.focus();
  }, [query.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = input.trim();
    if (!next) return;
    // Même numéro : la personne veut des nouvelles, on relit le serveur au lieu de réafficher le résultat en mémoire
    if (next === number) void query.refetch();
    else setParams({ n: next });
  }

  const notFound = query.error instanceof ApiError && (query.error.code === 'TRACKING_NOT_FOUND' || query.error.status === 400);
  const data = query.data;

  return (
    <>
      <PageHero title={t.title} lead={t.lead} />
      <Section>
        <form className="form card" onSubmit={submit} noValidate aria-label={t.form.submit} style={{ maxWidth: 640 }}>
          <TextField name="tracking" label={t.form.label} hint={t.form.hint} value={input} onChange={setInput} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <div className="form-actions">
            <Button type="submit" disabled={query.isFetching || input.trim() === ''}>
              {query.isFetching ? t.form.searching : t.form.submit}
            </Button>
          </div>
        </form>

        <div aria-live="polite" style={{ marginTop: 24 }}>
          {query.isError ? <Alert tone={notFound ? 'warning' : 'danger'}>{notFound ? t.notFound : apiErrorMessage(query.error, m)}</Alert> : null}
        </div>

        {data ? (
          <section className="card" aria-labelledby="tracking-title" data-testid="tracking-result" style={{ marginTop: 8 }}>
            <h2 id="tracking-title" tabIndex={-1} ref={resultRef} style={{ fontSize: '1.3rem', outline: 'none' }}>
              {format(t.result.title, { number: data.trackingNumber })}
            </h2>
            <p>
              <strong>{t.result.status} : </strong>
              <StatusBadge status={data.status} />
            </p>
            <p className="muted">{format(t.result.lastUpdate, { date: formatDateTime(data.lastUpdate, lang) })}</p>
            <dl className="kv">
              <dt>{t.result.route}</dt>
              <dd>
                {data.origin.city}, {countryName(data.origin.country, lang)} → {data.destination.city ? `${data.destination.city}, ` : ''}
                {countryName(data.destination.country, lang)}
              </dd>
              {data.transportMode ? (
                <>
                  <dt>{t.result.mode}</dt>
                  <dd>{t.result.modes[data.transportMode]}</dd>
                </>
              ) : null}
            </dl>
            {data.pickup ? (
              <div data-testid="tracking-pickup" style={{ marginTop: 16 }}>
                <Alert tone={data.pickup.ready ? 'success' : 'info'} title={t.result.pickupTitle}>
                  {data.pickup.ready ? t.result.pickupReady : t.result.pickupHere} {data.pickup.name}, {data.pickup.addressLine}, {data.pickup.city}
                  {data.pickup.hours ? ` — ${data.pickup.hours}` : ''}
                </Alert>
              </div>
            ) : null}
            <h3 style={{ fontSize: '1.1rem', marginTop: 24 }}>{t.result.historyTitle}</h3>
            <Timeline events={data.events} label={t.result.historyTitle} />
            {data.estimatedDelivery ? null : (
              <p className="muted" style={{ marginTop: 16 }}>
                {t.result.noEstimate}
              </p>
            )}
          </section>
        ) : null}
      </Section>

      <Section title={t.statusesTitle} alt>
        <ol className="grid grid-3 list-plain" style={{ counterReset: 'status' }}>
          {t.statuses.map((status) => (
            <li key={status} className="card" style={{ padding: 16 }}>
              {status}
            </li>
          ))}
        </ol>
        <h3 style={{ marginTop: 32 }}>{t.otherTitle}</h3>
        <p>{t.other}</p>
        <p className="muted">{t.privacy}</p>
        <p>
          <ButtonLink page="register">{t.cta}</ButtonLink>
        </p>
      </Section>
      <RelatedPages keys={['howItWorks', 'faq', 'locations']} />
    </>
  );
}
