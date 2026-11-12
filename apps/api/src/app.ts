import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerEnv } from '@fastighetsradar/config';
import { registerErrorHandling } from './errors';
import { registerHealthRoutes, type ReadinessProbe } from './routes/health';
import { registerSourceRoutes } from './routes/sources';
import { loggerOptions } from './logger';

export interface AppDeps {
  /** Optional dependency probes (database, redis …). Missing probes are reported as `skipped`. */
  probes?: Record<string, ReadinessProbe>;
  /** Override logging (tests pass `false`). */
  logger?: boolean;
}

export const API_VERSION = process.env.npm_package_version ?? '0.1.0';

export async function buildApp(env: ServerEnv, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger === false ? false : loggerOptions(env),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    },
    requestIdHeader: false,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
  });

  registerErrorHandling(app);
  registerHealthRoutes(app, { version: API_VERSION, probes: deps.probes ?? {} });
  registerSourceRoutes(app, env);

  return app;
}
