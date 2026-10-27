import { config } from '../config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Erreurs de validation du serveur : { champ: message }. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const result: Record<string, string> = {};
    for (const item of this.details as { path?: string; message?: string }[]) {
      if (item.path && item.message && !(item.path in result)) result[item.path] = item.message;
    }
    return result;
  }
}

export class NetworkError extends Error {
  constructor() {
    super('network');
    this.name = 'NetworkError';
  }
}

export interface SessionUser {
  id: string;
  companyId: string;
  kind: 'PLATFORM' | 'STAFF' | 'CUSTOMER';
  email: string;
  firstName: string;
  lastName: string;
  locale: 'fr' | 'ht' | 'en';
  emailVerified: boolean;
  roles: { userRoleId: string; roleCode: string; scopeType: string; scopeId: string | null }[];
  permissions: string[];
}

/** Jeton d'accès conservé en mémoire uniquement (jamais dans localStorage) : le cookie HttpOnly sert à le renouveler. */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export const getAccessToken = () => accessToken;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function onSessionChange(listener: (signedIn: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const notify = (signedIn: boolean) => listeners.forEach((listener) => listener(signedIn));

async function send(path: string, init: RequestInit & { token?: string | null }): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  try {
    return await fetch(`${config.apiBase}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new NetworkError();
  }
}

async function toError(response: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } = {};
  try {
    body = await response.json();
  } catch {
    /* corps vide ou non JSON */
  }
  const error = body.error ?? {};
  return new ApiError(response.status, error.code ?? 'ERROR', error.message ?? response.statusText, error.details, error.requestId);
}

/**
 * Renouvelle le jeton d'accès avec le cookie de renouvellement. Les appels simultanés partagent une seule
 * requête (un jeton de renouvellement ne peut servir qu'une fois) ; entre onglets, un verrou Web Locks sérialise.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const run = async () => {
      const response = await send('/v1/auth/refresh', {
        method: 'POST',
        headers: { 'X-CSRF-Protection': '1' },
        body: '{}',
      });
      if (!response.ok) {
        accessToken = null;
        return false;
      }
      const data = (await response.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    };
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      const ok = locks ? await locks.request('b2c-refresh', run) : await run();
      notify(ok);
      return ok;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** false pour les routes publiques (inscription, connexion, données publiques). */
  auth?: boolean;
  signal?: AbortSignal;
}

/** Appel de l'API avec renouvellement automatique du jeton d'accès (une seule nouvelle tentative). */
export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;
  const init = { method, signal, body: body === undefined ? undefined : JSON.stringify(body) };

  let response = await send(path, { ...init, token: auth ? accessToken : null });
  if (response.status === 401 && auth) {
    if (await refreshSession()) response = await send(path, { ...init, token: accessToken });
    else notify(false);
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
