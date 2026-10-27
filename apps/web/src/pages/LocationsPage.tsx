import { useI18n, type Lang } from '../i18n';
import { usePageMeta } from '../seo';
import { usePublicWarehouses } from '../api/public';
import { Alert } from '../components/ui/Alert';
import { ButtonLink } from '../components/ui/Button';
import { PageHero, Section } from '../components/ui/Sections';

export function countryName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function LocationsPage() {
  const { m, lang } = useI18n();
  const l = m.locations;
  const warehouses = usePublicWarehouses();
  usePageMeta('locations');

  return (
    <>
      <PageHero title={l.title} lead={l.lead} />
      <Section title={l.warehousesTitle}>
        <p className="prose">{l.warehousesText}</p>
        {warehouses.isPending ? <p role="status">{m.common.loading}</p> : null}
        {warehouses.isError ? <Alert tone="warning">{m.common.errorLoad}</Alert> : null}
        {warehouses.data && warehouses.data.items.length === 0 ? <Alert tone="info">{l.warehousesEmpty}</Alert> : null}
        {warehouses.data && warehouses.data.items.length > 0 ? (
          <ul className="grid grid-2 list-plain">
            {warehouses.data.items.map((warehouse) => (
              <li key={warehouse.reference} className="card">
                <h3>{warehouse.name}</h3>
                <dl className="kv">
                  <dt>{l.address}</dt>
                  <dd>{warehouse.addressLine}</dd>
                  <dt>{l.city}</dt>
                  <dd>{warehouse.city}</dd>
                  <dt>{l.country}</dt>
                  <dd>{countryName(warehouse.country, lang)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        ) : null}
        <p style={{ marginTop: 24 }}>
          <ButtonLink page="register">{l.cta}</ButtonLink>
        </p>
      </Section>
      <Section title={l.agenciesTitle} alt>
        <p className="prose">{l.agenciesText}</p>
        <Alert tone="info">{l.agenciesEmpty}</Alert>
      </Section>
    </>
  );
}
