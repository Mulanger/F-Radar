import pg from 'pg';

/** Creates a pg pool. Callers own its lifecycle (`await pool.end()`). */
export function createPool(databaseUrl: string, options: Partial<pg.PoolConfig> = {}): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    application_name: 'fastighetsradar',
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
  } catch (err) {
    return { status: 'error', postgis: null, detail: err instanceof Error ? err.message : 'Database unreachable' };
  }
}
