/**
 * @file migrate.js
 * @description Minimal, dependency-free SQL migration runner.
 *
 * Migrations live in db/migrations/NNNN_name.sql and are applied in
 * lexical order exactly once. Applied versions are recorded in the
 * `schema_migrations` table. A Postgres advisory lock guarantees that two
 * API instances booting at the same time cannot run migrations concurrently.
 *
 * CLI:
 *   node src/db/migrate.js          # apply pending migrations
 *   node src/db/migrate.js status   # list applied / pending
 *
 * Programmatic: const { runMigrations } = require('./src/db/migrate');
 */

const fs   = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'db', 'migrations');
/** Arbitrary app-wide advisory lock key (any int64 works). */
const LOCK_KEY = 727374;

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort();
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

/**
 * Apply all pending migrations.
 * @param {{ log?: { info: Function, error: Function } }} [opts]
 * @returns {Promise<string[]>} names of migrations applied in this run
 */
async function runMigrations(opts = {}) {
  const log = opts.log || console;
  const files = listMigrationFiles();
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);
    const done = new Set(
      (await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
    );

    for (const file of files) {
      const version = file.slice(0, 4);
      if (done.has(version)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      log.info(`[migrate] applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [version, file],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        err.message = `[migrate] ${file} failed: ${err.message}`;
        throw err;
      }
      applied.push(file);
    }

    log.info(
      applied.length
        ? `[migrate] applied ${applied.length} migration(s)`
        : '[migrate] schema is up to date',
    );
    return applied;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (_) { /* ignore */ }
    client.release();
  }
}

async function migrationStatus() {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const rows = (await client.query('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')).rows;
    const done = new Map(rows.map((r) => [r.version, r]));
    return listMigrationFiles().map((file) => {
      const v = file.slice(0, 4);
      return { file, applied: done.has(v), applied_at: done.get(v)?.applied_at || null };
    });
  } finally {
    client.release();
  }
}

module.exports = { runMigrations, migrationStatus, MIGRATIONS_DIR };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
  const cmd = process.argv[2] || 'up';
  (async () => {
    if (cmd === 'status') {
      const rows = await migrationStatus();
      for (const r of rows) {
        console.log(`${r.applied ? '✔' : '…'} ${r.file}${r.applied_at ? `  (${new Date(r.applied_at).toISOString()})` : '  (pending)'}`);
      }
    } else {
      await runMigrations();
    }
    await pool.end();
  })().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
