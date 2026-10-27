import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LocLink } from '../LocLink';
import type { PageKey } from '../../routes';

export type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';

const cls = (variant: Variant, size?: 'sm', block?: boolean) =>
  ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', block ? 'btn-block' : ''].filter(Boolean).join(' ');

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm';
  block?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', size, block, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls(variant, size, block)} {...rest}>
      {children}
    </button>
  );
}

/** Lien qui a l'apparence d'un bouton. */
export function ButtonLink({ page, search, variant = 'primary', size, block, children }: { page: PageKey; search?: string; variant?: Variant; size?: 'sm'; block?: boolean; children: ReactNode }) {
  return (
    <LocLink page={page} search={search} className={cls(variant, size, block)}>
      {children}
    </LocLink>
  );
}
