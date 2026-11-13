INSERT INTO source_catalog (id, attribution) VALUES
  ('met_nowcast', 'Data från MET Norway · bearbetad av FastighetsRadar (CC BY 4.0)'),
  ('smhi_hydrology', 'Källa: SMHI')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE nowcast_points (
  point_key text PRIMARY KEY,
  location geography(Point, 4326) NOT NULL,
  radar_coverage text NOT NULL CHECK (radar_coverage IN ('ok', 'temporarily unavailable', 'no coverage')),
  series jsonb NOT NULL,
  source_updated_at timestamptz,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_modified text
);
CREATE INDEX nowcast_points_location_idx ON nowcast_points USING gist(location);

CREATE TABLE hydrology_references (
  source_id text NOT NULL REFERENCES source_catalog(id), station_id text NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12), p75 double precision NOT NULL, p95 double precision NOT NULL,
  samples integer NOT NULL, years integer NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,station_id,month)
);
CREATE TABLE hydrology_reference_checks (
  station_id text PRIMARY KEY, checked_at timestamptz NOT NULL DEFAULT now(), success boolean NOT NULL
);
