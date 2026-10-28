// Crée .env à partir de .env.example en générant des secrets aléatoires.
// N'écrase jamais un .env existant (sauf avec --force). N'affiche aucun secret.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('.env existe déjà : rien à faire (utiliser --force pour le régénérer).');
  process.exit(0);
}
const hex = (n) => randomBytes(n).toString('hex');
const values = {
  __MIGRATOR_PW__: hex(16),
  __APP_PW__: hex(16),
  __S3_SECRET__: hex(16),
  __JWT_SECRET__: hex(32),
};
let text = readFileSync(join(root, '.env.example'), 'utf8');
for (const [marker, value] of Object.entries(values)) text = text.split(marker).join(value);
writeFileSync(target, text, { mode: 0o600 });
console.log('.env créé avec des secrets générés localement.');
