import { EnvValidationError, clerkInstanceType, loadServerEnv } from '@fastighetsradar/config';
import { checkDatabase, createPool } from '@fastighetsradar/db';
import { buildApp } from './app';
import { MonitoringBus } from './monitoring/bus';
import { MonitoringService } from './monitoring/service';
import { MonitoringScheduler } from './monitoring/scheduler';
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

  const bus = new MonitoringBus();
  const monitoring = pool ? new MonitoringService(pool, env, bus) : null;
  const app = await buildApp(env, { probes, db: pool, criticalProbes: pool ? ['database'] : [], monitoring });
  // Collectors run inside this process (Build pod: no separate worker service).
  const scheduler = pool && env.MONITORING_SCHEDULER_ENABLED ? new MonitoringScheduler({ db: pool, env, logger: app.log, bus }) : null;
  app.log.info({ clerk: clerkInstanceType(env), geocoding: env.GEOAPIFY_API_KEY ? 'configured' : 'missing', trafikverket: env.TRAFIKVERKET_API_KEY ? (env.TRAFIKVERKET_ENABLED ? 'enabled' : 'key present, disabled') : 'missing' }, 'configuration');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await scheduler?.stop();
    await app.close();
    await pool?.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  if (scheduler) await scheduler.start().catch((err) => app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'scheduler failed to start'));
  else app.log.info({ reason: pool ? 'MONITORING_SCHEDULER_ENABLED=false' : 'no database' }, 'monitoring scheduler not started');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
