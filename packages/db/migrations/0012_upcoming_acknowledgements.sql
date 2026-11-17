-- 0012_upcoming_acknowledgements.sql – "Kommande förhållanden": kvittering av kommande händelser.
--
-- A member of the organization marks an upcoming condition (forecast threshold or official warning
-- that starts later) as reviewed. Shared by the whole organization. Keys are opaque presentation keys
-- built by the web app (`<row id>@<YYYY-MM-DD>`); rows older than a week are pruned on write.
CREATE TABLE upcoming_acknowledgements (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 200),
  acknowledged_by text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, item_key)
);
