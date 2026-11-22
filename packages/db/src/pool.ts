import pg from 'pg';

/**
 * Session settings for the application's connections. JIT off: the app runs many short queries, and
 * PostgreSQL's JIT compiled the nearest-station lookup on every portfolio build from a few dozen
 * properties – ~100 ms of a ~137 ms query at 500 properties (docs/plans/skalning.md, Fas 3 steg 3).
 */
export const SESSION_OPTIONS = '-c jit=off';

/** Creates a pg pool. Callers own its lifecycle (`await pool.end()`). */
export function createPool(databaseUrl: string, options: Partial<pg.PoolConfig> = {}): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    application_name: 'fastighetsradar',
    options: SESSION_OPTIONS,
    ...options,
  });
}

export interface DbReadiness {
  status: 'ok' | 'error';
  postgis: string | null;
  detail?: string;
}

/** Checks connectivity and PostGIS availability (used by /health/ready). */
export async function checkDatabase(pool: pg.Pool): Promise<DbReadiness> {
  try {
    await pool.query('SELECT 1');
    try {
      const { rows } = await pool.query<{ v: string }>('SELECT postgis_lib_version() AS v');
      return { status: 'ok', postgis: rows[0]?.v ?? null };
    } catch {
      return { status: 'error', postgis: null, detail: 'Connected, but PostGIS extension is not installed – run migrations' };
    }
  } catch {
    return { status: 'error', postgis: null, detail: 'Database unreachable' };
  }
}
