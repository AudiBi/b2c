import { HttpException } from '@nestjs/common';

/** Erreur métier avec code stable (lisible par les clients) et statut HTTP. */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new AppException(400, code, message, details);
  }
  static unauthorized(code: string, message: string) {
    return new AppException(401, code, message);
  }
  static forbidden(code: string, message: string) {
    return new AppException(403, code, message);
  }
  static notFound(code: string, message: string) {
    return new AppException(404, code, message);
  }
  static conflict(code: string, message: string) {
    return new AppException(409, code, message);
  }
  static unprocessable(code: string, message: string) {
    return new AppException(422, code, message);
  }
  static tooManyRequests(code: string, message: string, retryAfterSeconds?: number) {
    return new AppException(429, code, message, retryAfterSeconds ? { retryAfterSeconds } : undefined);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
