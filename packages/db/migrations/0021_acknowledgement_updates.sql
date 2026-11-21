-- Archive whether the member acknowledged an updated version of a feed event.
LOCK TABLE feed_acknowledgements IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE feed_acknowledgement_history ADD COLUMN is_update boolean NOT NULL DEFAULT false;

UPDATE feed_acknowledgement_history h
SET is_update = true
FROM monitoring_changes c
WHERE c.organization_id = h.organization_id AND c.id = h.change_id AND c.change_type = 'updated';

CREATE OR REPLACE FUNCTION fr_archive_feed_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO feed_acknowledgement_history (
    organization_id, change_id, property_id, property_name, property_address, source_id,
    operator_name, title, description, area, severity, event_at, acknowledged_at, acknowledged_by, is_update
  )
  SELECT d.*, NEW.acknowledged_at, NEW.acknowledged_by, c.change_type = 'updated'
  FROM feed_acknowledgement_details d
  JOIN monitoring_changes c ON c.organization_id = d.organization_id AND c.id = d.change_id
  WHERE d.organization_id = NEW.organization_id AND d.change_id = NEW.change_id;
  RETURN NEW;
END;
$$;
