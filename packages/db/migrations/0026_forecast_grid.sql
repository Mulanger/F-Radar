-- Only new tables and indexes. Legacy property_forecasts remain the read fallback during rollout.
SET LOCAL lock_timeout = '5s';

CREATE TABLE forecast_grid_points (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  reference_time timestamptz,
  created_time timestamptz,
  series jsonb,
  fetched_at timestamptz,
  UNIQUE (lat, lon),
  CHECK ((series IS NULL) = (fetched_at IS NULL))
);
CREATE INDEX idx_forecast_grid_due ON forecast_grid_points (fetched_at NULLS FIRST, id);

CREATE TABLE property_forecast_links (
  property_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  point_id bigint REFERENCES forecast_grid_points(id),
  for_location geography(Point, 4326) NOT NULL,
  distance_m numeric,
  FOREIGN KEY (organization_id, property_id) REFERENCES properties (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_property_forecast_links_org ON property_forecast_links (organization_id, property_id);
CREATE INDEX idx_property_forecast_links_point ON property_forecast_links (point_id);
