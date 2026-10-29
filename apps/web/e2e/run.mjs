// Recette navigateur : construit API et site pour l'entreprise « e2e », puis lance Playwright.
//   npm run test:e2e        (Docker doit tourner : npm run docker:up)
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(web, '../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Le site est construit pour l'entreprise de recette (variable de construction)
run(npm, ['run', 'build'], { cwd: root });
run(npm, ['run', 'build'], {
  cwd: web,
  env: { ...process.env, VITE_COMPANY_SLUG: 'e2e', SITE_URL: 'http://localhost:4173', VITE_ADMIN_URL: 'http://localhost:4174' },
});
// Le panel d'administration est une autre application : construit pour la même entreprise de recette
run(npm, ['run', 'build'], {
  cwd: resolve(root, 'apps/admin'),
  env: { ...process.env, VITE_COMPANY_SLUG: 'e2e', VITE_SITE_URL: 'http://localhost:4173' },
});
run('npx', ['playwright', 'test', ...process.argv.slice(2)], { cwd: web });
