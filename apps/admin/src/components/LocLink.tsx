import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { paths, type PageKey } from '../routes';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  page: PageKey;
  search?: string;
  children: ReactNode;
}

/** Lien vers un écran du panel. */
export function LocLink({ page, search, children, ...rest }: Props) {
  return (
    <Link to={`${paths[page]}${search ?? ''}`} {...rest}>
      {children}
    </Link>
  );
}

/** Lien de navigation : `aria-current="page"` automatique sur l'écran actif. */
export function LocNavLink({ page, end, children, className }: { page: PageKey; end?: boolean; children: ReactNode; className?: string }) {
  return (
    <NavLink to={paths[page]} end={end} className={className}>
      {children}
    </NavLink>
  );
}
