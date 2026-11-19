CREATE TABLE feed_update_reads (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  viewer_id text NOT NULL,
  change_id bigint NOT NULL REFERENCES monitoring_changes(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, viewer_id, change_id)
);

CREATE INDEX idx_feed_update_reads_change ON feed_update_reads (change_id);
