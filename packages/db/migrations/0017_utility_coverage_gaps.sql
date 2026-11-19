-- Coverage gaps after properties are added/moved. No external address data or notifications.
CREATE TABLE utility_coverage_gaps (
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  utility text NOT NULL,
  operator_id text NOT NULL,
  operator_name text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('not_monitored','stale')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (property_id, utility)
);
CREATE INDEX idx_utility_coverage_gaps_org ON utility_coverage_gaps (organization_id, utility) WHERE resolved_at IS NULL;
