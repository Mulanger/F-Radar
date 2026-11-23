-- Properties per organization (docs/plans/skalning.md, Fas 6 / S-30). NULL = the platform default
-- (DEFAULT_MAX_PROPERTIES, 1000 since the portfolio list is light enough – Fas 3); a larger customer
-- gets its own limit without a code change.
ALTER TABLE organizations
  ADD COLUMN max_properties integer CHECK (max_properties IS NULL OR max_properties BETWEEN 1 AND 10000);
