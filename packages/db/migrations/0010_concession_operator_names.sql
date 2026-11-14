-- 0010_concession_operator_names.sql – strömavbrott Fas 2 (docs/plans/stromavbrott.md).
--
-- National concession areas (Energimarknadsinspektionen, CC0) cover every grid operator, also those we
-- do not collect outages from yet. Their display name lets the dashboard say "Nätet (Kraftringen Nät AB)
-- bevakas inte ännu" instead of an anonymous "unknown".
ALTER TABLE grid_concession_areas ADD COLUMN operator_name text;
