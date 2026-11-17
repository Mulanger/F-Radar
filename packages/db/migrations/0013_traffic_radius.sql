-- 0013_traffic_radius.sql – per-organization distance for Trafikverket events (Inställningar).
--
-- Traffic events count for a property within traffic_radius_m (100–3000 m, steps of 100 m).
-- New and existing organizations start at 500 m (previously a fixed 2 km for everyone).
ALTER TABLE organizations
  ADD COLUMN traffic_radius_m integer NOT NULL DEFAULT 500
    CHECK (traffic_radius_m BETWEEN 100 AND 3000 AND traffic_radius_m % 100 = 0);

-- Drop traffic matches outside the new radius silently: the events did not end, they are simply no
-- longer within the organization's distance, so no "Avslutad" feed rows may be written for them.
DELETE FROM property_event_matches m
 USING source_events e, organizations o
 WHERE e.id = m.event_id
   AND o.id = m.organization_id
   AND e.source_id IN ('trafikverket', 'sl_deviations')
   AND (m.distance_m IS NULL OR m.distance_m > o.traffic_radius_m);
