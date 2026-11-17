-- 0015_remove_property_history_capture.sql – the property history page is removed (2026-11-17).
--
-- Stop archiving: these triggers ran on every match change and every ended source event only to
-- feed property_event_history for the history page. The archive tables from 0007 are left in place,
-- untouched, so no stored data is deleted by this migration (they are no longer read or written).
-- station_observation_history (0008) and observation_history are NOT part of this: measured rain,
-- water-level trends and the air quality index still use them.
DROP TRIGGER IF EXISTS history_capture_match ON property_event_matches;
DROP TRIGGER IF EXISTS history_capture_unmatch ON property_event_matches;
DROP TRIGGER IF EXISTS history_capture_end ON source_events;
DROP FUNCTION IF EXISTS fr_archive_match_trigger();
DROP FUNCTION IF EXISTS fr_archive_unmatch_trigger();
DROP FUNCTION IF EXISTS fr_archive_end_trigger();
DROP FUNCTION IF EXISTS fr_archive_event(source_events, property_event_matches);
