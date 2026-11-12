import { EnvValidationError, clerkInstanceType, loadServerEnv } from '@fastighetsradar/config';
import { checkDatabase, createPool } from '@fastighetsradar/db';
import { buildApp } from './app';
import type { ReadinessProbe } from './routes/health';

async function main() {
  let env;
  try {
    env = loadServerEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      for (const i of err.issues) console.error(`[env] ${i.path}: ${i.message}`);
      process.exit(1);
    }
    throw err;
  }

  const probes: Record<string, ReadinessProbe> = {};
  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
  if (pool) {
    // Avoid crashing on idle client errors (e.g. DB restart).
    pool.on('error', () => undefined);
    probes.database = async () => {
      const r = await checkDatabase(pool);
      return r.status === 'ok' ? { status: 'ok', detail: `postgis ${r.postgis}` } : { status: 'error', detail: r.detail };
    };
  }

  const app = await buildApp(env, { probes, db: pool, criticalProbes: pool ? ['database'] : [] });
  app.log.info({ clerk: clerkInstanceType(env), geocoding: env.GEOAPIFY_API_KEY ? 'configured' : 'missing', trafikverket: env.TRAFIKVERKET_API_KEY ? (env.TRAFIKVERKET_ENABLED ? 'enabled' : 'key present, disabled') : 'missing' }, 'configuration');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await pool?.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
