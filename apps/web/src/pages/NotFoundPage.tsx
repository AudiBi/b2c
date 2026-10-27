import { useI18n } from '../i18n';
import { usePageMeta } from '../seo';
import { ButtonLink } from '../components/ui/Button';
import { PageHero, Section } from '../components/ui/Sections';

export function NotFoundPage() {
  const { m } = useI18n();
  usePageMeta('notFound');
  return (
    <>
      <PageHero title={m.notFound.title} />
      <Section>
        <p className="lead">{m.notFound.text}</p>
        <ButtonLink page="home">{m.notFound.cta}</ButtonLink>
      </Section>
    </>
  );
}
