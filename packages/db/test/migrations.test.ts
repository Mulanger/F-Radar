import { describe, expect, it } from 'vitest';
import { listMigrations, migrateUp, migrationStatus, type Queryable } from '../src/migrations';

/** In-memory fake that records SQL and emulates the schema_migrations table. */
function fakeDb(failOn?: string) {
  const applied = new Map<string, string>();
  const log: string[] = [];
  const db: Queryable = {
    async query<R>(sql: string, params?: unknown[]) {
      log.push(sql.trim().split('\n')[0]!);
      if (failOn && sql.includes(failOn)) throw new Error('boom');
      if (sql.startsWith('SELECT version, checksum')) {
        return { rows: [...applied].map(([version, checksum]) => ({ version, checksum })) as R[] };
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) applied.set(params![0] as string, params![2] as string);
      return { rows: [] as R[] };
    },
  };
  return { db, applied, log };
}

describe('SQL migrations', () => {
  it('are ordered, uniquely versioned and enable PostGIS first', async () => {
    const files = await listMigrations();
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.name).toBe('0001_init.sql');
    expect(files[0]!.sql).toMatch(/CREATE EXTENSION IF NOT EXISTS postgis/);
    expect(files[0]!.sql).toMatch(/geography\(Point, 4326\)/);
    expect(files[0]!.sql).toMatch(/USING GIST \(location\)/);
    // SMS rules must default to OFF (IMPLEMENTATION.md §15)
    expect(files[0]!.sql).toMatch(/enabled\s+boolean NOT NULL DEFAULT false/);
  });

  it('apply pending migrations once inside a transaction', async () => {
    const { db, applied, log } = fakeDb();
    expect(await migrateUp(db, () => {})).toBe((await listMigrations()).length);
    expect(log).toContain('BEGIN');
    expect(log).toContain('COMMIT');
    expect(applied.has('0001')).toBe(true);
    expect(await migrateUp(db, () => {})).toBe(0);
    expect((await migrationStatus(db)).every((s) => s.state === 'applied')).toBe(true);
  });

  it('roll back on failure', async () => {
    const { db, applied, log } = fakeDb('CREATE TABLE organizations');
    await expect(migrateUp(db, () => {})).rejects.toThrow('boom');
    expect(log).toContain('ROLLBACK');
    expect(applied.size).toBe(0);
  });

  it('detect edits to already-applied migrations', async () => {
    const { db, applied } = fakeDb();
    applied.set('0001', 'different-checksum');
    await expect(migrateUp(db, () => {})).rejects.toThrow(/were modified/);
  });
});
