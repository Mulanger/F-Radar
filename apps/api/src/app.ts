import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerEnv } from '@fastighetsradar/config';
import type { Queryable } from '@fastighetsradar/db';
import { geoapifyAdapter, type GeocodingProvider } from '@fastighetsradar/integrations';
import { registerErrorHandling } from './errors';
import { registerHealthRoutes, type ReadinessProbe } from './routes/health';
import { registerMonitoringRoutes } from './routes/monitoring';
import { MonitoringBus } from './monitoring/bus';
import { MonitoringService } from './monitoring/service';
import { registerCustomerRoutes } from './routes/customer';
import { createClerkVerifier, registerAuth, type AuthVerifier } from './auth';
import { loggerOptions } from './logger';
import { registerNotificationRoutes } from './routes/notifications';
import type { PhoneVerificationProvider } from './notifications/verification';

export interface AppDeps {
  verification?: PhoneVerificationProvider;
  /** Optional dependency probes (database, redis …). Missing probes are reported as `skipped`. */
  probes?: Record<string, ReadinessProbe>;
  /** Probes whose failure makes /health/ready return 503. */
  criticalProbes?: string[];
  /** Override logging (tests pass `false`). */
  logger?: boolean;
  /** Database used by customer routes. */
  db?: Queryable | null;
  /** Session verifier; defaults to Clerk when keys are configured. Tests inject a fake. */
  verifyAuth?: AuthVerifier | null;
  geocoder?: GeocodingProvider;
  fetch?: typeof fetch;
  /** Monitoring read service + live bus (defaults to one built on `db`). */
  monitoring?: MonitoringService | null;
}

export const API_VERSION = process.env.npm_package_version ?? '0.2.0';

export async function buildApp(env: ServerEnv, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger === false ? false : loggerOptions(env),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    },
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('cache-control', 'no-store');
  });

  registerErrorHandling(app);
  registerHealthRoutes(app, { version: API_VERSION, probes: deps.probes ?? {}, critical: deps.criticalProbes });

  const verify = deps.verifyAuth !== undefined ? deps.verifyAuth : createClerkVerifier(env);
  const { requireUser, requireOrg } = registerAuth(app, { verify, db: deps.db ?? null });
  const monitoring = deps.monitoring !== undefined ? deps.monitoring : deps.db ? new MonitoringService(deps.db, env, new MonitoringBus()) : null;
  registerCustomerRoutes(app, {
    env,
    db: deps.db ?? null,
    geocoder: deps.geocoder ?? geoapifyAdapter,
    fetch: deps.fetch ?? fetch,
    requireUser,
    requireOrg,
    monitoring,
  });
  registerMonitoringRoutes(app, { env, service: monitoring, requireUser, requireOrg });
  registerNotificationRoutes(app, { env, db: deps.db ?? null, requireOrg, verification: deps.verification });

  return app;
}
