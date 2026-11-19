-- Keep the acknowledged version after the feed or a property has been removed.
-- The organization is the only cascading reference for archive entries.
CREATE TABLE feed_acknowledgement_history (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  change_id bigint NOT NULL,
  property_id uuid NOT NULL,
  property_name text NOT NULL,
  property_address text NOT NULL,
  source_id text NOT NULL,
  operator_name text,
  title text NOT NULL,
  description text,
  area text,
  severity text NOT NULL,
  event_at timestamptz NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  acknowledged_by text NOT NULL,
  undone_at timestamptz,
  undone_by text,
  imported boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX idx_ack_history_current
  ON feed_acknowledgement_history (organization_id, change_id) WHERE undone_at IS NULL;
CREATE INDEX idx_ack_history_date
  ON feed_acknowledgement_history (organization_id, acknowledged_at DESC, id DESC);
CREATE INDEX idx_ack_history_property
  ON feed_acknowledgement_history (organization_id, property_id, acknowledged_at DESC, id DESC);

-- Hold off acknowledgement writes while backfilling and installing the triggers.
LOCK TABLE feed_acknowledgements IN SHARE ROW EXCLUSIVE MODE;

CREATE VIEW feed_acknowledgement_details AS
SELECT c.organization_id, c.id AS change_id, c.property_id, p.name AS property_name,
       p.address AS property_address, c.source_id, e.extra->>'operatorName' AS operator_name,
       c.headline AS title, COALESCE(NULLIF(e.description, ''), NULLIF(u.cause, '')) AS description,
       COALESCE(NULLIF(e.area_label, ''), u.place_label) AS area, c.severity, c.created_at AS event_at
FROM monitoring_changes c
JOIN properties p ON p.id = c.property_id AND p.organization_id = c.organization_id
LEFT JOIN source_events e ON e.id = c.event_id
LEFT JOIN utility_outages u ON u.event_id = c.event_id;

INSERT INTO feed_acknowledgement_history (
  organization_id, change_id, property_id, property_name, property_address, source_id,
  operator_name, title, description, area, severity, event_at, acknowledged_at, acknowledged_by, imported
)
SELECT d.*, a.acknowledged_at, a.acknowledged_by, true
FROM feed_acknowledgements a
JOIN feed_acknowledgement_details d USING (organization_id, change_id);

CREATE FUNCTION fr_archive_feed_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO feed_acknowledgement_history (
    organization_id, change_id, property_id, property_name, property_address, source_id,
    operator_name, title, description, area, severity, event_at, acknowledged_at, acknowledged_by
  )
  SELECT d.*, NEW.acknowledged_at, NEW.acknowledged_by
  FROM feed_acknowledgement_details d
  WHERE d.organization_id = NEW.organization_id AND d.change_id = NEW.change_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_archive_feed_acknowledgement
  AFTER INSERT ON feed_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION fr_archive_feed_acknowledgement();

-- A previous application release can still undo after the migration. Its delete leaves the feed
-- row in place, unlike retention or a property deletion. The new application already stores the actor.
CREATE FUNCTION fr_archive_legacy_feed_undo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM monitoring_changes WHERE organization_id = OLD.organization_id AND id = OLD.change_id) THEN
    UPDATE feed_acknowledgement_history
    SET undone_at = GREATEST(clock_timestamp(), acknowledged_at)
    WHERE organization_id = OLD.organization_id AND change_id = OLD.change_id
      AND acknowledged_at = OLD.acknowledged_at AND undone_at IS NULL;
  END IF;
  RETURN OLD;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_archive_legacy_feed_undo
  AFTER DELETE ON feed_acknowledgements DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fr_archive_legacy_feed_undo();
