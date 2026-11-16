// Diagnostic de la connexion à la base de développement : « Authentication failed … credentials for b2c_app are not valid ».
//   npm run doctor:db            diagnostic seul (n'affiche aucun mot de passe, ne modifie rien)
//   npm run doctor:db -- --fix   aligne le mot de passe du rôle b2c_app (et b2c_migrator ne bouge jamais) sur celui du fichier .env
// Causes recherchées : variable d'environnement système qui écrase .env, mots de passe différents dans .env, volume Docker créé avec
// d'autres mots de passe, autre PostgreSQL sur le même port, caractères spéciaux non encodés dans l'adresse.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');
const shellEnv = { ...process.env }; // avant toute lecture de .env : ce que le shell impose déjà
const compose = ['compose', '-f', join(root, 'docker/compose.dev.yml'), '--env-file', join(root, '.env')];
const problems = [];
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m, hint) => {
  console.log(`  ✘ ${m}`);
  problems.push(hint ?? m);
};

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
function parseUrl(raw) {
  try {
    const u = new URL(raw);
    return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), rawPassword: u.password, host: u.hostname, port: Number(u.port || 5432), db: u.pathname.slice(1) };
  } catch {
    return null;
  }
}
const docker = (args, env = {}) => spawnSync('docker', [...compose, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

console.log('Diagnostic de la base de développement\n');

console.log('1. Fichier .env');
if (!existsSync(join(root, '.env'))) {
  bad('.env introuvable à la racine du dépôt', 'Créez-le avec « npm run setup:env » (une seule fois, avant le premier « npm run docker:up »).');
  report();
}
const env = parseEnv(join(root, '.env'));
for (const key of ['POSTGRES_APP_PASSWORD', 'POSTGRES_MIGRATOR_PASSWORD', 'DATABASE_URL', 'DIRECT_URL']) {
  if (!env[key] || env[key].startsWith('__')) bad(`${key} absent ou non généré`, `${key} n'est pas renseigné : lancez « npm run setup:env » ou complétez .env.`);
}
const app = parseUrl(env.DATABASE_URL ?? '');
const migrator = parseUrl(env.DIRECT_URL ?? '');
if (!app) bad('DATABASE_URL illisible', 'DATABASE_URL n’est pas une adresse valide (caractères spéciaux du mot de passe à encoder : @ → %40, / → %2F, : → %3A…).');
if (app && env.POSTGRES_APP_PASSWORD) {
  if (app.password === env.POSTGRES_APP_PASSWORD) ok('le mot de passe de DATABASE_URL est celui de POSTGRES_APP_PASSWORD');
  else bad('le mot de passe de DATABASE_URL DIFFÈRE de POSTGRES_APP_PASSWORD', 'Dans .env, le mot de passe de DATABASE_URL (et TEST_DATABASE_URL) doit être identique à POSTGRES_APP_PASSWORD.');
  if (app.rawPassword !== encodeURIComponent(app.password)) bad('le mot de passe de DATABASE_URL contient des caractères à encoder', 'Encodez les caractères spéciaux du mot de passe dans l’adresse (@ → %40, / → %2F, : → %3A, # → %23).');
}
if (migrator && env.POSTGRES_MIGRATOR_PASSWORD && migrator.password !== env.POSTGRES_MIGRATOR_PASSWORD) {
  bad('le mot de passe de DIRECT_URL DIFFÈRE de POSTGRES_MIGRATOR_PASSWORD', 'Dans .env, DIRECT_URL (et TEST_DIRECT_URL) doit utiliser POSTGRES_MIGRATOR_PASSWORD.');
}

console.log('\n2. Variables d’environnement du système (elles passent AVANT .env)');
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL', 'TEST_DIRECT_URL']) {
  if (shellEnv[key] !== undefined && shellEnv[key] !== env[key]) {
    bad(`${key} est défini dans votre système/terminal et diffère de .env`, `La variable système ${key} écrase .env. Supprimez-la (PowerShell : Remove-Item Env:${key} ; Windows : Paramètres → Variables d’environnement) puis relancez le terminal.`);
  }
}
if (!problems.some((p) => p.startsWith('La variable système'))) ok('aucune variable système ne masque .env');

console.log('\n3. Le serveur PostgreSQL joint est-il le bon ?');
if (app) {
  const reachable = await new Promise((done) => {
    const s = net.connect({ host: app.host, port: app.port, timeout: 2500 }, () => (s.end(), done(true)));
    s.on('error', () => done(false));
    s.on('timeout', () => (s.destroy(), done(false)));
  });
  if (!reachable) bad(`rien n'écoute sur ${app.host}:${app.port}`, 'Démarrez la base : « npm run docker:up ».');
  else ok(`un serveur répond sur ${app.host}:${app.port}`);
  const owner = spawnSync('docker', ['ps', '--filter', `publish=${app.port}`, '--format', '{{.Names}}'], { encoding: 'utf8' });
  const names = String(owner.stdout ?? '').trim().split(/\s+/).filter(Boolean);
  if (names.length === 0) console.log('  ? aucun conteneur Docker ne publie ce port (un PostgreSQL installé sur la machine ?)');
  else if (names.every((n) => n.startsWith('b2c-'))) ok(`port publié par ${names.join(', ')}`);
  else bad(`le port ${app.port} est publié par ${names.join(', ')} : ce n'est pas la base de B2C`, `Un autre projet occupe le port ${app.port}. Arrêtez-le, ou changez POSTGRES_PORT dans .env (et les ports des adresses de base).`);
}

console.log('\n4. Connexion réelle avec le rôle b2c_app (mot de passe de .env, depuis l’intérieur du conteneur)');
const pg = docker(['ps', '--format', '{{.Name}}', 'postgres']);
if (pg.status !== 0 || !String(pg.stdout).trim()) {
  bad('le conteneur PostgreSQL de B2C ne tourne pas', 'Démarrez la base : « npm run docker:up ».');
} else if (app) {
  // Adresse du conteneur (et non 127.0.0.1) : PostgreSQL y exige le mot de passe, comme pour l'API ; en boucle locale il fait confiance sans le vérifier
  const login = docker(['exec', '-T', '-e', `PGPASSWORD=${app.password}`, 'postgres', 'sh', '-c', 'psql -h "$(hostname -i | cut -d" " -f1)" -U b2c_app -d b2c_dev -tAc "select current_user"'], {});
  if (login.status === 0) ok('b2c_app se connecte avec le mot de passe de .env : la base et .env sont d’accord');
  else if (/password authentication failed/i.test(String(login.stderr))) {
    bad('b2c_app est REFUSÉ avec le mot de passe de .env : le volume Docker a été créé avec un autre mot de passe', 'Le volume de la base garde l’ancien mot de passe de b2c_app. Gardez les données : « npm run doctor:db -- --fix ». Base jetable : « docker compose -f docker/compose.dev.yml --env-file .env down -v » puis « npm run docker:up », « npm run db:migrate », « npm run db:seed ».');
  } else bad(`connexion impossible : ${String(login.stderr).trim().split('\n')[0]}`, 'Voir le message ci-dessus.');
}

if (fix && app && env.POSTGRES_APP_PASSWORD) {
  console.log('\n5. Correction (--fix)');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(env.POSTGRES_APP_PASSWORD)) {
    bad('POSTGRES_APP_PASSWORD contient des caractères que je n’injecte pas dans une commande SQL', 'Utilisez un mot de passe composé de lettres, chiffres, tirets (npm run setup:env en génère).');
  } else {
    const alter = docker(['exec', '-T', 'postgres', 'psql', '-U', 'b2c_migrator', '-d', 'b2c_dev', '-v', 'ON_ERROR_STOP=1', '-c', `ALTER ROLE b2c_app PASSWORD '${env.POSTGRES_APP_PASSWORD}'`]);
    if (alter.status === 0) {
      ok('mot de passe de b2c_app aligné sur POSTGRES_APP_PASSWORD ; relancez l’API');
      problems.length = 0;
    } else bad(`échec : ${String(alter.stderr).trim().split('\n')[0]}`, 'La correction a échoué (voir ci-dessus).');
  }
}
report();

function report() {
  console.log('');
  if (problems.length === 0) {
    console.log('Aucun problème trouvé. Si l’erreur persiste, redémarrez l’API (elle lit .env au démarrage) et le terminal.');
    process.exit(0);
  }
  console.log('À faire :');
  [...new Set(problems)].forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  process.exit(1);
}
