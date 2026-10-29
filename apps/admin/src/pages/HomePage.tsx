import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { format, useI18n } from '../i18n';
import { paths } from '../routes';
import { buildNav } from '../components/layout/nav';
import { Icon } from '../components/ui/Icon';

/** Accueil du panel : accès rapides vers les écrans ouverts à la personne connectée. */
export function HomePage() {
  const { m } = useI18n();
  const { user } = useAuth();
  if (!user) return null;
  const h = m.admin.home;
  const tiles = buildNav(user, m).flatMap((group) => group.items.filter((item) => item.page !== 'home').map((item) => ({ ...item, group: group.label })));
  return (
    <div className="stack">
      <section className="card hello">
        <h1>{format(h.hello, { name: user.firstName })}</h1>
        <p>{user.kind === 'PLATFORM' ? h.leadPlatform : h.leadStaff}</p>
      </section>
      {tiles.length === 0 ? <p className="muted">{h.noAccess}</p> : (
        <>
          <h2>{h.shortcuts}</h2>
          <div className="grid grid-3">
            {tiles.map((tile) => (
              <Link key={tile.page} to={paths[tile.page]} className="card tile">
                <span className="ico"><Icon name={tile.icon} /></span>
                <span>
                  <strong>{tile.label}</strong>
                  <span>{tile.group}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
      <Link to={paths.accountSecurity} className="card tile">
        <span className="ico"><Icon name="shield" /></span>
        <span>
          <strong>{h.security}</strong>
          <span>{h.securityLead}</span>
        </span>
      </Link>
    </div>
  );
}
