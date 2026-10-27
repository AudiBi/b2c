import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api, getAccessToken, onSessionChange, refreshSession, setAccessToken } from '../src/api/client';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('client d’API', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('envoie le jeton d’accès en en-tête et jamais pour les routes publiques', async () => {
    setAccessToken('jeton-1');
    fetchMock.mockImplementation(async () => json(200, { ok: true }));
    await api('/v1/auth/me');
    await api('/v1/public/companies/x', { auth: false });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer jeton-1');
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBeNull();
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });

  it('renouvelle le jeton sur 401 puis rejoue la requête une seule fois', async () => {
    setAccessToken('expire');
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }))
      .mockResolvedValueOnce(json(200, { accessToken: 'neuf' })) // POST /v1/auth/refresh
      .mockResolvedValueOnce(json(200, { id: 'u1' }));
    const result = await api<{ id: string }>('/v1/auth/me');
    expect(result).toEqual({ id: 'u1' });
    expect(getAccessToken()).toBe('neuf');
    expect(fetchMock.mock.calls[1][0]).toBe('/v1/auth/refresh');
    const refreshHeaders = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(refreshHeaders.get('X-CSRF-Protection')).toBe('1');
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('Authorization')).toBe('Bearer neuf');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('deux requêtes qui expirent ensemble ne déclenchent qu’UN renouvellement (un jeton ne sert qu’une fois)', async () => {
    setAccessToken('expire');
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/v1/auth/refresh') {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json(200, { accessToken: 'neuf' });
      }
      const bearer = new Headers(init.headers).get('Authorization');
      return bearer === 'Bearer neuf' ? json(200, { ok: true }) : json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    });
    const [a, b] = await Promise.all([api('/v1/a'), api('/v1/b')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
  });

  it('si le renouvellement est refusé : erreur 401, session signalée perdue, jeton effacé', async () => {
    setAccessToken('expire');
    const events: boolean[] = [];
    const stop = onSessionChange((signedIn) => events.push(signedIn));
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));
    await expect(api('/v1/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
    expect(events).toContain(false);
    stop();
  });

  it('refreshSession() renvoie false sans exception quand aucune session n’existe', async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));
    await expect(refreshSession()).resolves.toBe(false);
  });

  it('traduit les erreurs du serveur en ApiError avec code, détails et identifiant de requête', async () => {
    fetchMock.mockResolvedValue(
      json(400, { error: { code: 'VALIDATION_ERROR', message: 'Données invalides', details: [{ path: 'email', message: 'x' }, { path: 'email', message: 'y' }, { path: 'phone', message: 'phone_format' }], requestId: 'rid-1' } }),
    );
    const error = (await api('/v1/x', { method: 'POST', auth: false, body: {} }).catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'rid-1' });
    expect(error.fieldErrors).toEqual({ email: 'x', phone: 'phone_format' });
  });

  it('gère une réponse d’erreur sans corps JSON et une réponse 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 })).mockResolvedValueOnce(json(204));
    await expect(api('/v1/x', { auth: false })).rejects.toMatchObject({ status: 502, code: 'ERROR' });
    await expect(api('/v1/x', { method: 'DELETE', auth: false })).resolves.toBeUndefined();
  });

  it('signale une panne réseau par NetworkError (distincte d’une erreur serveur)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/v1/x', { auth: false })).rejects.toBeInstanceOf(NetworkError);
  });

  it('n’envoie un corps JSON (et son en-tête) que si un corps est fourni', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    await api('/v1/x', { auth: false });
    await api('/v1/x', { method: 'POST', auth: false, body: { a: 1 } });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Content-Type')).toBeNull();
    expect(fetchMock.mock.calls[1][1].body).toBe('{"a":1}');
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Content-Type')).toBe('application/json');
  });
});
