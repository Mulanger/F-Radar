import { ACKNOWLEDGEMENT_PAGE_SIZE, type AcknowledgementHistoryFilters, type AcknowledgementHistoryPage } from '@fastighetsradar/domain';
import { offeredUtilityEvent, offeredUtilityHeadline } from './utility-visibility';
import type { Queryable } from './migrations';

interface HistoryRow {
  id: string;
  property_id: string;
  property_name: string;
  property_address: string;
  source_id: string;
  operator_name: string | null;
  title: string;
  description: string | null;
  area: string | null;
  severity: string;
  event_at: Date;
  acknowledged_at: Date;
  undone_at: Date | null;
  imported: boolean;
  is_update: boolean;
}

/** The property is in the group NOW (S-20): the report follows today's grouping, not the one at acknowledgement. */
const IN_GROUP = (param: string) =>
  `EXISTS (SELECT 1 FROM property_group_members m WHERE m.organization_id = h.organization_id AND m.group_id = ${param} AND m.property_id = h.property_id)`;

const VISIBLE_HISTORY = `(h.source_id <> 'utility_outages' OR COALESCE((
    SELECT ${offeredUtilityEvent('e')} FROM monitoring_changes c JOIN source_events e ON e.id = c.event_id
    WHERE c.id = h.change_id AND c.organization_id = h.organization_id
  ), ${offeredUtilityHeadline('h.title')}))`;

export async function listAcknowledgementHistory(db: Queryable, organizationId: string, filters: AcknowledgementHistoryFilters) {
  const { rows } = await db.query<HistoryRow>(
    `SELECT h.id, h.property_id, h.property_name, h.property_address, h.source_id, h.operator_name,
            h.title, h.description, h.area, h.severity, h.event_at, h.acknowledged_at, h.undone_at, h.imported, h.is_update
     FROM feed_acknowledgement_history h
     WHERE h.organization_id = $1 AND ${VISIBLE_HISTORY}
       AND ($2::date IS NULL OR h.acknowledged_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Stockholm'))
       AND ($3::date IS NULL OR h.acknowledged_at < (($3::date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm'))
       AND ($4::uuid IS NULL OR h.property_id = $4)
       AND ($7::uuid IS NULL OR ${IN_GROUP('$7')})
       AND ($5::bigint IS NULL OR (h.acknowledged_at, h.id) < (
         SELECT c.acknowledged_at, c.id FROM feed_acknowledgement_history c WHERE c.organization_id = $1 AND c.id = $5
       ))
     ORDER BY h.acknowledged_at DESC, h.id DESC LIMIT $6`,
    [organizationId, filters.from ?? null, filters.to ?? null, filters.property ?? null, filters.cursor ?? null, ACKNOWLEDGEMENT_PAGE_SIZE + 1, filters.group ?? null],
  );
  return {
    entries: rows.slice(0, ACKNOWLEDGEMENT_PAGE_SIZE),
    nextCursor: rows.length > ACKNOWLEDGEMENT_PAGE_SIZE ? rows[ACKNOWLEDGEMENT_PAGE_SIZE - 1]!.id : null,
  };
}

/**
 * The whole selection for the report (Fas 2 / S-08) in one query, newest first, at most `max` rows;
 * `truncated` when more match. Replaces fetching page after page of 30.
 */
export async function listAcknowledgementExport(db: Queryable, organizationId: string, filters: Omit<AcknowledgementHistoryFilters, 'cursor'>, max: number) {
  const { rows } = await db.query<HistoryRow>(
    `SELECT h.id, h.property_id, h.property_name, h.property_address, h.source_id, h.operator_name,
            h.title, h.description, h.area, h.severity, h.event_at, h.acknowledged_at, h.undone_at, h.imported, h.is_update
     FROM feed_acknowledgement_history h
     WHERE h.organization_id = $1 AND ${VISIBLE_HISTORY}
       AND ($2::date IS NULL OR h.acknowledged_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Stockholm'))
       AND ($3::date IS NULL OR h.acknowledged_at < (($3::date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm'))
       AND ($4::uuid IS NULL OR h.property_id = $4)
       AND ($6::uuid IS NULL OR ${IN_GROUP('$6')})
     ORDER BY h.acknowledged_at DESC, h.id DESC LIMIT $5`,
    [organizationId, filters.from ?? null, filters.to ?? null, filters.property ?? null, max + 1, filters.group ?? null],
  );
  return { entries: rows.slice(0, max), truncated: rows.length > max };
}

export async function listAcknowledgementProperties(db: Queryable, organizationId: string) {
  const { rows } = await db.query<AcknowledgementHistoryPage['properties'][number]>(
    `SELECT id, name, address FROM (
       SELECT DISTINCT ON (property_id) property_id AS id, property_name AS name, property_address AS address
       FROM feed_acknowledgement_history h WHERE organization_id = $1 AND ${VISIBLE_HISTORY}
       ORDER BY property_id, acknowledged_at DESC, id DESC
     ) latest ORDER BY name, address, id`,
    [organizationId],
  );
  return rows;
}

/** Undo one archived acknowledgement, even after its feed row expires. */
export async function undoAcknowledgementHistory(db: Queryable, organizationId: string, id: string, userId: string): Promise<Date | null> {
  const { rows } = await db.query<{ undone_at: Date }>(
    `WITH removed AS (
       DELETE FROM feed_acknowledgements a USING feed_acknowledgement_history h
       WHERE h.organization_id = $1 AND h.id = $2::bigint AND h.undone_at IS NULL
         AND a.organization_id = h.organization_id AND a.change_id = h.change_id
         AND a.acknowledged_at = h.acknowledged_at
       RETURNING a.change_id
     )
     UPDATE feed_acknowledgement_history h
     SET undone_at = GREATEST(clock_timestamp(), h.acknowledged_at), undone_by = $3
     WHERE h.organization_id = $1 AND h.id = $2::bigint AND h.undone_at IS NULL
       AND (EXISTS (SELECT 1 FROM removed) OR NOT EXISTS (
         SELECT 1 FROM feed_acknowledgements a WHERE a.organization_id = h.organization_id
           AND a.change_id = h.change_id AND a.acknowledged_at = h.acknowledged_at
       ))
     RETURNING h.undone_at`,
    [organizationId, id, userId],
  );
  if (rows[0]) return rows[0].undone_at;

  // A retry or concurrent undo returns the original undo time without touching a newer acknowledgement.
  const existing = await db.query<{ undone_at: Date | null }>(
    'SELECT undone_at FROM feed_acknowledgement_history WHERE organization_id = $1 AND id = $2::bigint',
    [organizationId, id],
  );
  return existing.rows[0]?.undone_at ?? null;
}
