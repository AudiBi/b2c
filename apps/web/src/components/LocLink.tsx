import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useI18n } from '../i18n';
import { localized, type PageKey } from '../routes';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  page: PageKey;
  search?: string;
  children: ReactNode;
}

/** Lien vers une page du site, dans la langue courante. */
export function LocLink({ page, search, children, ...rest }: Props) {
  const { lang } = useI18n();
  return (
    <Link to={`${localized(lang, page)}${search ?? ''}`} {...rest}>
      {children}
    </Link>
  );
}

/** Lien de navigation : `aria-current="page"` automatique sur la page active. */
export function LocNavLink({ page, end, children, className }: { page: PageKey; end?: boolean; children: ReactNode; className?: string }) {
  const { lang } = useI18n();
  return (
    <NavLink to={localized(lang, page)} end={end} className={className}>
      {children}
    </NavLink>
  );
}
