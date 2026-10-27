import type { ReactNode } from 'react';
import { ButtonLink } from './Button';
import { Icon, type IconName } from './Icon';
import type { PageKey } from '../../routes';

export function PageHero({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <section className="page-hero">
      <div className="container">
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function Section({ title, lead, alt, children, id }: { title?: string; lead?: string; alt?: boolean; children: ReactNode; id?: string }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`section${alt ? ' section-alt' : ''}`} id={id} aria-labelledby={title ? headingId : undefined}>
      <div className="container">
        {title ? (
          <div className="section-head">
            <h2 id={headingId}>{title}</h2>
            {lead ? <p className="lead">{lead}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function Card({ icon, title, children }: { icon?: IconName; title: string; children: ReactNode }) {
  return (
    <div className="card">
      {icon ? <Icon name={icon} className="icon" /> : null}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Steps({ items, row }: { items: { title: string; text: string }[]; row?: boolean }) {
  return (
    <ol className={`steps${row ? ' steps-row grid' : ''}`}>
      {items.map((step) => (
        <li key={step.title}>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="check-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function CtaBand({ title, text, primary, secondary }: { title: string; text: string; primary: { page: PageKey; label: string }; secondary?: { page: PageKey; label: string } }) {
  return (
    <div className="cta-band on-dark">
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="hero-actions">
        <ButtonLink page={primary.page} variant="accent">
          {primary.label}
        </ButtonLink>
        {secondary ? (
          <ButtonLink page={secondary.page} variant="outline">
            {secondary.label}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}

/** Foire aux questions : éléments <details> natifs, accessibles au clavier sans JavaScript. */
export function Accordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="accordion">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <div className="answer">
            <p>{item.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
