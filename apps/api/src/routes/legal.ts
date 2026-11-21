import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { LegalAcceptanceInputSchema, type LegalAcceptanceStatus } from '@fastighetsradar/domain';
import { acceptsCurrentVersions, getLegalAcceptance, recordLegalAcceptance, type LegalAcceptanceRecord, type Queryable } from '@fastighetsradar/db';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { canManageNotifications } from './notifications';

interface Deps {
  db: Queryable | null;
  requireOrg: preHandlerHookHandler;
  now?: () => Date;
}

/** A sign-up time is used only when it is plausible: not in the future and at most 30 days old. */
const MAX_SIGNUP_AGE_MS = 30 * 86_400_000;

export function acceptanceTime(claimed: string | undefined, now: Date): Date {
  if (!claimed) return now;
  const t = new Date(claimed);
  const age = now.getTime() - t.getTime();
  return Number.isFinite(age) && age >= 0 && age <= MAX_SIGNUP_AGE_MS ? t : now;
}

/**
 * Användarvillkor, PUB-avtal and Integritetspolicy acceptance per organization. Every member may
 * read the status; only organization administrators may accept on the organization's behalf.
 */
export function registerLegalRoutes(app: FastifyInstance, deps: Deps) {
  const db = () => {
    if (!deps.db) throw new HttpProblem(503, 'Database unavailable');
    return deps.db;
  };
  const now = deps.now ?? (() => new Date());
  const writes = createRateLimiter({ capacity: 10, refillPerSecond: 0.1 });
  const status = (req: FastifyRequest, record: LegalAcceptanceRecord): LegalAcceptanceStatus => ({
    ...record,
    current: acceptsCurrentVersions(record),
    canAccept: canManageNotifications(req),
  });

  app.get('/v1/legal/acceptance', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    return status(req, await getLegalAcceptance(db(), ctx.organizationId));
  });

  app.post('/v1/legal/acceptance', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (!canManageNotifications(req)) throw new HttpProblem(403, 'Endast organisationsadministratörer kan godkänna villkoren för organisationen');
    if (!writes.take(ctx.userId)) throw new HttpProblem(429, 'För många försök. Försök igen om en stund.');
    const body = LegalAcceptanceInputSchema.safeParse(req.body);
    if (!body.success) throw new HttpProblem(400, 'Villkoren har uppdaterats – ladda om sidan och läs den senaste versionen.');
    const at = acceptanceTime(body.data.acceptedAt, now());
    return status(req, await recordLegalAcceptance(db(), ctx.organizationId, ctx.userId, at));
  });
}
