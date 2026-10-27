import { useI18n } from '../i18n';
import { usePageMeta } from '../seo';
import { LocLink } from '../components/LocLink';
import { Alert } from '../components/ui/Alert';
import { ButtonLink } from '../components/ui/Button';
import { Icon, type IconName } from '../components/ui/Icon';
import { Card, CtaBand, Section, Steps } from '../components/ui/Sections';
import type { PageKey } from '../routes';

const serviceIcons: Record<string, IconName> = { air: 'plane', sea: 'ship', international: 'globe', local: 'truck' };
const benefitIcons: IconName[] = ['pin', 'route', 'receipt', 'plane', 'truck', 'shield'];

/** Illustration originale : un colis, un avion et un bateau. */
function HeroArt({ alt }: { alt: string }) {
  return (
    <svg className="hero-art" viewBox="0 0 460 320" role="img" aria-label={alt}>
      <rect width="460" height="320" rx="24" fill="rgb(255 255 255 / 0.08)" />
      <path d="M0 250c60-20 100 20 160 0s100 20 160 0 100 20 140 0v70H0z" fill="rgb(255 255 255 / 0.14)" />
      <g transform="translate(150 90)">
        <path d="M80 0 0 40v80l80 40 80-40V40z" fill="#f2a541" />
        <path d="M0 40l80 40 80-40M80 80v80" fill="none" stroke="#0b2545" strokeWidth="6" strokeLinejoin="round" />
        <path d="M60 18l60 30" stroke="#0b2545" strokeWidth="6" strokeLinecap="round" />
      </g>
      <g transform="translate(40 40) rotate(-12)" fill="#fff">
        <path d="M0 40l70-28V0a8 8 0 0116 0v12l54 28v10l-54-12v22l16 12v8l-24-6-24 6v-8l16-12V38l-70 12z" />
      </g>
      <g transform="translate(300 215)" fill="#fff">
        <path d="M0 24h110l-16 28H16zM20 24V6h70v18M45 6V-8h20v14" />
      </g>
    </svg>
  );
}

export function HomePage() {
  const { m } = useI18n();
  const h = m.home;
  usePageMeta('home');

  return (
    <>
      <section className="hero on-dark">
        <div className="container hero-grid">
          <div>
            <h1>{h.hero.title}</h1>
            <p className="lead">{h.hero.subtitle}</p>
            <div className="hero-actions">
              <ButtonLink page="register" variant="accent">
                {h.hero.primary}
              </ButtonLink>
              <ButtonLink page="calculator" variant="outline">
                {h.hero.secondary}
              </ButtonLink>
            </div>
          </div>
          <HeroArt alt={h.hero.imageAlt} />
        </div>
      </section>

      <Section>
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem' }}>{h.track.title}</h2>
            <p style={{ margin: 0 }} className="muted">
              {h.track.text}
            </p>
          </div>
          <ButtonLink page="tracking" variant="outline">
            {h.track.cta}
          </ButtonLink>
        </div>
      </Section>

      <Section title={h.servicesTitle} lead={h.servicesLead} id="services">
        <div className="grid grid-4">
          {h.services.map((service) => (
            <LocLink key={service.key} page={service.key as PageKey} className="card card-link">
              <Icon name={serviceIcons[service.key]} className="icon" width={44} height={44} />
              <h3>{service.title}</h3>
              <p>{service.text}</p>
              <span className="more">{m.services.learnMore} →</span>
            </LocLink>
          ))}
        </div>
      </Section>

      <Section title={h.stepsTitle} lead={h.stepsLead} alt id="steps">
        <Steps items={h.steps} row />
      </Section>

      <Section title={h.benefitsTitle} id="benefits">
        <div className="grid grid-3">
          {h.benefits.map((benefit, index) => (
            <Card key={benefit.title} icon={benefitIcons[index]} title={benefit.title}>
              <p>{benefit.text}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section alt>
        <div className="grid grid-2" style={{ alignItems: 'center' }}>
          <div>
            <h2>{h.locationsTitle}</h2>
            <p className="lead">{h.locationsText}</p>
            <ButtonLink page="locations" variant="outline">
              {h.locationsCta}
            </ButtonLink>
          </div>
          <Alert tone="info">{m.locations.warehousesText}</Alert>
        </div>
      </Section>

      <Section>
        <CtaBand
          title={h.ctaTitle}
          text={h.ctaText}
          primary={{ page: 'register', label: m.nav.register }}
          secondary={{ page: 'howItWorks', label: m.nav.howItWorks }}
        />
      </Section>
    </>
  );
}
