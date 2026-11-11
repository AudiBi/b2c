import { useI18n } from '../i18n';
import { usePageMeta } from '../seo';
import { RelatedPages } from '../components/RelatedPages';
import { usePublicCompany } from '../api/public';
import { Alert } from '../components/ui/Alert';
import { ButtonLink } from '../components/ui/Button';
import { CheckList, PageHero, Section } from '../components/ui/Sections';

const telHref = (phone: string) => `tel:${phone}`;
const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

export function ContactPage() {
  const { m } = useI18n();
  const c = m.contact;
  const company = usePublicCompany();
  usePageMeta('contact');
  const contact = company.data?.contact;
  const social = contact
    ? ([['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube']] as const).filter(([key]) => contact[key])
    : [];
  const hasAny = !!contact && (contact.email || contact.phones.length > 0 || contact.whatsapp || contact.address || contact.hours || social.length > 0);

  return (
    <>
      <PageHero title={c.title} lead={c.lead} />
      <Section title={c.channelsTitle}>
        {company.isPending ? <p role="status">{m.common.loading}</p> : null}
        {company.isError ? <Alert tone="warning">{m.common.errorLoad}</Alert> : null}
        {company.data && !hasAny ? <Alert tone="info">{c.empty}</Alert> : null}
        {contact && hasAny ? (
          <div className="card" style={{ maxWidth: 640 }}>
            <dl className="kv">
              {contact.email ? (
                <>
                  <dt>{c.email}</dt>
                  <dd>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </dd>
                </>
              ) : null}
              {contact.phones.length > 0 ? (
                <>
                  <dt>{c.phone}</dt>
                  <dd>
                    {contact.phones.map((phone, index) => (
                      <span key={phone}>
                        {index > 0 ? ' · ' : ''}
                        <a href={telHref(phone)}>{phone}</a>
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
              {contact.whatsapp ? (
                <>
                  <dt>{c.whatsapp}</dt>
                  <dd>
                    <a href={whatsappHref(contact.whatsapp)} rel="noopener noreferrer" target="_blank">
                      {contact.whatsapp}
                    </a>
                  </dd>
                </>
              ) : null}
              {contact.address ? (
                <>
                  <dt>{c.address}</dt>
                  <dd style={{ whiteSpace: 'pre-line' }}>{contact.address}</dd>
                </>
              ) : null}
              {contact.hours ? (
                <>
                  <dt>{c.hours}</dt>
                  <dd style={{ whiteSpace: 'pre-line' }}>{contact.hours}</dd>
                </>
              ) : null}
              {social.length > 0 ? (
                <>
                  <dt>{c.social}</dt>
                  <dd>
                    {social.map(([key, label], index) => (
                      <span key={key}>
                        {index > 0 ? ' · ' : ''}
                        <a href={contact[key]} rel="noopener noreferrer" target="_blank">
                          {label}
                        </a>
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}
      </Section>
      <Section title={c.adviceTitle} alt>
        <div className="prose">
          <CheckList items={c.advice} />
        </div>
      </Section>
      <Section title={c.helpTitle}>
        <p className="prose">{c.helpText}</p>
        <ButtonLink page="faq" variant="outline">
          {c.helpCta}
        </ButtonLink>
      </Section>
      <RelatedPages keys={['faq', 'locations', 'tracking']} />
    </>
  );
}
