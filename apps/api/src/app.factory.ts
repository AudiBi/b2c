import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { raw } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES } from '@b2c/shared';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { requestContextMiddleware } from './common/request-context';
import type { Env } from './config/env';

export function buildOpenApi(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('API logistique (nom provisoire : TransitHaïti)')
    .setDescription(
      "Toutes les routes sont sous /v1. Erreurs : { error: { code, message, details?, requestId } }. " +
        "Chaque route protégée indique ses permissions dans l'extension x-permissions.",
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Construit l'application (partagée par main.ts, le script OpenAPI et les tests). N'ouvre pas de port. */
export async function createApp(env: Env): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');

  app.use(requestContextMiddleware);
  const secureHeaders = helmet();
  app.use((req: any, res: any, next: any) => (req.path.startsWith('/docs') ? next() : secureHeaders(req, res, next)));
  app.use(cookieParser());
  // Téléversement de pièces jointes : corps binaire brut, limité en taille et aux types acceptés (le contenu est vérifié ensuite)
  app.use('/v1/files', raw({ type: [...ALLOWED_FILE_TYPES], limit: MAX_FILE_BYTES }));
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Type', 'X-CSRF-Protection', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (env.ENABLE_DOCS) SwaggerModule.setup('docs', app, buildOpenApi(app));
  return app;
}
