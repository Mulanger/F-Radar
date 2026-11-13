-- Backfill bookkeeping for station history (docs/decisions/0004-nowcast-och-vattendata.md).
-- One row per station series that the backfill job has tried to complete; it limits retries when
-- SMHI genuinely lacks values, so a station with a real gap is not re-downloaded every run.
CREATE TABLE observation_backfill_checks (
  source_id  text NOT NULL REFERENCES source_catalog(id),
  station_id text NOT NULL,
  parameter  text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  success    boolean NOT NULL,
  PRIMARY KEY (source_id, station_id, parameter)
);
