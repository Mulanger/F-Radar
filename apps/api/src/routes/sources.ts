import type { FastifyInstance } from 'fastify';
import type { ServerEnv } from '@fastighetsradar/config';
import { resolveSmsMode } from '@fastighetsradar/config';
import { resolveSourceStatuses } from '@fastighetsradar/integrations';

/**
 * GET /v1/sources/status – configuration status of every source.
 * Computed from env + manifest only; no external API is called. No secrets are returned.
 * TODO(Agent 2): add auth + tenant scoping, merge collector run health from `integration_runs`.
 */
export function registerSourceRoutes(app: FastifyInstance, env: ServerEnv) {
  app.get('/v1/sources/status', async () => ({
    generatedAt: new Date().toISOString(),
    smsMode: resolveSmsMode(env),
    sources: resolveSourceStatuses(env),
  }));
}
