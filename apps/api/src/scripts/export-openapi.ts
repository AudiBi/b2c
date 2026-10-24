import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApi, createApp } from '../app.factory';
import { loadEnv } from '../config/env';

/** Génère docs/openapi.json sans ouvrir de port ni se connecter à la base. */
async function main(): Promise<void> {
  const env = loadEnv({ ...process.env, ENABLE_DOCS: 'false', LOG_LEVEL: 'silent' });
  const app = await createApp(env);
  const document = buildOpenApi(app);
  const target = resolve(__dirname, '../../../../docs/openapi.json');
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`OpenAPI écrit : ${target} (${Object.keys(document.paths).length} chemins)`);
  process.exit(0);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
