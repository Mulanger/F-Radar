import type { FastifyInstance } from 'fastify';
import type { ReadinessResponse } from '@fastighetsradar/domain';

export type ReadinessProbe = () => Promise<{ status: 'ok' | 'degraded' | 'error'; detail?: string }>;

interface HealthOptions {
  version: string;
  probes: Record<string, ReadinessProbe>;
  /** Probes whose failure makes the service not ready (others only degrade it). */
  critical?: string[];
}

const PROBE_TIMEOUT_MS = 2_500;

async function runProbe(probe: ReadinessProbe) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      probe(),
      new Promise<{ status: 'error'; detail: string }>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'error', detail: 'timeout' }), PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    return { status: 'error' as const, detail: err instanceof Error ? err.message : 'probe failed' };
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: FastifyInstance, opts: HealthOptions) {
  /** Liveness: process is up. Never touches dependencies. */
  app.get('/health/live', async () => ({ status: 'ok', version: opts.version, time: new Date().toISOString() }));

  /** Readiness: dependency checks. External data sources are NOT probed here. */
  app.get('/health/ready', async (_req, reply) => {
    const checks: ReadinessResponse['checks'] = {};
    const names = ['database', 'redis', ...Object.keys(opts.probes)].filter((v, i, a) => a.indexOf(v) === i);
    for (const name of names) {
      const probe = opts.probes[name];
      checks[name] = probe ? await runProbe(probe) : { status: 'skipped', detail: 'not configured' };
    }
    const critical = opts.critical ?? [];
    const statuses = Object.entries(checks);
    const notReady = statuses.some(([n, c]) => critical.includes(n) && c.status === 'error');
    // Unconfigured optional dependencies (`skipped`, e.g. Redis before the worker phase) do not degrade readiness.
    const degraded = statuses.some(([, c]) => c.status === 'error' || c.status === 'degraded');
    const body: ReadinessResponse = {
      status: notReady ? 'not_ready' : degraded ? 'degraded' : 'ready',
      version: opts.version,
      time: new Date().toISOString(),
      checks,
    };
    reply.code(notReady ? 503 : 200).send(body);
  });
}
