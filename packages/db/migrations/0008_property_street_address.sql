-- 0008_property_street_address.sql – strömavbrott Fas 4 (docs/plans/stromavbrott.md §5.6).
--
-- Some operators publish planned district-heating/cooling work as street addresses only
-- (Göteborg Energi). Matching needs the property's street and house number as given by the
-- geocoder. New properties get them from the chosen Geoapify suggestion; existing ones are
-- back-filled conservatively from the geocoder label ("Gata 12B, 123 45 Ort, Sverige") and left
-- NULL whenever the label does not have exactly that shape.
ALTER TABLE properties ADD COLUMN street text, ADD COLUMN housenumber text;

UPDATE properties p
   SET street = m.parts[1], housenumber = upper(regexp_replace(m.parts[2], '\s', '', 'g'))
  FROM (
    SELECT id, regexp_match(geocode_label, '^\s*([^,0-9]*[^,0-9\s])\s+(\d{1,4}\s?[A-Za-z]?)\s*,') AS parts
      FROM properties
     WHERE geocode_provider = 'geoapify' AND geocode_label IS NOT NULL
  ) m
 WHERE p.id = m.id AND m.parts IS NOT NULL AND p.street IS NULL;
