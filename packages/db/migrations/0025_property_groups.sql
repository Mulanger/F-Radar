-- Property groups the organization creates itself (docs/plans/skalning.md, Fas 4 / S-20): areas,
-- companies or managers. A property may be in several groups; deleting a group keeps its properties.
CREATE TABLE property_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
-- One name per organization, regardless of case ("Innerstad" and "innerstad" are the same group).
CREATE UNIQUE INDEX uq_property_groups_org_name ON property_groups (organization_id, lower(btrim(name)));

-- The composite keys make a membership across organizations impossible, whatever the API sends.
CREATE TABLE property_group_members (
  organization_id uuid NOT NULL,
  group_id uuid NOT NULL,
  property_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, property_id),
  FOREIGN KEY (organization_id, group_id) REFERENCES property_groups (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, property_id) REFERENCES properties (organization_id, id) ON DELETE CASCADE
);
-- A property's groups (the portfolio list) and the cascade when a property is deleted.
CREATE INDEX idx_property_group_members_property ON property_group_members (organization_id, property_id);
