-- ADR 0005. Independent of source_events' short retention. No stored geometry:
-- the match method/distance records the historical relationship to the address.
CREATE TABLE history_archive_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at timestamptz NOT NULL DEFAULT now(),
  -- Mirrors HISTORY.trafficDistanceM; required by the database capture triggers.
  traffic_distance_m integer NOT NULL DEFAULT 1000
);
INSERT INTO history_archive_state (singleton) VALUES (true);

CREATE TABLE property_event_history (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES source_catalog(id),
  external_id text NOT NULL,
  version integer NOT NULL,
  category text NOT NULL CHECK (category IN ('Weather','Water','VMA','Traffic','CountyInfo')),
  official boolean NOT NULL,
  level text NOT NULL CHECK (level IN ('Yellow','Orange','Red','VMA','Info')),
  event_type text NOT NULL,
  headline text NOT NULL,
  description text,
  area_label text,
  valid_from timestamptz,
  valid_to timestamptz,
  published_at timestamptz,
  changed_at timestamptz NOT NULL,
  ended_at timestamptz,
  matched_until timestamptz,
  match_intervals jsonb NOT NULL DEFAULT '[]'::jsonb,
  end_type text CHECK (end_type IN ('ended','cancelled')),
  match_method text NOT NULL,
  distance_m double precision,
  source_url text,
  attribution text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, source_id, external_id, version)
);
CREATE INDEX property_event_history_org_period_idx
  ON property_event_history (organization_id, property_id, valid_from DESC);
CREATE INDEX property_event_history_retention_idx ON property_event_history (ended_at);

CREATE FUNCTION fr_archive_event(e source_events, m property_event_matches) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE((
    e.source_id = 'smhi_warnings'
    OR e.source_id = 'krisinformation'
    OR (e.source_id = 'trafikverket' AND e.severity IN ('warning','critical')
        AND m.distance_m <= (SELECT traffic_distance_m FROM history_archive_state))
  ), false) THEN RETURN; END IF;

  INSERT INTO property_event_history (
    organization_id, property_id, source_id, external_id, version, category, official,
    level, event_type, headline, description, area_label, valid_from, valid_to,
    published_at, changed_at, ended_at, end_type, match_method, distance_m, source_url, attribution,match_intervals
  ) SELECT p.organization_id, p.id, e.source_id, e.external_id, e.version,
    CASE WHEN e.level = 'VMA' THEN 'VMA'
         WHEN e.source_id = 'krisinformation' THEN 'CountyInfo'
         WHEN e.source_id = 'trafikverket' THEN 'Traffic'
         WHEN e.category = 'Water' THEN 'Water' ELSE 'Weather' END,
    COALESCE((e.source_id = 'smhi_warnings' AND e.level IN ('Yellow','Orange','Red')) OR e.level = 'VMA', false),
    CASE WHEN e.source_id = 'trafikverket' OR (e.source_id = 'krisinformation' AND e.level <> 'VMA')
         THEN 'Info' ELSE COALESCE(e.level, 'Info') END,
    e.event_type, e.headline, e.description, e.area_label, e.valid_from, e.valid_to,
    e.published_at, COALESCE(e.source_updated_at, e.published_at, e.first_seen_at), e.ended_at,
    CASE WHEN e.status IN ('ended','cancelled') THEN e.status END,
    m.match_method, m.distance_m, e.source_url, e.attribution,
    jsonb_build_array(jsonb_build_object('from',COALESCE(e.valid_from,e.published_at,e.first_seen_at),'to',NULL))
  FROM properties p WHERE p.id = m.property_id
  ON CONFLICT (property_id, source_id, external_id, version) DO UPDATE SET
    ended_at = EXCLUDED.ended_at, end_type = EXCLUDED.end_type,
    match_intervals = CASE WHEN property_event_history.matched_until IS NOT NULL AND e.status='active'
      THEN property_event_history.match_intervals || jsonb_build_array(jsonb_build_object('from',now(),'to',NULL))
      ELSE property_event_history.match_intervals END,
    matched_until = CASE WHEN e.status='active' THEN NULL ELSE property_event_history.matched_until END;
END;
$$;

CREATE FUNCTION fr_archive_match_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e source_events;
BEGIN
  SELECT * INTO e FROM source_events WHERE id = NEW.event_id;
  PERFORM fr_archive_event(e, NEW);
  RETURN NEW;
END;
$$;
CREATE TRIGGER history_capture_match AFTER INSERT OR UPDATE ON property_event_matches
  FOR EACH ROW EXECUTE FUNCTION fr_archive_match_trigger();

-- A changed polygon or moved address can stop matching while the source event continues elsewhere.
-- Preserve official validity separately from the end of this property's match.
CREATE FUNCTION fr_archive_unmatch_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM source_events WHERE id=OLD.event_id AND status='active')
     AND EXISTS(SELECT 1 FROM properties WHERE id=OLD.property_id AND status <> 'paused') THEN
    UPDATE property_event_history h SET matched_until=now(),
      match_intervals=jsonb_set(h.match_intervals,ARRAY[(jsonb_array_length(h.match_intervals)-1)::text,'to'],to_jsonb(now()))
    FROM source_events e WHERE e.id=OLD.event_id AND h.property_id=OLD.property_id
      AND h.source_id=e.source_id AND h.external_id=e.external_id AND h.matched_until IS NULL;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER history_capture_unmatch AFTER DELETE ON property_event_matches
  FOR EACH ROW EXECUTE FUNCTION fr_archive_unmatch_trigger();

-- A source closure can happen before rematching removes the current match.
-- Close all earlier versions too, and capture any final cancellation text/version.
CREATE FUNCTION fr_archive_end_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m property_event_matches;
BEGIN
  IF NEW.status IN ('ended','cancelled') THEN
    FOR m IN SELECT * FROM property_event_matches WHERE event_id = NEW.id LOOP
      PERFORM fr_archive_event(NEW, m);
    END LOOP;
    UPDATE property_event_history SET ended_at = NEW.ended_at, end_type = NEW.status
      WHERE source_id = NEW.source_id AND external_id = NEW.external_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER history_capture_end AFTER UPDATE ON source_events
  FOR EACH ROW WHEN (NEW.status <> 'active') EXECUTE FUNCTION fr_archive_end_trigger();

-- One-time seed. Older versions removed before this migration cannot be reconstructed.
DO $$
DECLARE m property_event_matches; e source_events;
BEGIN
  FOR m IN SELECT * FROM property_event_matches LOOP
    SELECT * INTO e FROM source_events WHERE id = m.event_id;
    PERFORM fr_archive_event(e, m);
  END LOOP;
END;
$$;

CREATE TABLE history_stations (
  source_id text NOT NULL REFERENCES source_catalog(id),
  station_id text NOT NULL,
  parameter text NOT NULL,
  name text NOT NULL,
  location geography(Point,4326) NOT NULL,
  available_from timestamptz,
  available_to timestamptz,
  catalog_checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, station_id, parameter)
);
CREATE INDEX history_stations_location_idx ON history_stations USING gist(location);

CREATE TABLE station_daily (
  source_id text NOT NULL,
  station_id text NOT NULL,
  parameter text NOT NULL,
  day_definition text NOT NULL,
  date date NOT NULL,
  value double precision,
  min double precision,
  max double precision,
  coverage double precision NOT NULL CHECK (coverage BETWEEN 0 AND 1),
  origin text NOT NULL CHECK (origin IN ('smhi_archive','own_aggregate')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, station_id, parameter, day_definition, date)
);
CREATE INDEX station_daily_date_idx ON station_daily(date);

CREATE TABLE history_backfill_checks (
  source_id text NOT NULL,
  station_id text NOT NULL,
  parameter text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  archive_fetched_at timestamptz,
  success boolean NOT NULL,
  PRIMARY KEY (source_id, station_id, parameter)
);
CREATE TABLE station_precipitation_normals (
  source_id text NOT NULL DEFAULT 'smhi_observations',
  station_id text NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  value double precision NOT NULL CHECK (value >= 0),
  years integer NOT NULL CHECK (years >= 24),
  period_from integer NOT NULL DEFAULT 1991,
  period_to integer NOT NULL DEFAULT 2020,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id, station_id, month)
);
CREATE TABLE history_normal_checks (
  station_id text PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL
);

-- Daily-flow references have a different sampling basis from the current panel's 15-min series.
CREATE TABLE history_flow_references (
  station_id text NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  p75 double precision NOT NULL,
  p95 double precision NOT NULL,
  samples integer NOT NULL,
  years integer NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(station_id,month)
);
