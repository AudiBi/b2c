import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionChange, refreshSession, setAccessToken, type SessionUser } from '../api/client';
import { config } from '../config';

/** Le serveur pose ce cookie (lisible, sans secret) quand une session peut être restaurée : sans lui, inutile d'appeler le serveur. */
const hasSessionHint = () => typeof document !== 'undefined' && /(?:^|;\s*)b2c_admin_session=1(?:;|$)/.test(document.cookie);

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthValue {
  status: Status;
  user: SessionUser | null;
  /** Vrai après une déconnexion demandée par la personne (et jusqu'à la prochaine connexion) : on retourne alors à l'accueil, pas à la connexion. */
  loggedOut: boolean;
  login(email: string, password: string, proof?: { totpCode?: string; recoveryCode?: string }, options?: { platform?: boolean }): Promise<SessionUser>;
  logout(options?: { allSessions?: boolean }): Promise<void>;
  reload(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);

  const loadUser = useCallback(async () => {
    const me = await api<SessionUser>('/v1/auth/me');
    setUser(me);
    setStatus('authenticated');
    return me;
  }, []);

  // Restaure la session au chargement grâce au cookie de renouvellement
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasSessionHint()) {
        setStatus('anonymous');
        return;
      }
      try {
        if (await refreshSession()) await loadUser();
        else if (!cancelled) setStatus('anonymous');
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadUser]);

  // Session perdue (renouvellement refusé) : retour à l'état déconnecté
  useEffect(
    () =>
      onSessionChange((signedIn) => {
        if (!signedIn) {
          setUser(null);
          setStatus('anonymous');
        }
      }),
    [],
  );

  const login = useCallback(
    async (email: string, password: string, proof: { totpCode?: string; recoveryCode?: string } = {}, options: { platform?: boolean } = {}) => {
      const result = await api<{ accessToken: string }>('/v1/auth/login', {
        method: 'POST',
        auth: false,
        body: { ...(options.platform ? {} : { companySlug: config.companySlug }), email, password, ...proof },
      });
      setAccessToken(result.accessToken);
      setLoggedOut(false);
      return loadUser();
    },
    [loadUser],
  );

  const logout = useCallback(async (options?: { allSessions?: boolean }) => {
    try {
      await api('/v1/auth/logout', { method: 'POST', body: { allSessions: options?.allSessions ?? false } });
    } catch {
      /* la session locale est quand même fermée */
    }
    setAccessToken(null);
    setLoggedOut(true);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, loggedOut, login, logout, reload: async () => void (await loadUser()) }),
    [status, user, loggedOut, login, logout, loadUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return value;
}
