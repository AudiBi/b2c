import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { config } from '../../config';
import { LANGS, useI18n } from '../../i18n';
import { paths } from '../../routes';
import { Icon } from '../ui/Icon';
import { buildNav } from './nav';
import { AccessDenied } from './AccessDenied';

const initials = (first: string, last: string) => `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '·';

function LanguageSwitcher() {
  const { lang, setLang, m } = useI18n();
  return (
    <div className="lang-switcher" role="group" aria-label={m.admin.topbar.language}>
      {LANGS.map((l) => (
        <button key={l} type="button" aria-pressed={l === lang} lang={l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false);
      } else if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (!user) return null;
  const t = m.admin.topbar;
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">{initials(user.firstName, user.lastName)}</span>
        <span className="user-meta">
          <strong>{user.firstName} {user.lastName}</strong>
          <span>{user.kind === 'PLATFORM' ? t.platformTeam : t.staff}</span>
        </span>
        <Icon name="chevron" width={16} height={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="menu-pop" role="menu">
          <div className="who">
            <strong>{user.firstName} {user.lastName}</strong>
            <span>{user.email}</span>
          </div>
          <Link className="menu-item" role="menuitem" to={paths.accountSecurity} onClick={() => setOpen(false)}>
            <Icon name="shield" /> {m.admin.nav.security}
          </Link>
          {config.siteUrl ? (
            <a className="menu-item" role="menuitem" href={config.siteUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="external" /> {t.viewSite}
            </a>
          ) : null}
          <button type="button" className="menu-item" role="menuitem" onClick={() => void logout()}>
            <Icon name="logout" /> {t.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Coque du panel : exige une session du personnel (ou de la plateforme), puis affiche barre latérale, barre du haut et écran courant. */
export function AdminShell() {
  const { status, user, loggedOut } = useAuth();
  const { m } = useI18n();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  const groups = useMemo(() => (user ? buildNav(user, m) : []), [user, m]);

  if (status === 'loading') {
    return (
      <div className="content">
        <p role="status">{m.common.loading}</p>
      </div>
    );
  }
  if (status === 'anonymous' || !user) {
    if (loggedOut) return <Navigate to={paths.login} replace />;
    return <Navigate to={`${paths.login}?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  }
  if (user.kind === 'CUSTOMER') return <AccessDenied />;
  // Double authentification obligatoire et pas encore activée : seul l'écran Sécurité (où on l'active) reste ouvert
  if (user.mfa?.enrollmentRequired && location.pathname !== paths.accountSecurity) return <Navigate to={paths.accountSecurity} replace />;

  const allItems = groups.flatMap((g) => g.items);
  const current = allItems.find((i) => (i.end ? location.pathname === paths[i.page] : location.pathname.startsWith(paths[i.page]) && paths[i.page] !== '/'));
  const title = location.pathname === paths.accountSecurity ? m.admin.nav.security : (current?.label ?? '');

  return (
    <div className="shell">
      <a className="skip-link" href="#main">{m.a11y.skip}</a>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="side-brand">
          <Link to={paths.home} aria-label={config.brandName}>
            <img src="/logo-mark.svg" alt="" width="62" height="34" />
          </Link>
        </div>
        <div className="side-tenant">{m.admin.panel} · {user.kind === 'PLATFORM' ? m.admin.topbar.platformTeam : config.companySlug}</div>
        <nav className="side-nav" aria-label={m.admin.topbar.mainNav}>
          {groups.map((group) => (
            <div className="side-group" key={group.id}>
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.page}>
                    <NavLink className="side-link" to={paths[item.page]} end={item.end}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="side-foot">© {new Date().getFullYear()} {config.brandName}</div>
      </aside>
      {open ? <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" /> : null}
      <div className="main-col">
        <header className="topbar">
          <button type="button" className="icon-btn nav-toggle" aria-expanded={open} aria-label={open ? m.admin.topbar.closeMenu : m.admin.topbar.openMenu} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'close' : 'menu'} />
          </button>
          <div className="crumbs">
            <span>{config.brandName}</span>
            {title ? (
              <>
                <span aria-hidden="true">/</span>
                <strong>{title}</strong>
              </>
            ) : null}
          </div>
          <div className="top-spacer" />
          <LanguageSwitcher />
          <UserMenu />
        </header>
        <main id="main" className="content">
          <Suspense fallback={<p role="status">{m.common.loading}</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
