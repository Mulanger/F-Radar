import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Queryable } from '@fastighetsradar/db';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import { createRateLimiter } from '../rate-limit';

/** Acknowledgements are kept a week: upcoming rows only reach 48 h ahead. */
const RETENTION = "interval '7 days'";
const Key = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/, 'Ogiltig nyckel');
const AckBody = z.object({ key: Key, acknowledged: z.boolean() });

interface Deps {
  db: Queryable | null;
  requireOrg: preHandlerHookHandler;
}

/**
 * "Kvittera" for upcoming conditions. Any member of the organization may acknowledge; the
 * acknowledgement is shared by the organization (it records who and when).
 */
export function registerUpcomingRoutes(app: FastifyInstance, deps: Deps) {
  const db = () => {
    if (!deps.db) throw new HttpProblem(503, 'Database unavailable');
    return deps.db;
  };
  const writes = createRateLimiter({ capacity: 60, refillPerSecond: 1 });

  app.get('/v1/upcoming/acknowledgements', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    const { rows } = await db().query<{ item_key: string; acknowledged_at: Date }>(
      `SELECT item_key, acknowledged_at FROM upcoming_acknowledgements
        WHERE organization_id = $1 AND acknowledged_at > now() - ${RETENTION}`,
      [ctx.organizationId],
    );
    return { acknowledgements: rows.map((r) => ({ key: r.item_key, at: r.acknowledged_at.toISOString() })) };
  });

  app.post('/v1/upcoming/acknowledgements', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (!writes.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { key, acknowledged } = AckBody.parse(req.body);
    if (!acknowledged) {
      await db().query('DELETE FROM upcoming_acknowledgements WHERE organization_id = $1 AND item_key = $2', [ctx.organizationId, key]);
      return { key, at: null };
    }
    await db().query(`DELETE FROM upcoming_acknowledgements WHERE organization_id = $1 AND acknowledged_at < now() - ${RETENTION}`, [ctx.organizationId]);
    const { rows } = await db().query<{ acknowledged_at: Date }>(
      `INSERT INTO upcoming_acknowledgements (organization_id, item_key, acknowledged_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, item_key) DO UPDATE SET item_key = EXCLUDED.item_key
       RETURNING acknowledged_at`,
      [ctx.organizationId, key, ctx.userId],
    );
    return { key, at: rows[0]!.acknowledged_at.toISOString() };
  });
}
