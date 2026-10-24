import {
  applyDecorators,
  CallHandler,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { z, type ZodType } from 'zod';
import { AppException } from './errors';

const VALIDATE_KEY = 'b2c:validate';

export interface ValidateSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

type Section = keyof ValidateSchemas;

function toOpenApi(schema: ZodType): Record<string, any> {
  const json = z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as Record<string, any>;
  delete json.$schema;
  return json;
}

/** Déclare les schémas zod d'une route : validation stricte + documentation OpenAPI. */
export function Validate(schemas: ValidateSchemas): MethodDecorator & ClassDecorator {
  const decorators: Array<MethodDecorator | ClassDecorator> = [SetMetadata(VALIDATE_KEY, schemas)];
  if (schemas.body) decorators.push(ApiBody({ schema: toOpenApi(schemas.body) as any }));
  if (schemas.query) {
    const json = toOpenApi(schemas.query);
    const required: string[] = json.required ?? [];
    for (const [name, property] of Object.entries<any>(json.properties ?? {})) {
      decorators.push(ApiQuery({ name, required: required.includes(name), schema: property }));
    }
  }
  return applyDecorators(...decorators);
}

const validated = (section: Section) =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<Request>().validated?.[section];
  })();

/** Corps, paramètres de requête et d'URL après validation (types à renseigner avec z.infer). */
export const VBody = () => validated('body');
export const VQuery = () => validated('query');
export const VParams = () => validated('params');

@Injectable()
export class ValidationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schemas = this.reflector.get<ValidateSchemas | undefined>(VALIDATE_KEY, context.getHandler());
    if (!schemas) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const result: NonNullable<Request['validated']> = {};
    for (const section of ['body', 'query', 'params'] as const) {
      const schema = schemas[section];
      if (!schema) continue;
      const parsed = schema.safeParse(section === 'body' ? (req.body ?? {}) : req[section]);
      if (!parsed.success) {
        throw AppException.badRequest(
          'VALIDATION_ERROR',
          'Données invalides',
          parsed.error.issues.map((issue) => ({
            in: section,
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }
      result[section] = parsed.data;
    }
    req.validated = result;
    return next.handle();
  }
}
