import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { OrganizationSettingsSchema } from '@fastighetsradar/domain';
import { getOrganizationSettings, saveTrafficRadius, type Queryable } from '@fastighetsradar/db';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { canManageNotifications } from './notifications';

interface Deps {
  db: Queryable | null;
  requireOrg: preHandlerHookHandler;
}

/**
 * Inställningar: organization-wide settings. Every member may read them; only organization admins
 * may change them (the same rule as for SMS settings).
 */
export function registerSettingsRoutes(app: FastifyInstance, deps: Deps) {
  const db = () => {
    if (!deps.db) throw new HttpProblem(503, 'Database unavailable');
    return deps.db;
  };
  const writes = createRateLimiter({ capacity: 20, refillPerSecond: 0.2 });

  app.get('/v1/settings', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    return { ...(await getOrganizationSettings(db(), ctx.organizationId)), canEdit: canManageNotifications(req) };
  });

  app.patch('/v1/settings', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (!canManageNotifications(req)) throw new HttpProblem(403, 'Endast organisationsadministratörer får ändra inställningar');
    if (!writes.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const body = OrganizationSettingsSchema.safeParse(req.body);
    if (!body.success) throw new HttpProblem(400, body.error.issues[0]?.message ?? 'Ogiltiga inställningar');
    await saveTrafficRadius(db(), ctx.organizationId, body.data.trafficRadiusM);
    return { ...(await getOrganizationSettings(db(), ctx.organizationId)), canEdit: true };
  });
}
