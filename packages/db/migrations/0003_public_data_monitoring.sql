-- 0003_public_data_monitoring.sql – Phase 3 (Agent 3): public-data ingestion & monitoring.
--
-- Additive only: no existing table or column is dropped or rewritten.
-- Storage model: CURRENT snapshots + short history, enforced by the `retention` job
-- (see docs/sources.md → Retention). All geometries are WGS84 (EPSG:4326, lon/lat).
--
-- Data classes (packages/domain/src/monitoring.ts):
--   FORECAST · OBSERVATION · OFFICIAL_WARNING · PUBLIC_EVENT · STATIC_GEODATA · REGIONAL_STATISTIC

-- 1) Every source referenced by runs/rules must exist in the catalog (FK target).
INSERT INTO source_catalog (id, attribution) VALUES
  ('smhi_forecast', 'Källa: SMHI'),
  ('smhi_warnings', 'Källa: SMHI'),
  ('smhi_observations', 'Källa: SMHI'),
  ('smhi_oceanography', 'Källa: SMHI'),
  ('krisinformation', 'Källa: Krisinformation.se'),
  ('air_quality', 'Källa: SMHI / Naturvårdsverket'),
  ('sgu_groundwater', 'Källa: SGU'),
  ('mcf_flood', 'Källa: MCF Översvämningsportalen'),
  ('scb', 'Källa: SCB'),
  ('trafikverket', 'Källa: Trafikverket'),
  ('geoapify_geocoding', 'Powered by Geoapify'),
  ('lantmateriet_address', 'Källa: Lantmäteriet'),
  ('boverket_energy', 'Källa: Boverket'),
  ('sms_46elks', '')
ON CONFLICT (id) DO NOTHING;

-- 2) Scheduled collection jobs. One row per job; leasing makes runs exclusive across
--    processes/restarts (UPDATE … WHERE lease expired RETURNING). No Redis needed.
CREATE TABLE provider_jobs (
  job_id               text PRIMARY KEY,
  source_id            text REFERENCES source_catalog(id),   -- NULL for system jobs (retention)
  interval_seconds     integer NOT NULL CHECK (interval_seconds >= 30),
  enabled              boolean NOT NULL DEFAULT true,
  next_run_at          timestamptz NOT NULL DEFAULT now(),
  lease_owner          text,
  lease_until          timestamptz,
  last_started_at      timestamptz,
  last_finished_at     timestamptz,
  last_success_at      timestamptz,
  last_status          text CHECK (last_status IN ('ok','partial','error','skipped')),
  last_error_code      text,
  last_error_detail    text,
  last_items           integer,
  last_duration_ms     integer,
  consecutive_failures integer NOT NULL DEFAULT 0,
  source_updated_at    timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_provider_jobs_updated_at BEFORE UPDATE ON provider_jobs FOR EACH ROW EXECUTE FUNCTION fr_set_updated_at();

ALTER TABLE integration_runs ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE integration_runs
  ADD COLUMN job_id      text,
  ADD COLUMN duration_ms integer,
  ADD COLUMN detail      text;
CREATE INDEX idx_integration_runs_job ON integration_runs (job_id, started_at DESC);

-- 3) Reference administrative areas (county polygons) used to assign a property's county.
CREATE TABLE admin_areas (
  id          text PRIMARY KEY,            -- e.g. 'county:01'
  kind        text NOT NULL CHECK (kind IN ('county')),
  code        text NOT NULL,               -- official county code (01 … 25)
  name        text NOT NULL,               -- 'Stockholms län'
  source_id   text NOT NULL REFERENCES source_catalog(id),
  source_ref  text,                        -- upstream area id
  geom        geometry(MultiPolygon, 4326) NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_areas_geom ON admin_areas USING GIST (geom);

-- 4) Centrally collected warnings / public events (one row per upstream object, versioned).
CREATE TABLE source_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         text NOT NULL REFERENCES source_catalog(id),
  external_id       text NOT NULL,
  data_class        text NOT NULL CHECK (data_class IN ('OFFICIAL_WARNING','PUBLIC_EVENT')),
  category          text NOT NULL CHECK (category IN ('Crisis','Traffic','Water','Air','Weather','Info')),
  level             text CHECK (level IN ('Yellow','Orange','Red','VMA','Info')),
  severity          text NOT NULL CHECK (severity IN ('info','monitor','warning','critical','unknown')),
  event_type        text NOT NULL,           -- upstream type/code, unmodified
  headline          text NOT NULL,           -- official headline, unmodified
  description       text,
  area_label        text,
  county_names      text[] NOT NULL DEFAULT '{}',
  geom              geometry(Geometry, 4326),
  published_at      timestamptz,
  source_updated_at timestamptz,
  valid_from        timestamptz,
  valid_to          timestamptz,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  ended_reason      text,
  ended_at          timestamptz,
  version_hash      text NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  source_url        text,
  attribution       text NOT NULL,
  extra             jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);
CREATE INDEX idx_source_events_geom ON source_events USING GIST (geom);
CREATE INDEX idx_source_events_active ON source_events (source_id, status);
CREATE INDEX idx_source_events_counties ON source_events USING GIN (county_names);

-- 5) Property ↔ event matches (computed by PostGIS after each sync; tenant-scoped copy of org id).
CREATE TABLE property_event_matches (
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES source_events(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_method     text NOT NULL CHECK (match_method IN ('polygon_intersection','within_radius','county','municipality')),
  distance_m       numeric,
  first_matched_at timestamptz NOT NULL DEFAULT now(),
  last_matched_at  timestamptz NOT NULL DEFAULT now(),
  matched_version  integer NOT NULL,
  PRIMARY KEY (property_id, event_id)
);
CREATE INDEX idx_property_event_matches_org ON property_event_matches (organization_id);

-- 6) Normalised, de-duplicated change log – the input for the future SMS phase.
--    Nothing here is ever sent: `notified_at` stays NULL until the 46elks phase.
CREATE TABLE monitoring_changes (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_id         uuid REFERENCES source_events(id) ON DELETE SET NULL,
  source_id        text NOT NULL REFERENCES source_catalog(id),
  change_type      text NOT NULL CHECK (change_type IN ('new','updated','ended','cancelled')),
  data_class       text NOT NULL,
  severity         text NOT NULL,
  headline         text NOT NULL,
  dedup_key        text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  notified_at      timestamptz
);
CREATE INDEX idx_monitoring_changes_org ON monitoring_changes (organization_id, created_at DESC);

-- 7) Central station snapshots (MetObs, air quality): latest value per station + parameter.
CREATE TABLE observation_stations (
  source_id    text NOT NULL REFERENCES source_catalog(id),
  station_id   text NOT NULL,
  parameter    text NOT NULL,
  name         text NOT NULL,
  location     geography(Point, 4326) NOT NULL,
  value        double precision,
  unit         text,
  observed_at  timestamptz,
  quality      text,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, station_id, parameter)
);
CREATE INDEX idx_observation_stations_loc ON observation_stations USING GIST (location);
CREATE INDEX idx_observation_stations_param ON observation_stations (source_id, parameter, observed_at DESC);

-- 8) Current point forecast per property (latest SMHI run only; superseded on refresh).
CREATE TABLE property_forecasts (
  property_id      uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id        text NOT NULL REFERENCES source_catalog(id),
  reference_time   timestamptz,               -- model run (SMHI referenceTime)
  created_time     timestamptz,               -- SMHI createdTime
  grid_point       geography(Point, 4326),
  distance_m       numeric,
  series           jsonb NOT NULL,            -- compact arrays, see monitoring/forecast.ts
  fetched_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_property_forecasts_org ON property_forecasts (organization_id);

-- 9) Static geodata / regional statistics / model context per property (MCF, SGU, SCB, county).
CREATE TABLE property_context (
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id        text NOT NULL REFERENCES source_catalog(id),
  context_key      text NOT NULL,
  data_class       text NOT NULL CHECK (data_class IN ('FORECAST','OBSERVATION','STATIC_GEODATA','REGIONAL_STATISTIC')),
  status           text NOT NULL CHECK (status IN ('ok','no_coverage','source_unavailable','not_applicable','unknown')),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_timestamp timestamptz,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  -- Location the context was computed for; a moved pin invalidates it.
  for_location     geography(Point, 4326),
  PRIMARY KEY (property_id, source_id, context_key)
);
CREATE INDEX idx_property_context_org ON property_context (organization_id);
CREATE INDEX idx_property_context_source ON property_context (source_id, fetched_at);
