import { useAuth } from '../../auth/AuthProvider';
import { config } from '../../config';
import { useI18n } from '../../i18n';

/** Un compte du personnel ou de la plateforme est connecté sur le site : son espace de travail est le panel d'administration. */
export function StaffNotice() {
  const { m } = useI18n();
  const { logout } = useAuth();
  const n = m.account.staffNotice;
  return (
    <div className="container section">
      <div className="card auth-card stack">
        <h1 style={{ fontSize: '1.6rem' }}>{n.title}</h1>
        <p>{n.text}</p>
        <div className="form-actions">
          {config.adminUrl ? (
            <a className="btn btn-primary" href={config.adminUrl}>
              {n.open}
            </a>
          ) : null}
          <button type="button" className="btn btn-outline" onClick={() => void logout()}>
            {m.nav.logout}
          </button>
        </div>
      </div>
    </div>
  );
}
