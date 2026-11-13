INSERT INTO source_catalog (id, attribution) VALUES
  ('met_nowcast', 'Data från MET Norway · bearbetad av FastighetsRadar (CC BY 4.0)')
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
