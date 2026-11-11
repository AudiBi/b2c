import { useLocation } from 'react-router';
import { breadcrumbTrail } from '../breadcrumbs';
import { useI18n } from '../i18n';
import { paths, type PageKey } from '../routes';
import { LocLink } from './LocLink';

const keyByPath = new Map<string, PageKey>((Object.entries(paths) as [PageKey, string][]).map(([key, path]) => [path, key]));

/** Fil d'Ariane visible (les mêmes pages alimentent les données structurées BreadcrumbList). */
export function Breadcrumbs() {
  const { m, lang } = useI18n();
  const { pathname } = useLocation();
  const key = keyByPath.get(pathname.slice(lang.length + 1).replace(/\/$/, ''));
  const trail = key ? breadcrumbTrail(key, m) : [];
  if (trail.length === 0) return null;
  return (
    <nav className="breadcrumbs" aria-label={m.a11y.breadcrumb}>
      <ol>
        {trail.map((crumb, index) => (
          <li key={crumb.key}>
            {index === trail.length - 1 ? <span aria-current="page">{crumb.label}</span> : <LocLink page={crumb.key}>{crumb.label}</LocLink>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
