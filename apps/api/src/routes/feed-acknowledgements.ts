import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { acknowledgeFeedChange, markFeedUpdateRead, unacknowledgeFeedChange, type Queryable } from '@fastighetsradar/db';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import { createRateLimiter } from '../rate-limit';

/** Feed row ids as the feed shows them ("chg-123") or bare ("123"). */
const ChangeId = z.string().regex(/^(chg-)?\d{1,18}$/, 'Ogiltig rad').transform((s) => s.replace(/^chg-/, ''));
const AckBody = z.object({ changeId: ChangeId, acknowledged: z.boolean() });
const ReadBody = z.object({ changeId: ChangeId });

interface Deps {
  db: Queryable | null;
  requireOrg: preHandlerHookHandler;
}

/**
 * "Kvittera" for serious rows in the feed (Händelseflöde). Any member of the organization may
 * acknowledge; the acknowledgement is shared by the organization and records who and when.
 */
export function registerFeedAcknowledgementRoutes(app: FastifyInstance, deps: Deps) {
  const db = () => {
    if (!deps.db) throw new HttpProblem(503, 'Database unavailable');
    return deps.db;
  };
  const writes = createRateLimiter({ capacity: 60, refillPerSecond: 1 });
  const reads = createRateLimiter({ capacity: 60, refillPerSecond: 1 });

  app.post('/v1/feed/reads', { preHandler: deps.requireOrg }, async (req, reply) => {
    const ctx = orgContext(req);
    if (!reads.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { changeId } = ReadBody.parse(req.body);
    await markFeedUpdateRead(db(), ctx.organizationId, changeId, ctx.userId);
    return reply.code(204).send();
  });

  app.post('/v1/feed/acknowledgements', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (!writes.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { changeId, acknowledged } = AckBody.parse(req.body);
    if (!acknowledged) {
      await unacknowledgeFeedChange(db(), ctx.organizationId, changeId);
      return { changeId: `chg-${changeId}`, at: null };
    }
    const at = await acknowledgeFeedChange(db(), ctx.organizationId, changeId, ctx.userId);
    if (!at) throw new HttpProblem(404, 'Händelsen finns inte i flödet');
    return { changeId: `chg-${changeId}`, at: at.toISOString() };
  });
}
