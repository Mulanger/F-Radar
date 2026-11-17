-- 0014_outage_restored_inferred.sql – an outage that vanishes from the operator's list is not
-- "Strömmen är tillbaka enligt <nätbolag>" (docs/plans/stromavbrott.md, ändrat 2026-11-17).
--
-- Operators that report restoration themselves (Ellevio, Göteborg Energi, Digpro, Tekniska verken)
-- merge and re-issue tickets: their vanished outages become 'withdrawn' ("visas inte längre"). For
-- operators that only remove outages from the map, removal stays 'restored' but is marked inferred
-- ("troligen tillbaka", never "enligt").
ALTER TABLE utility_outages ADD COLUMN restored_inferred boolean NOT NULL DEFAULT false;

-- Correct outages already ended that way.
UPDATE utility_outages u SET state = 'withdrawn', updated_at = now()
  FROM source_events e
 WHERE e.id = u.event_id AND e.ended_reason = 'missing_from_feed' AND u.state = 'restored'
   AND (u.operator_id IN ('ellevio', 'goteborg_energi', 'tekniskaverken') OR u.operator_id LIKE 'digpro:%');

UPDATE utility_outages u SET restored_inferred = true, updated_at = now()
  FROM source_events e
 WHERE e.id = u.event_id AND e.ended_reason = 'missing_from_feed' AND u.state = 'restored';

-- Their headlines (event and feed rows) said "… är tillbaka enligt <nätbolag>".
WITH fixed AS (
  SELECT e.id,
         CASE
           WHEN u.state = 'withdrawn' AND u.kind = 'planned' THEN
             'Planerat ' || n.noun || ' visas inte längre hos ' || coalesce(e.extra->>'operatorName', 'nätbolaget')
           WHEN u.state = 'withdrawn' THEN
             upper(left(n.noun, 1)) || substr(n.noun, 2) || ' visas inte längre hos ' || coalesce(e.extra->>'operatorName', 'nätbolaget') || ' – inget besked om att det är åtgärdat'
           ELSE
             n.back || ' är troligen tillbaka – avbrottet visas inte längre hos ' || coalesce(e.extra->>'operatorName', 'nätbolaget')
         END AS headline
    FROM source_events e
    JOIN utility_outages u ON u.event_id = e.id
    JOIN (VALUES ('electricity', 'strömavbrott', 'Strömmen'), ('district_heating', 'fjärrvärmeavbrott', 'Fjärrvärmen'),
                 ('district_cooling', 'fjärrkyleavbrott', 'Fjärrkylan'), ('gas', 'gasavbrott', 'Gasleveransen')) AS n(utility, noun, back)
      ON n.utility = u.utility
   WHERE e.ended_reason = 'missing_from_feed' AND (u.state = 'withdrawn' OR u.restored_inferred)
), ev AS (
  UPDATE source_events e SET headline = f.headline FROM fixed f WHERE e.id = f.id RETURNING e.id
)
UPDATE monitoring_changes c SET headline = f.headline
  FROM fixed f
 WHERE c.event_id = f.id AND c.change_type = 'ended';
