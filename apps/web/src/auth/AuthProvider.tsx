import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionChange, refreshSession, setAccessToken, type SessionUser } from '../api/client';
import { config } from '../config';

/** Le serveur pose ce cookie (lisible, sans secret) quand une session peut être restaurée : sans lui, inutile d'appeler le serveur. */
const hasSessionHint = () => typeof document !== 'undefined' && /(?:^|;\s*)b2c_session=1(?:;|$)/.test(document.cookie);

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthValue {
  status: Status;
  user: SessionUser | null;
  login(email: string, password: string): Promise<SessionUser>;
  logout(options?: { allSessions?: boolean }): Promise<void>;
  reload(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

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
    async (email: string, password: string) => {
      const result = await api<{ accessToken: string }>('/v1/auth/login', {
        method: 'POST',
        auth: false,
        body: { companySlug: config.companySlug, email, password },
      });
      setAccessToken(result.accessToken);
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
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, login, logout, reload: async () => void (await loadUser()) }),
    [status, user, login, logout, loadUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return value;
}
