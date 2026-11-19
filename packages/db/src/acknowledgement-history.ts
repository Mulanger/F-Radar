import { ACKNOWLEDGEMENT_PAGE_SIZE, type AcknowledgementHistoryFilters, type AcknowledgementHistoryPage } from '@fastighetsradar/domain';
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
}

export async function listAcknowledgementHistory(db: Queryable, organizationId: string, filters: AcknowledgementHistoryFilters) {
  const { rows } = await db.query<HistoryRow>(
    `SELECT h.id, h.property_id, h.property_name, h.property_address, h.source_id, h.operator_name,
            h.title, h.description, h.area, h.severity, h.event_at, h.acknowledged_at, h.undone_at, h.imported
     FROM feed_acknowledgement_history h
     WHERE h.organization_id = $1
       AND ($2::date IS NULL OR h.acknowledged_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Stockholm'))
       AND ($3::date IS NULL OR h.acknowledged_at < (($3::date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm'))
       AND ($4::uuid IS NULL OR h.property_id = $4)
       AND ($5::bigint IS NULL OR (h.acknowledged_at, h.id) < (
         SELECT c.acknowledged_at, c.id FROM feed_acknowledgement_history c WHERE c.organization_id = $1 AND c.id = $5
       ))
     ORDER BY h.acknowledged_at DESC, h.id DESC LIMIT $6`,
    [organizationId, filters.from ?? null, filters.to ?? null, filters.property ?? null, filters.cursor ?? null, ACKNOWLEDGEMENT_PAGE_SIZE + 1],
  );
  return {
    entries: rows.slice(0, ACKNOWLEDGEMENT_PAGE_SIZE),
    nextCursor: rows.length > ACKNOWLEDGEMENT_PAGE_SIZE ? rows[ACKNOWLEDGEMENT_PAGE_SIZE - 1]!.id : null,
  };
}

export async function listAcknowledgementProperties(db: Queryable, organizationId: string) {
  const { rows } = await db.query<AcknowledgementHistoryPage['properties'][number]>(
    `SELECT id, name, address FROM (
       SELECT DISTINCT ON (property_id) property_id AS id, property_name AS name, property_address AS address
       FROM feed_acknowledgement_history WHERE organization_id = $1
       ORDER BY property_id, acknowledged_at DESC, id DESC
     ) latest ORDER BY name, address, id`,
    [organizationId],
  );
  return rows;
}
