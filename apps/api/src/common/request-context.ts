import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestStore {
  requestId: string;
  ip?: string;
  userAgent?: string;
  actorUserId?: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

export function currentRequest(): RequestStore | undefined {
  return storage.getStore();
}

export function runWithRequest<T>(store: RequestStore, fn: () => T): T {
  return storage.run(store, fn);
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Attribue un identifiant à la requête et ouvre le contexte asynchrone (IP, agent, acteur). */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  const userAgent = req.headers['user-agent'];
  storage.run(
    { requestId, ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : undefined },
    next,
  );
}

/** Enregistre l'utilisateur authentifié dans le contexte (lu par le journal d'audit). */
export function setActor(userId: string): void {
  const store = storage.getStore();
  if (store) store.actorUserId = userId;
}
