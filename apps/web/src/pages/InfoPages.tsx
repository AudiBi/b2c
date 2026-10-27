import { config } from '../config';
import { useI18n } from '../i18n';
import { usePageMeta } from '../seo';
import { LocLink } from '../components/LocLink';
import { Alert } from '../components/ui/Alert';
import { ButtonLink } from '../components/ui/Button';
import type { IconName } from '../components/ui/Icon';
import { Accordion, Card, CheckList, CtaBand, PageHero, Section, Steps } from '../components/ui/Sections';
import type { PageKey } from '../routes';

const serviceIcons: Record<string, IconName> = { air: 'plane', sea: 'ship', international: 'globe', local: 'truck' };

export function AboutPage() {
  const { m } = useI18n();
  const a = m.about;
  usePageMeta('about');
  return (
    <>
      <PageHero title={a.title} lead={a.lead} />
      <Section title={a.missionTitle}>
        <div className="prose">
          {a.mission.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Section>
      <Section title={a.valuesTitle} alt>
        <div className="grid grid-4">
          {a.values.map((value) => (
            <Card key={value.title} title={value.title}>
              <p>{value.text}</p>
            </Card>
          ))}
        </div>
      </Section>
      <Section title={a.audienceTitle}>
        <div className="grid grid-2">
          {a.audience.map((item) => (
            <Card key={item.title} title={item.title}>
              <p>{item.text}</p>
            </Card>
          ))}
        </div>
        <p style={{ marginTop: 24 }}>
          <ButtonLink page="register">{a.cta}</ButtonLink>
        </p>
      </Section>
    </>
  );
}

export function ServicesPage() {
  const { m } = useI18n();
  usePageMeta('services');
  return (
    <>
      <PageHero title={m.services.title} lead={m.services.lead} />
      <Section>
        <div className="grid grid-2">
          {m.home.services.map((service) => (
            <LocLink key={service.key} page={service.key as PageKey} className="card card-link">
              <h2 style={{ fontSize: '1.3rem' }}>{service.title}</h2>
              <p>{service.text}</p>
              <span className="more">{m.services.learnMore} →</span>
            </LocLink>
          ))}
        </div>
      </Section>
      <Section>
        <CtaBand
          title={m.services.ctaTitle}
          text={m.services.ctaText}
          primary={{ page: 'faq', label: m.services.ctaPrimary }}
          secondary={{ page: 'contact', label: m.services.ctaSecondary }}
        />
      </Section>
    </>
  );
}

export function ServiceDetailPage({ kind }: { kind: 'air' | 'sea' | 'international' | 'local' }) {
  const { m } = useI18n();
  const page = m.servicePages[kind];
  usePageMeta(kind);
  const others = (['air', 'sea', 'international', 'local'] as const).filter((key) => key !== kind);
  return (
    <>
      <PageHero title={m.nav[kind]} lead={page.lead} />
      <Section title={page.highlightsTitle}>
        <div className="grid grid-3">
          {page.highlights.map((item) => (
            <Card key={item.title} icon={serviceIcons[kind]} title={item.title}>
              <p>{item.text}</p>
            </Card>
          ))}
        </div>
      </Section>
      <Section title={page.howTitle} alt>
        <Steps items={page.how.map((text, index) => ({ title: `${index + 1}`, text }))} />
      </Section>
      <Section title={page.knowTitle}>
        <div className="prose">
          <CheckList items={page.know} />
        </div>
      </Section>
      <Section>
        <CtaBand title={m.servicePages.ctaTitle} text={m.servicePages.ctaText} primary={{ page: 'register', label: m.servicePages.cta }} secondary={{ page: 'calculator', label: m.nav.calculator }} />
        <p className="center" style={{ marginTop: 24 }}>
          {others.map((key, index) => (
            <span key={key}>
              {index > 0 ? ' · ' : ''}
              <LocLink page={key}>{m.nav[key]}</LocLink>
            </span>
          ))}
        </p>
      </Section>
    </>
  );
}

export function HowItWorksPage() {
  const { m } = useI18n();
  const h = m.howItWorks;
  usePageMeta('howItWorks');
  return (
    <>
      <PageHero title={h.title} lead={h.lead} />
      <Section>
        <Steps items={h.steps} />
      </Section>
      <Section>
        <CtaBand title={h.ctaTitle} text={m.home.ctaText} primary={{ page: 'register', label: h.cta }} secondary={{ page: 'faq', label: h.faqLink }} />
      </Section>
    </>
  );
}

export function FaqPage() {
  const { m } = useI18n();
  const f = m.faq;
  usePageMeta('faq');
  return (
    <>
      <PageHero title={f.title} lead={f.lead} />
      <Section>
        <div className="prose" style={{ maxWidth: 820 }}>
          <Accordion items={f.items} />
        </div>
      </Section>
      <Section alt>
        <div className="center">
          <h2>{f.stillTitle}</h2>
          <p className="lead">{f.stillText}</p>
          <ButtonLink page="contact">{f.stillCta}</ButtonLink>
        </div>
      </Section>
    </>
  );
}

export function CalculatorPage() {
  const { m } = useI18n();
  const c = m.calculator;
  usePageMeta('calculator');
  return (
    <>
      <PageHero title={c.title} lead={c.lead} />
      <Section>
        {!config.features.calculator ? (
          <Alert tone="info" title={c.noticeTitle}>
            {c.notice}
          </Alert>
        ) : null}
        <h2>{c.principlesTitle}</h2>
        <div className="grid grid-2">
          {c.principles.map((item) => (
            <Card key={item.title} title={item.title}>
              <p>{item.text}</p>
            </Card>
          ))}
        </div>
      </Section>
      <Section title={c.exampleTitle} alt>
        <p className="prose lead">{c.example}</p>
      </Section>
      <Section>
        <CtaBand title={c.cta} text={c.ctaText} primary={{ page: 'register', label: c.cta }} secondary={{ page: 'faq', label: m.nav.faq }} />
      </Section>
    </>
  );
}

export function TrackingPage() {
  const { m } = useI18n();
  const t = m.tracking;
  usePageMeta('tracking');
  return (
    <>
      <PageHero title={t.title} lead={t.lead} />
      <Section>
        {!config.features.publicTracking ? (
          <Alert tone="info" title={t.noticeTitle}>
            {t.notice}
          </Alert>
        ) : null}
        <h2>{t.statusesTitle}</h2>
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
    </>
  );
}

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const { m } = useI18n();
  const doc = m.legal[kind];
  usePageMeta(kind);
  return (
    <>
      <PageHero title={doc.title} />
      <Section>
        <div className="prose">
          <Alert tone="warning">{m.legal.draftBanner}</Alert>
          <p className="muted">{m.legal.updated}</p>
          {doc.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </Section>
    </>
  );
}
