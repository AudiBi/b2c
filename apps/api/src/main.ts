import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.factory';
import { loadEnv } from './config/env';

function loadDotenv(): void {
  // Variables déjà présentes dans l'environnement (conteneur, CI) : prioritaires, rien à charger.
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.API_PORT);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
