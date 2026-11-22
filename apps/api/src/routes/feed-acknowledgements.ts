import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { FEED_ACK_BATCH_MAX, acknowledgeFeedChange, acknowledgeFeedChanges, unacknowledgeFeedChanges, listAcknowledgementExport, listAcknowledgementHistory, listAcknowledgementProperties, markAlarmChangesRead, markFeedUpdateRead, unacknowledgeFeedChange, undoAcknowledgementHistory, type Queryable } from '@fastighetsradar/db';
import { ACKNOWLEDGEMENT_EXPORT_MAX, type AcknowledgementExport, type AcknowledgementHistoryEntry, type AcknowledgementHistoryPage } from '@fastighetsradar/domain';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { SOURCE_LABEL } from '../monitoring/snapshot';

/** Feed row ids as the feed shows them ("chg-123") or bare ("123"). */
const ChangeId = z.string().regex(/^(chg-)?\d{1,18}$/, 'Ogiltig rad').transform((s) => s.replace(/^chg-/, ''));
const AckBody = z.object({ changeId: ChangeId, acknowledged: z.boolean() });
const AckBatchBody = z.object({ changeIds: z.array(ChangeId).min(1).max(FEED_ACK_BATCH_MAX), acknowledged: z.boolean() });
const ReadBody = z.object({ changeId: ChangeId });
const AlarmReadsBody = z.object({ changeIds: z.array(ChangeId).min(1).max(500) });
const HistoryId = z.string().regex(/^[1-9]\d{0,17}$/);
const HistoryFilters = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  property: z.uuid().optional(),
  cursor: HistoryId.optional(),
}).refine(({ from, to }) => !from || !to || from <= to, 'Startdatum måste vara före eller samma som slutdatum');

type HistoryRow = Awaited<ReturnType<typeof listAcknowledgementHistory>>['entries'][number];

const toEntry = (entry: HistoryRow): AcknowledgementHistoryEntry => ({
  id: entry.id,
  propertyId: entry.property_id,
  propertyName: entry.property_name,
  propertyAddress: entry.property_address,
  source: entry.operator_name ?? SOURCE_LABEL[entry.source_id as keyof typeof SOURCE_LABEL] ?? entry.source_id,
  title: entry.title,
  description: entry.description,
  area: entry.area,
  severity: entry.severity,
  eventAt: entry.event_at.toISOString(),
  acknowledgedAt: entry.acknowledged_at.toISOString(),
  undoneAt: entry.undone_at?.toISOString() ?? null,
  imported: entry.imported,
  isUpdate: entry.is_update,
});

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

  app.get('/v1/feed/acknowledgements', { preHandler: deps.requireOrg }, async (req): Promise<AcknowledgementHistoryPage> => {
    const { organizationId } = orgContext(req);
    const filters = HistoryFilters.parse(req.query);
    const [page, properties] = await Promise.all([
      listAcknowledgementHistory(db(), organizationId, filters),
      filters.cursor ? [] : listAcknowledgementProperties(db(), organizationId),
    ]);
    return { nextCursor: page.nextCursor, properties, entries: page.entries.map(toEntry) };
  });

  // The report (PDF/CSV, docs/plans/skalning.md, Fas 2 / S-08): the whole selection in one call.
  app.get('/v1/feed/acknowledgements/export', { preHandler: deps.requireOrg }, async (req): Promise<AcknowledgementExport> => {
    const { organizationId } = orgContext(req);
    const { from, to, property } = HistoryFilters.parse(req.query);
    const page = await listAcknowledgementExport(db(), organizationId, { from, to, property }, ACKNOWLEDGEMENT_EXPORT_MAX);
    return { entries: page.entries.map(toEntry), truncated: page.truncated };
  });

  app.post('/v1/feed/acknowledgements/:id/undo', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (!writes.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { id } = z.object({ id: HistoryId }).parse(req.params);
    const undoneAt = await undoAcknowledgementHistory(db(), ctx.organizationId, id, ctx.userId);
    if (!undoneAt) throw new HttpProblem(404, 'Kvitteringen finns inte i historiken');
    return { id, undoneAt: undoneAt.toISOString() };
  });

  app.post('/v1/feed/alarm-reads', { preHandler: deps.requireOrg }, async (req, reply) => {
    const ctx = orgContext(req);
    if (!reads.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { changeIds } = AlarmReadsBody.parse(req.body);
    await markAlarmChangesRead(db(), ctx.organizationId, changeIds, ctx.userId);
    return reply.code(204).send();
  });

  app.post('/v1/feed/reads', { preHandler: deps.requireOrg }, async (req, reply) => {
    const ctx = orgContext(req);
    if (!reads.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { changeId } = ReadBody.parse(req.body);
    await markFeedUpdateRead(db(), ctx.organizationId, changeId, ctx.userId);
    return reply.code(204).send();
  });

  // "Kvittera alla" (docs/plans/skalning.md, Fas 2 / S-05): one call, one write token, all rows or none.
  app.post('/v1/feed/acknowledgements/batch', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (!writes.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { changeIds, acknowledged } = AckBatchBody.parse(req.body);
    const ids = [...new Set(changeIds)];
    if (!acknowledged) {
      const undone = new Set(await unacknowledgeFeedChanges(db(), ctx.organizationId, ids, ctx.userId));
      return { changes: ids.filter((id) => undone.has(id)).map((id) => ({ changeId: `chg-${id}`, at: null })) };
    }
    const done = await acknowledgeFeedChanges(db(), ctx.organizationId, ids, ctx.userId);
    if (!done.length) throw new HttpProblem(404, 'Händelsen finns inte i flödet');
    req.log.info({ acknowledged: done.length, requested: ids.length }, 'feed acknowledged in batch');
    return { changes: done.map((r) => ({ changeId: `chg-${r.change_id}`, at: r.acknowledged_at.toISOString() })) };
  });

  app.post('/v1/feed/acknowledgements', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (!writes.take(ctx.userId)) throw new HttpProblem(429, 'För många ändringar. Försök senare.');
    const { changeId, acknowledged } = AckBody.parse(req.body);
    if (!acknowledged) {
      await unacknowledgeFeedChange(db(), ctx.organizationId, changeId, ctx.userId);
      return { changeId: `chg-${changeId}`, at: null };
    }
    const at = await acknowledgeFeedChange(db(), ctx.organizationId, changeId, ctx.userId);
    if (!at) throw new HttpProblem(404, 'Händelsen finns inte i flödet');
    return { changeId: `chg-${changeId}`, at: at.toISOString() };
  });
}
