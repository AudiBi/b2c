import { useAuth } from '../../auth/AuthProvider';
import { config } from '../../config';
import { useI18n } from '../../i18n';
import { Icon } from '../ui/Icon';

/** Un compte client est connecté sur le panel : l'accès est refusé et la session peut être fermée. */
export function AccessDenied() {
  const { m } = useI18n();
  const { logout } = useAuth();
  return (
    <div className="auth-main" style={{ minHeight: '100vh' }}>
      <div className="auth-box center">
        <Icon name="lock" width={40} height={40} style={{ margin: '0 auto 12px', color: 'var(--ink-400)' }} />
        <h1>{m.admin.login.staffOnly}</h1>
        <div className="form-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
          {config.siteUrl ? (
            <a className="btn btn-primary" href={config.siteUrl}>
              {m.admin.login.goSite}
            </a>
          ) : null}
          <button type="button" className="btn btn-outline" onClick={() => void logout()}>
            {m.admin.topbar.signOut}
          </button>
        </div>
      </div>
    </div>
  );
}
