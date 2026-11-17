import { TRAFFIC_RADIUS, type OrganizationSettings } from '@fastighetsradar/domain';
import type { Queryable } from './migrations';

export async function getOrganizationSettings(db: Queryable, organizationId: string): Promise<OrganizationSettings> {
  const { rows } = await db.query<{ traffic_radius_m: number }>('SELECT traffic_radius_m FROM organizations WHERE id = $1', [organizationId]);
  return { trafficRadiusM: rows[0] ? Number(rows[0].traffic_radius_m) : TRAFFIC_RADIUS.default };
}

/**
 * Saves the organization's Trafikverket distance and re-matches its properties' traffic events at
 * once, silently: events that leave the distance did not end and events that come within it are not
 * news, so no feed rows (monitoring_changes) are written. One statement, one snapshot.
 * Events beyond the previous fetch distance arrive with the next Trafikverket run.
 */
export async function saveTrafficRadius(db: Queryable, organizationId: string, radiusM: number): Promise<{ removed: number; added: number }> {
  const { rows } = await db.query<{ removed: string; added: string }>(
    `WITH upd AS (
       UPDATE organizations SET traffic_radius_m = $2 WHERE id = $1 RETURNING id
     ), props AS (
       SELECT p.id, p.organization_id, p.location FROM properties p WHERE p.organization_id = $1 AND p.status <> 'paused'
     ), removed AS (
       DELETE FROM property_event_matches m USING source_events e
        WHERE m.organization_id = $1 AND e.id = m.event_id AND e.source_id IN ('trafikverket', 'sl_deviations')
          AND (m.distance_m IS NULL OR m.distance_m > $2)
       RETURNING 1
     ), added AS (
       INSERT INTO property_event_matches (property_id, event_id, organization_id, match_method, distance_m, matched_version)
       SELECT pr.id, e.id, pr.organization_id, 'within_radius', round(ST_Distance(e.geom::geography, pr.location)::numeric, 0), e.version
         FROM props pr
         JOIN source_events e ON e.status = 'active' AND e.source_id IN ('trafikverket', 'sl_deviations') AND e.geom IS NOT NULL
                             AND ST_DWithin(e.geom::geography, pr.location, $2)
       ON CONFLICT (property_id, event_id) DO NOTHING
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM removed) AS removed, (SELECT count(*) FROM added) AS added, (SELECT count(*) FROM upd) AS updated`,
    [organizationId, radiusM],
  );
  return { removed: Number(rows[0]?.removed ?? 0), added: Number(rows[0]?.added ?? 0) };
}
