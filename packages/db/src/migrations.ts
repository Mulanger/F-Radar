import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal forward-only SQL migration runner.
 *
 * Why plain SQL: PostGIS types/indexes (geography, GIST) are first-class here and
 * spatial queries will be written in SQL anyway (IMPLEMENTATION.md §4.1). Each file in
 * `migrations/` runs once inside a transaction; its checksum is recorded so edits to an
 * applied migration are detected instead of silently ignored.
 */

export const MIGRATIONS_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface Queryable {
  query<R = unknown>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export async function listMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    const m = FILE_PATTERN.exec(name);
    if (!m) throw new Error(`Invalid migration file name: ${name} (expected NNNN_snake_case.sql)`);
    const sql = await readFile(join(dir, name), 'utf8');
    files.push({ version: m[1]!, name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  const versions = files.map((f) => f.version);
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate migration version numbers');
  return files;
}

const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  name       text NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export interface MigrationStatus {
  version: string;
  name: string;
  state: 'applied' | 'pending' | 'checksum_mismatch';
}

export async function migrationStatus(db: Queryable, dir = MIGRATIONS_DIR): Promise<MigrationStatus[]> {
  await db.query(BOOKKEEPING);
  const { rows } = await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  return (await listMigrations(dir)).map((f) => ({
    version: f.version,
    name: f.name,
    state: !applied.has(f.version) ? 'pending' : applied.get(f.version) === f.checksum ? 'applied' : 'checksum_mismatch',
  }));
}

export async function migrateUp(db: Queryable, log: (msg: string) => void = console.log, dir = MIGRATIONS_DIR): Promise<number> {
  const status = await migrationStatus(db, dir);
  const mismatched = status.filter((s) => s.state === 'checksum_mismatch');
  if (mismatched.length) {
    throw new Error(`Applied migrations were modified: ${mismatched.map((m) => m.name).join(', ')}. Create a new migration instead.`);
  }
  const files = await listMigrations(dir);
  let count = 0;
  for (const s of status.filter((x) => x.state === 'pending')) {
    const file = files.find((f) => f.version === s.version)!;
    log(`Applying ${file.name}`);
    await db.query('BEGIN');
    try {
      await db.query(file.sql);
      await db.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [file.version, file.name, file.checksum]);
      await db.query('COMMIT');
      count++;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }
  return count;
}
