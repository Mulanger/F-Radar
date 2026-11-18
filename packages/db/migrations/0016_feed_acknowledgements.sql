-- 0016_feed_acknowledgements.sql – kvittering i händelseflödet (2026-11-18).
--
-- Acknowledgement moves from "Kommande förhållanden" (forecasts that start later) to the feed:
-- official warnings, VMA, critical events and outages affecting a property must be acknowledged by
-- someone in the organization. One row per acknowledged feed row (monitoring_changes); it goes away
-- with the feed row (30-day retention) through the cascade. Shared by the whole organization.
-- upcoming_acknowledgements (0012) is no longer read or written; it is left untouched here.
CREATE TABLE feed_acknowledgements (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  change_id bigint NOT NULL REFERENCES monitoring_changes(id) ON DELETE CASCADE,
  acknowledged_by text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, change_id)
);
CREATE INDEX idx_feed_acknowledgements_change ON feed_acknowledgements (change_id);

-- Finding later/earlier rows of the same event for a property (superseded rows, covering acknowledgements).
CREATE INDEX IF NOT EXISTS idx_monitoring_changes_event ON monitoring_changes (event_id, property_id) WHERE event_id IS NOT NULL;
