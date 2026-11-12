import { loadServerEnv } from '@fastighetsradar/config';
import { migrateUp, migrationStatus } from './migrations';
import { createPool } from './pool';

// Usage: tsx src/cli.ts <up|status>   (reads DATABASE_URL from env / ../../.env)
async function main() {
  try {
    process.loadEnvFile?.('../../.env');
  } catch {
    /* .env is optional */
  }
  const env = loadServerEnv();
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and start PostGIS with `docker compose up -d`.');
    process.exit(1);
  }
  const pool = createPool(env.DATABASE_URL);
  try {
    const cmd = process.argv[2] ?? 'status';
    if (cmd === 'up') {
      const n = await migrateUp(pool);
      console.log(n ? `Applied ${n} migration(s).` : 'Database is up to date.');
    } else {
      for (const s of await migrationStatus(pool)) console.log(`${s.state.padEnd(18)} ${s.name}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
