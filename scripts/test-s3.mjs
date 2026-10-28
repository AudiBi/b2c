// Lance les tests de l'adaptateur S3 contre le vrai stockage objet de développement (SeaweedFS, profil Docker « storage »).
//   docker compose -f docker/compose.dev.yml --profile storage up -d seaweedfs   puis   npm run test:s3
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run('npm', ['run', 'build:shared']);
run('npm', ['run', 'prisma:generate']);
run('npm', ['-w', '@b2c/api', 'exec', '--', 'jest', '--config', 'jest.config.js', '--runInBand', 's3-storage'], { RUN_S3_TESTS: 'true' });
