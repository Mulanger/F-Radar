-- 0001_init.sql – baseline schema (IMPLEMENTATION.md §7).
-- CRS: all geometries are WGS84 (EPSG:4326), lon/lat order. Stored as geography for
-- metre-based distance queries; cast to geometry for polygon operations.
-- Timestamps are timestamptz (UTC); UI converts to Europe/Stockholm.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE properties (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               text NOT NULL,
  address            text NOT NULL,
  area_label         text,
  segment            text,
  municipality       text,
  county_code        text,
  location           geography(Point, 4326) NOT NULL,
  geocode_provider   text NOT NULL CHECK (geocode_provider IN ('geoapify', 'manual_pin', 'lantmateriet')),
  geocode_precision  text NOT NULL CHECK (geocode_precision IN ('building', 'street', 'approximate', 'unknown')),
  geocode_confidence numeric,
  verified_at        timestamptz,
  building_type      text,
  floors             integer CHECK (floors IS NULL OR floors > 0),
  units_label        text,
  status             text NOT NULL DEFAULT 'profiling'
                     CHECK (status IN ('profiling', 'active', 'paused')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_properties_org ON properties (organization_id);
CREATE INDEX idx_properties_location ON properties USING GIST (location);

CREATE TABLE source_catalog (
  id                text PRIMARY KEY,
  license_reviewed  boolean NOT NULL DEFAULT false,
  enabled           boolean NOT NULL DEFAULT false,
  attribution       text NOT NULL DEFAULT '',
  source_updated_at timestamptz,
  last_success_at   timestamptz,
  last_error_at     timestamptz,
  last_error_code   text
);

CREATE TABLE property_source_profiles (
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_id        text NOT NULL REFERENCES source_catalog(id),
  coverage_status  text NOT NULL CHECK (coverage_status IN
                   ('ok','loading','no_coverage','stale','source_unavailable','access_required','not_applicable','unknown')),
  match_method     text NOT NULL CHECK (match_method IN
                   ('point_grid','polygon_intersection','within_radius','nearest_station','county','municipality','not_matched')),
  match_distance_m numeric,
  last_checked_at  timestamptz,
  error_code       text,
  PRIMARY KEY (property_id, source_id)
);

CREATE TABLE alert_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id        uuid REFERENCES properties(id) ON DELETE CASCADE,
  source_id          text NOT NULL REFERENCES source_catalog(id),
  metric_key         text NOT NULL,
  operator           text NOT NULL CHECK (operator IN ('gt','gte','lt','lte','eq','any')),
  threshold          numeric,
  unit               text,
  aggregation_window text,
  channels           text[] NOT NULL DEFAULT ARRAY['sms'],
  -- IMPLEMENTATION.md §15: all SMS rules are OFF by default.
  enabled            boolean NOT NULL DEFAULT false,
  cooldown_minutes   integer NOT NULL DEFAULT 360 CHECK (cooldown_minutes >= 0),
  quiet_hours        jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_rules_org ON alert_rules (organization_id);

CREATE TABLE integration_runs (
  id          bigserial PRIMARY KEY,
  source_id   text NOT NULL REFERENCES source_catalog(id),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL CHECK (status IN ('running','ok','partial','error','skipped')),
  items       integer,
  error_code  text
);
CREATE INDEX idx_integration_runs_source ON integration_runs (source_id, started_at DESC);
