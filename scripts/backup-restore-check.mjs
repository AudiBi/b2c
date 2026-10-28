// Test de sauvegarde / restauration (phase 9) : sauvegarde la base de TEST, la restaure dans une base neuve, puis prouve
// que la copie est fidèle ET que ses protections ont survécu (RLS, déclencheurs, droits).
//   npm run backup:check        (Docker doit tourner : npm run docker:up)
// Ne touche jamais à la base de développement. La base de copie est supprimée à la fin.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const container = process.env.POSTGRES_CONTAINER ?? 'b2c-postgres-1';
const migratorUrl = process.env.TEST_DIRECT_URL;
const appPassword = process.env.POSTGRES_APP_PASSWORD;
if (!migratorUrl || !appPassword) throw new Error('TEST_DIRECT_URL ou POSTGRES_APP_PASSWORD absent : lancer « npm run setup:env » puis « npm run docker:up ».');
const source = new URL(migratorUrl).pathname.replace(/^\//, '');
if (!source.endsWith('_test')) throw new Error(`Refus : la base « ${source} » n'est pas une base de test.`);
const copy = `${source}_restore`;
const DUMP = '/tmp/b2c-backup-check.dump';

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`docker ${args.slice(0, 4).join(' ')} a échoué :\n${result.stderr || result.stdout}`);
  return result;
}
const psql = (db, sql, user = 'b2c_migrator', password) =>
  docker(['exec', ...(password ? ['-e', `PGPASSWORD=${password}`] : []), container, 'psql', ...(password ? ['-h', '127.0.0.1'] : []), '-U', user, '-d', db, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { allowFailure: true });
const query = (db, sql) => {
  const r = psql(db, sql);
  if (r.status !== 0) throw new Error(`SQL refusé sur ${db} : ${r.stderr}`);
  return r.stdout.trim();
};

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const timed = (label, fn) => {
  const start = Date.now();
  const value = fn();
  console.log(`  (${label} : ${((Date.now() - start) / 1000).toFixed(1)} s)`);
  return value;
};

// 1. Sauvegarde ----------------------------------------------------------------------------------------------------
console.log(`Sauvegarde de « ${source} » (format personnalisé pg_dump)…`);
timed('pg_dump', () => docker(['exec', container, 'pg_dump', '-U', 'b2c_migrator', '-d', source, '-Fc', '-f', DUMP]));
const size = Number(docker(['exec', container, 'sh', '-c', `stat -c %s ${DUMP}`]).stdout.trim());
const digest = createHash('sha256').update(docker(['exec', container, 'sha256sum', DUMP]).stdout.split(/\s/)[0]).digest('hex').slice(0, 12);
check('sauvegarde produite', size > 0, `${(size / 1024 / 1024).toFixed(1)} Mio, empreinte ${digest}`);

// 2. Restauration dans une base neuve --------------------------------------------------------------------------------
psql('postgres', `DROP DATABASE IF EXISTS "${copy}"`);
query('postgres', `CREATE DATABASE "${copy}" OWNER b2c_migrator`);
try {
  console.log(`Restauration dans « ${copy} »…`);
  const restore = timed('pg_restore', () => docker(['exec', container, 'pg_restore', '-U', 'b2c_migrator', '-d', copy, '--exit-on-error', DUMP], { allowFailure: true }));
  check('restauration sans erreur', restore.status === 0, restore.status === 0 ? '' : restore.stderr.slice(0, 300));

  // 3. Fidélité des données ---------------------------------------------------------------------------------------------
  const tables = query(source, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1").split('\n').filter(Boolean);
  const count = (db, table) => Number(query(db, `SELECT count(*) FROM "${table}"`));
  const diffs = [];
  let rows = 0;
  for (const table of tables) {
    const a = count(source, table);
    const b = count(copy, table);
    rows += a;
    if (a !== b) diffs.push(`${table}: ${a} ≠ ${b}`);
  }
  check(`nombre de lignes identique sur les ${tables.length} tables`, diffs.length === 0, diffs.length ? diffs.join('; ') : `${rows} lignes au total`);

  const migrations = (db) => query(db, 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1');
  check('historique des migrations identique', migrations(source) === migrations(copy), `${migrations(copy).split('\n').length} migrations`);

  // Empreinte du contenu des tables sensibles (ordre fixé) : détecte une valeur altérée, pas seulement un nombre de lignes
  const fingerprint = (db, table, order) => query(db, `SELECT md5(string_agg(t::text, '|' ORDER BY ${order})) FROM "${table}" t`);
  for (const [table, order] of [['users', 'id'], ['invoices', 'id'], ['payments', 'id'], ['audit_log', 'id'], ['packages', 'id']]) {
    if (!tables.includes(table)) continue;
    check(`contenu de « ${table} » identique (empreinte md5)`, fingerprint(source, table, order) === fingerprint(copy, table, order));
  }

  // 4. Les protections ont survécu --------------------------------------------------------------------------------------
  const rls = (db) => query(db, "SELECT string_agg(relname || ':' || relrowsecurity || ':' || relforcerowsecurity, ',' ORDER BY relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'");
  check('RLS activée et forcée comme à la source', rls(source) === rls(copy), `${(rls(copy).match(/:true:true/g) ?? []).length} tables protégées`);
  const policies = (db) => query(db, "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'");
  check('politiques de sécurité identiques', policies(source) === policies(copy), `${policies(copy)} politiques`);
  const triggers = (db) => query(db, "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public'");
  check('déclencheurs identiques (immuabilité, plafonds, ajout seul)', triggers(source) === triggers(copy), `${triggers(copy)} déclencheurs`);
  const grants = (db) => query(db, "SELECT md5(string_agg(table_name || privilege_type, ',' ORDER BY table_name, privilege_type)) FROM information_schema.role_table_grants WHERE grantee = 'b2c_app' AND table_schema = 'public'");
  check('droits du rôle applicatif identiques', grants(source) === grants(copy));

  // 5. Preuve fonctionnelle, avec le rôle applicatif (celui de l'API), sur la COPIE ---------------------------------------
  const company = query(copy, "SELECT company_id FROM packages GROUP BY company_id ORDER BY count(*) DESC LIMIT 1");
  const expected = Number(query(copy, `SELECT count(*) FROM packages WHERE company_id = '${company}'`));
  const asApp = (sql) => {
    const r = psql(copy, sql, 'b2c_app', appPassword);
    return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const noContext = asApp('SELECT count(*) FROM packages');
  check('sans contexte d\'entreprise, le rôle applicatif ne voit aucun colis', noContext.ok && noContext.out === '0', noContext.err);
  const withContext = asApp(`BEGIN; SELECT set_config('app.company_id', '${company}', true); SELECT count(*) FROM packages; COMMIT`);
  check('avec le contexte de l\'entreprise, il retrouve exactement ses colis', withContext.ok && withContext.out.split('\n').includes(String(expected)) && expected > 0, `${expected} colis`);
  const otherCompany = asApp(`BEGIN; SELECT set_config('app.company_id', '00000000-0000-7000-8000-0000000000ff', true); SELECT count(*) FROM packages; COMMIT`);
  check('avec le contexte d\'une autre entreprise, il n\'en voit aucun', otherCompany.ok && otherCompany.out.split('\n').includes('0'), otherCompany.err);
  const audit = psql(copy, "UPDATE audit_log SET action = 'falsifié' WHERE id = (SELECT id FROM audit_log LIMIT 1)");
  check('le journal d\'audit restauré reste inaltérable', audit.status !== 0 && /ajout seul|append|immuable/i.test(audit.stderr), audit.stderr.split('\n')[0]);
} finally {
  psql('postgres', `DROP DATABASE IF EXISTS "${copy}"`);
  docker(['exec', container, 'rm', '-f', DUMP], { allowFailure: true });
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} contrôles réussis.`);
if (failed.length) process.exitCode = 1;
