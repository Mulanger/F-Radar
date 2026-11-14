-- 0009_utility_outages.sql – grid operators' public outage maps (docs/plans/stromavbrott.md, Fas 1).
--
-- Additive: new source, new data class/categories, a typed 1:1 table for outage fields,
-- grid concession areas (to know when "no registered outages" may be said) and per-match
-- effective severity (an outage is red for a property inside its polygon but never for a
-- property that is only near it).

INSERT INTO source_catalog (id, attribution)
VALUES ('utility_outages', 'Källa: respektive nätbolags avbrottskarta')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE source_events DROP CONSTRAINT source_events_data_class_check;
ALTER TABLE source_events ADD CONSTRAINT source_events_data_class_check
  CHECK (data_class IN ('OFFICIAL_WARNING','PUBLIC_EVENT','UTILITY_OUTAGE'));
ALTER TABLE source_events DROP CONSTRAINT source_events_category_check;
ALTER TABLE source_events ADD CONSTRAINT source_events_category_check
  CHECK (category IN ('Crisis','Traffic','Water','Air','Weather','Info','Power','Heating'));

-- One row per outage event (source_events.source_id = 'utility_outages').
CREATE TABLE utility_outages (
  event_id            uuid PRIMARY KEY REFERENCES source_events(id) ON DELETE CASCADE,
  operator_id         text NOT NULL,
  utility             text NOT NULL CHECK (utility IN ('electricity','district_heating','district_cooling','gas')),
  kind                text NOT NULL CHECK (kind IN ('planned','unplanned','unknown')),
  state               text NOT NULL CHECK (state IN ('upcoming','ongoing','restored','withdrawn','unknown')),
  precision           text NOT NULL CHECK (precision IN ('polygon','point','address_list','postal_area','area')),
  affected_customers  integer CHECK (affected_customers IS NULL OR affected_customers >= 0),
  area_customer_total integer CHECK (area_customer_total IS NULL OR area_customer_total >= 0),
  reported_at         timestamptz,
  planned_start       timestamptz,
  planned_end         timestamptz,
  actual_start        timestamptz,
  estimated_restore   timestamptz,
  restored_at         timestamptz,
  addresses           jsonb,
  postal_codes        text[] NOT NULL DEFAULT '{}',
  municipality_code   text,
  place_label         text,
  operator_text       text,
  cause               text,
  -- Consecutive complete fetches in which the outage was missing (ended after 2).
  missing_polls       integer NOT NULL DEFAULT 0 CHECK (missing_polls >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_utility_outages_operator_state ON utility_outages (operator_id, state);
CREATE INDEX idx_utility_outages_planned_start ON utility_outages (planned_start) WHERE state = 'upcoming';

-- Grid concession areas per operator. Matching never depends on these; they only decide whether
-- the dashboard may say "Inga registrerade avbrott" for a property.
CREATE TABLE grid_concession_areas (
  id           bigserial PRIMARY KEY,
  operator_id  text NOT NULL,
  utility      text NOT NULL DEFAULT 'electricity' CHECK (utility IN ('electricity','district_heating','district_cooling','gas')),
  source       text NOT NULL CHECK (source IN ('operator_feed','national_dataset')),
  external_ref text,
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_grid_concession_areas_geom ON grid_concession_areas USING GIST (geom);
CREATE INDEX idx_grid_concession_areas_operator ON grid_concession_areas (operator_id, utility);

ALTER TABLE property_event_matches DROP CONSTRAINT property_event_matches_match_method_check;
ALTER TABLE property_event_matches ADD CONSTRAINT property_event_matches_match_method_check
  CHECK (match_method IN ('polygon_intersection','within_radius','county','municipality',
    'outage_polygon','outage_address','outage_street','outage_adjacent','outage_point',
    'outage_postal_area','outage_area'));
-- Severity of the event FOR THIS PROPERTY (NULL = use the event's own severity). NULL is also
-- used for outage matches that are shown in the property panel only.
ALTER TABLE property_event_matches ADD COLUMN effective_severity text
  CHECK (effective_severity IS NULL OR effective_severity IN ('info','monitor','warning','critical','unknown'));
