-- Acceptance of Användarvillkor (incl. PUB-avtal) and Integritetspolicy per organization: which
-- version, when, and by which Clerk user. Set when an organization administrator has accepted the
-- versions in force (at sign-up, copied over once the organization exists, or in the dashboard).
ALTER TABLE organizations
  ADD COLUMN terms_version text,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN privacy_version text,
  ADD COLUMN privacy_accepted_at timestamptz,
  ADD COLUMN legal_accepted_by_user_id text;

ALTER TABLE organizations ADD CONSTRAINT organizations_legal_acceptance_complete CHECK (
  (terms_version IS NULL AND terms_accepted_at IS NULL AND privacy_version IS NULL AND privacy_accepted_at IS NULL AND legal_accepted_by_user_id IS NULL)
  OR (terms_version IS NOT NULL AND terms_accepted_at IS NOT NULL AND privacy_version IS NOT NULL AND privacy_accepted_at IS NOT NULL
      AND legal_accepted_by_user_id ~ '^user_[A-Za-z0-9]+$')
);
