import { useI18n } from '../i18n';
import { pageLabel } from '../breadcrumbs';
import type { PageKey } from '../routes';
import { LocLink } from './LocLink';
import { Section } from './ui/Sections';

/** « Pour aller plus loin » : liens internes vers des pages liées, avec la description de chaque page (aucun texte en plus à traduire). */
export function RelatedPages({ keys }: { keys: readonly PageKey[] }) {
  const { m } = useI18n();
  return (
    <Section title={m.related.title} alt id="related">
      <ul className="grid grid-3 list-plain">
        {keys.map((key) => (
          <li key={key}>
            <LocLink page={key} className="card card-link">
              <h3>{pageLabel(key, m)}</h3>
              <p>{m.seo[key as keyof typeof m.seo].description}</p>
              <span className="more">{m.services.learnMore} →</span>
            </LocLink>
          </li>
        ))}
      </ul>
    </Section>
  );
}
