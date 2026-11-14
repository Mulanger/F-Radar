-- Station-based AQ index inputs; never manufacture missing hourly means.
INSERT INTO source_catalog (id, attribution) VALUES
  ('sgu_observed_groundwater', 'Källa: SGU (CC0), observerade grundvattennivåer'),
  ('sl_deviations', 'Källa: SL via Trafiklab')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE station_observation_history (
  source_id text NOT NULL REFERENCES source_catalog(id),
  station_id text NOT NULL,
  parameter text NOT NULL,
  observed_at timestamptz NOT NULL,
  value double precision NOT NULL,
  unit text,
  quality text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, station_id, parameter, observed_at)
);
CREATE INDEX idx_station_history_time ON station_observation_history (observed_at);

ALTER TABLE property_context DROP CONSTRAINT property_context_data_class_check;
ALTER TABLE property_context ADD CONSTRAINT property_context_data_class_check
  CHECK (data_class IN ('FORECAST','MODEL','OBSERVATION','STATIC_GEODATA','REGIONAL_STATISTIC'));
UPDATE property_context SET data_class = 'MODEL' WHERE source_id = 'sgu_groundwater';
