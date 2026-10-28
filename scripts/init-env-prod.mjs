// Crée .env.production à partir de .env.production.example en générant des secrets aléatoires.
// N'écrase jamais un fichier existant (sauf avec --force). N'affiche aucun secret.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env.production');
if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('.env.production existe déjà : rien à faire (utiliser --force pour le régénérer, ce qui change TOUS les secrets).');
  process.exit(0);
}
const hex = (n) => randomBytes(n).toString('hex');
const values = {
  __MIGRATOR_PW__: hex(16),
  __APP_PW__: hex(16),
  __REDIS_PW__: hex(16),
  __JWT_SECRET__: hex(32),
  __TOTP_KEY__: hex(32),
};
let text = readFileSync(join(root, '.env.production.example'), 'utf8');
for (const [marker, value] of Object.entries(values)) text = text.split(marker).join(value);
writeFileSync(target, text, { mode: 0o600 });
console.log('.env.production créé avec des secrets générés localement.');
console.log('À renseigner à la main : PUBLIC_HOST, COMPANY_SLUG, SMTP_HOST, MAIL_FROM (et SEED_SUPERADMIN_* pour le premier administrateur).');
console.log('Sauvegardez TOTP_ENCRYPTION_KEY et JWT_ACCESS_SECRET dans un coffre de secrets, hors de cette machine.');
