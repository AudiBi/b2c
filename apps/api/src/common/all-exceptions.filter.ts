import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from './errors';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'TOO_MANY_REQUESTS',
};

/** Format d'erreur unique : { error: { code, message, details?, requestId } }. Aucune trace n'est exposée. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const requestId = String(req.headers['x-request-id'] ?? '');

    const { status, body } = this.translate(exception, requestId);
    if (status >= 500) {
      this.logger.error({ err: exception, requestId, path: req.path }, 'Erreur serveur');
    }
    const retry = (body.error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (status === 429 && retry) res.setHeader('Retry-After', String(retry));
    res.status(status).json(body);
  }

  private translate(exception: unknown, requestId: string): { status: number; body: ErrorBody } {
    const make = (status: number, code: string, message: string, details?: unknown) => ({
      status,
      body: { error: { code, message, ...(details !== undefined ? { details } : {}), requestId } },
    });

    if (exception instanceof AppException) {
      return make(exception.getStatus(), exception.code, exception.message, exception.details);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message?.toString() ?? exception.message);
      return make(status, STATUS_CODES[status] ?? 'ERROR', message);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return make(409, 'CONFLICT', 'Cette ressource existe déjà');
      if (exception.code === 'P2025') return make(404, 'NOT_FOUND', 'Ressource introuvable');
    }
    // Erreurs du lecteur de corps (JSON invalide, trop volumineux) : statut 4xx porté par l'erreur
    const status = (exception as { status?: number; statusCode?: number })?.status ??
      (exception as { statusCode?: number })?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return make(status, STATUS_CODES[status] ?? 'BAD_REQUEST', 'Requête invalide');
    }
    return make(500, 'INTERNAL_ERROR', 'Erreur interne');
  }
}
