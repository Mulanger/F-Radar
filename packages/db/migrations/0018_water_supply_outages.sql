ALTER TABLE utility_outages DROP CONSTRAINT utility_outages_utility_check;
ALTER TABLE utility_outages ADD CONSTRAINT utility_outages_utility_check
  CHECK (utility IN ('electricity','district_heating','district_cooling','gas','water'));
ALTER TABLE utility_outages ADD COLUMN notice_kind text NOT NULL DEFAULT 'outage'
  CHECK (notice_kind IN ('outage','information','boil_water','water_restriction'));
ALTER TABLE utility_outages ADD CONSTRAINT utility_outages_notice_utility_check
  CHECK (notice_kind = 'outage' OR utility = 'water');
ALTER TABLE source_events DROP CONSTRAINT source_events_category_check;
ALTER TABLE source_events ADD CONSTRAINT source_events_category_check
  CHECK (category IN ('Crisis','Traffic','Water','Air','Weather','Info','Power','Heating','WaterSupply'));
