-- 0002_clerk_tenancy_properties.sql – Phase 2 (Agent 2).
-- Clerk is the identity and membership authority. PostgreSQL stores only
-- application records keyed by Clerk organization IDs.

-- 1) No local user/password store: Clerk owns identities and memberships.
--    These tables were created empty in 0001 and never used.
DROP TABLE IF EXISTS organization_members;
DROP TABLE IF EXISTS users;

-- 2) Organizations reference a Clerk organization (org_…). `name` is an optional display cache.
ALTER TABLE organizations
  ADD COLUMN clerk_org_id text,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now(),
  ALTER COLUMN name DROP NOT NULL;
ALTER TABLE organizations ALTER COLUMN clerk_org_id SET NOT NULL;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_clerk_org_id_format CHECK (clerk_org_id ~ '^org_[A-Za-z0-9]{8,64}$');
CREATE UNIQUE INDEX organizations_clerk_org_id_key ON organizations (clerk_org_id);

-- 3) Properties: geocoding metadata, audit fields and validation.
ALTER TABLE properties
  ADD COLUMN created_by          text,
  ADD COLUMN updated_by          text,
  ADD COLUMN geocode_place_id    text,
  ADD COLUMN geocode_label       text,
  ADD COLUMN geocode_result_type text,
  ADD COLUMN geocoded_location   geography(Point, 4326),
  ADD COLUMN geocoded_at         timestamptz,
  ADD COLUMN postcode            text,
  ADD COLUMN city                text,
  ADD COLUMN position_source     text NOT NULL DEFAULT 'geocoded';

ALTER TABLE properties
  ADD CONSTRAINT properties_position_source_check CHECK (position_source IN ('geocoded', 'manual_adjusted', 'manual_pin')),
  ADD CONSTRAINT properties_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT properties_address_length CHECK (length(btrim(address)) BETWEEN 3 AND 300),
  ADD CONSTRAINT properties_created_by_format CHECK (created_by IS NULL OR created_by ~ '^user_[A-Za-z0-9]+$'),
  -- Confirmed point must lie within a generous WGS84 bounding box for Sweden.
  ADD CONSTRAINT properties_location_in_sweden CHECK (
    ST_Y(location::geometry) BETWEEN 55.0 AND 69.2 AND ST_X(location::geometry) BETWEEN 10.5 AND 24.3
  ),
  ADD CONSTRAINT properties_geocode_confidence_range CHECK (geocode_confidence IS NULL OR geocode_confidence BETWEEN 0 AND 1);

-- Organization-scoped listing in creation order.
CREATE INDEX idx_properties_org_created ON properties (organization_id, created_at, id);

-- 4) Per-property monitoring configuration (SMS stays OFF by default – IMPLEMENTATION.md §15).
CREATE TABLE property_monitoring (
  property_id      uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sms_enabled      boolean NOT NULL DEFAULT false,
  enabled_sources  text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_property_monitoring_org ON property_monitoring (organization_id);

-- 5) updated_at maintenance.
CREATE OR REPLACE FUNCTION fr_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION fr_set_updated_at();
CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION fr_set_updated_at();
CREATE TRIGGER trg_property_monitoring_updated_at BEFORE UPDATE ON property_monitoring FOR EACH ROW EXECUTE FUNCTION fr_set_updated_at();
CREATE TRIGGER trg_alert_rules_updated_at BEFORE UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION fr_set_updated_at();
