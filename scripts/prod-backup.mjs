// Sauvegarde et exercice de restauration de la pile de production (docker/compose.prod.yml).
//   node scripts/prod-backup.mjs backup [--keep 14]     sauvegarde la base ET les pièces jointes dans backups/
//   node scripts/prod-backup.mjs drill [fichier.dump]    restaure la dernière sauvegarde (ou le fichier) dans une base TEMPORAIRE,
//                                                         la compare à la base en service, puis la supprime
// Ne modifie jamais la base en service. Une restauration réelle (sinistre) se fait à la main : docs/DEPLOYMENT.md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compose = ['compose', '-f', join(root, 'docker/compose.prod.yml'), '--env-file', join(root, process.env.ENV_FILE ?? '.env.production')];
const backups = join(root, 'backups');
const DB = 'b2c';

function run(args, { stdoutFile, input, allowFailure } = {}) {
  const fd = stdoutFile ? openSync(stdoutFile, 'w') : null;
  const result = spawnSync('docker', [...compose, ...args], {
    encoding: stdoutFile ? undefined : 'utf8',
    stdio: [input === undefined ? 'ignore' : 'pipe', fd ?? 'pipe', 'pipe'],
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (fd !== null) closeSync(fd);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker compose ${args.slice(0, 6).join(' ')} a échoué :\n${String(result.stderr)}`);
  }
  return result;
}
const sql = (db, text) => run(['exec', '-T', 'postgres', 'psql', '-U', 'b2c_migrator', '-d', db, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', text]).stdout.trim();

function sha256(file) {
  return new Promise((ok, ko) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => ok(hash.digest('hex'))).on('error', ko);
  });
}

async function backup() {
  mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const dump = join(backups, `db-${stamp}.dump`);
  const files = join(backups, `files-${stamp}.tar.gz`);

  run(['exec', '-T', 'postgres', 'pg_dump', '-U', 'b2c_migrator', '-d', DB, '-Fc'], { stdoutFile: dump });
  // Le fichier produit doit être lisible par pg_restore (liste de son contenu) : on ne garde pas une sauvegarde illisible
  const listing = run(['exec', '-T', 'postgres', 'pg_restore', '-l'], { input: readFileSync(dump), allowFailure: true });
  if (listing.status !== 0 || !String(listing.stdout).includes('TABLE')) {
    rmSync(dump, { force: true });
    throw new Error('La sauvegarde de la base est illisible par pg_restore : supprimée.');
  }
  writeFileSync(`${dump}.sha256`, `${await sha256(dump)}  ${dump.split(/[\\/]/).pop()}\n`);
  console.log(`Base : ${dump} (${(statSync(dump).size / 1024 / 1024).toFixed(2)} Mio, contenu vérifié par pg_restore -l)`);

  // Pièces jointes : seulement avec STORAGE_DRIVER=disk (avec S3, c'est le fournisseur qui les conserve)
  const mode = run(['exec', '-T', 'api', 'printenv', 'STORAGE_DRIVER'], { allowFailure: true }).stdout?.trim();
  if (mode === 'disk') {
    run(['exec', '-T', 'api', 'tar', '-C', '/data/files', '-czf', '-', '.'], { stdoutFile: files });
    writeFileSync(`${files}.sha256`, `${await sha256(files)}  ${files.split(/[\\/]/).pop()}\n`);
    console.log(`Pièces jointes : ${files} (${(statSync(files).size / 1024 / 1024).toFixed(2)} Mio)`);
  } else {
    console.log('Pièces jointes : stockage S3, non incluses (à sauvegarder côté fournisseur).');
  }

  const keep = Number(process.argv[process.argv.indexOf('--keep') + 1]);
  if (keep > 0) {
    for (const prefix of ['db-', 'files-']) {
      const old = readdirSync(backups).filter((f) => f.startsWith(prefix) && !f.endsWith('.sha256')).sort().slice(0, -keep);
      for (const f of old) for (const name of [f, `${f}.sha256`]) rmSync(join(backups, name), { force: true });
    }
  }
  console.log('RAPPEL : ces fichiers sont sur la même machine. Copiez-les HORS de cette machine (et chiffrez-les).');
}

async function drill() {
  const arg = process.argv[3];
  const dump = arg ? resolve(arg) : join(backups, readdirSync(backups).filter((f) => /^db-.*\.dump$/.test(f)).sort().pop() ?? '');
  if (!existsSync(dump) || !statSync(dump).isFile()) throw new Error('Aucune sauvegarde de base trouvée (lancer « backup » d\'abord).');
  const sumFile = `${dump}.sha256`;
  if (existsSync(sumFile)) {
    const expected = readFileSync(sumFile, 'utf8').split(/\s/)[0];
    if (expected !== (await sha256(dump))) throw new Error('Empreinte SHA-256 différente : la sauvegarde est altérée.');
    console.log('✔ empreinte SHA-256 conforme');
  }
  const temp = `${DB}_drill`;
  sql('postgres', `DROP DATABASE IF EXISTS "${temp}"`);
  sql('postgres', `CREATE DATABASE "${temp}" OWNER b2c_migrator`);
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push(ok);
    console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  try {
    const start = Date.now();
    const restore = run(['exec', '-T', 'postgres', 'pg_restore', '-U', 'b2c_migrator', '-d', temp, '--exit-on-error'], { input: readFileSync(dump), allowFailure: true });
    check('restauration sans erreur', restore.status === 0, `${((Date.now() - start) / 1000).toFixed(1)} s${restore.status === 0 ? '' : ` : ${String(restore.stderr).slice(0, 300)}`}`);
    const tables = sql(DB, "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1").split('\n').filter(Boolean);
    // La base en service peut avoir changé depuis la sauvegarde : on compare à titre indicatif et on signale les écarts
    const diffs = [];
    let rows = 0;
    for (const t of tables) {
      const restored = Number(sql(temp, `SELECT count(*) FROM "${t}"`));
      const live = Number(sql(DB, `SELECT count(*) FROM "${t}"`));
      rows += restored;
      if (restored !== live) diffs.push(`${t}: sauvegarde ${restored}, en service ${live}`);
    }
    console.log(`  ${tables.length} tables, ${rows} lignes restaurées` + (diffs.length ? ` ; écarts avec la base en service (normaux si elle a évolué depuis) : ${diffs.join('; ')}` : ' ; identiques à la base en service'));
    const rls = (db) => sql(db, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity");
    check('RLS activée et forcée comme en service', rls(temp) === rls(DB), `${rls(temp)} tables`);
    const migrations = (db) => sql(db, 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL');
    check('migrations appliquées identiques', migrations(temp) === migrations(DB), `${migrations(temp)}`);
    const grants = (db) => sql(db, "SELECT md5(string_agg(table_name||privilege_type, ',' ORDER BY table_name, privilege_type)) FROM information_schema.role_table_grants WHERE grantee='b2c_app' AND table_schema='public'");
    check('droits du rôle applicatif identiques', grants(temp) === grants(DB));
  } finally {
    sql('postgres', `DROP DATABASE IF EXISTS "${temp}"`);
  }
  if (checks.includes(false)) process.exitCode = 1;
  console.log(checks.includes(false) ? 'ÉCHEC de l\'exercice.' : 'Exercice de restauration réussi (base temporaire supprimée).');
}

const command = process.argv[2];
if (command === 'backup') await backup();
else if (command === 'drill') await drill();
else {
  console.error('Usage : node scripts/prod-backup.mjs backup [--keep N] | drill [fichier.dump]');
  process.exit(2);
}
