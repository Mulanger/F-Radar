-- Phase 4: additive notification configuration + bounded activity, reuses alert_rules and monitoring_changes.
ALTER TABLE properties ADD CONSTRAINT uq_properties_org_id UNIQUE (organization_id, id);
ALTER TABLE properties ADD COLUMN notification_link_key text NOT NULL DEFAULT encode(gen_random_bytes(8),'hex') UNIQUE;
ALTER TABLE properties ADD COLUMN sms_notifications_paused boolean NOT NULL DEFAULT false;
ALTER TABLE alert_rules ADD CONSTRAINT uq_alert_rules_org_id UNIQUE (organization_id, id);
ALTER TABLE alert_rules
  ADD COLUMN sms_version integer NOT NULL DEFAULT 0,
  ADD COLUMN name text,
  ADD COLUMN config jsonb,
  ADD COLUMN activated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_change_id bigint NOT NULL DEFAULT 0;

CREATE TABLE sms_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+46[0-9]{7,12}$'),
  consent_at timestamptz,
  verified_at timestamptz,
  verification_expires_at timestamptz,
  verification_method text CHECK (verification_method IN ('otp','fake_test')),
  challenge_hash text,
  challenge_expires_at timestamptz,
  challenge_attempts integer NOT NULL DEFAULT 0 CHECK (challenge_attempts >= 0),
  challenge_requested_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone_e164), UNIQUE (organization_id, id)
);
CREATE TABLE alert_rule_properties (
  organization_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  property_id uuid NOT NULL,
  PRIMARY KEY (organization_id, rule_id, property_id),
  FOREIGN KEY (organization_id, rule_id) REFERENCES alert_rules(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE alert_rule_recipients (
  organization_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  PRIMARY KEY (organization_id, rule_id, recipient_id),
  FOREIGN KEY (organization_id, rule_id) REFERENCES alert_rules(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, recipient_id) REFERENCES sms_recipients(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE alert_evaluation_state (
  organization_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  property_id uuid NOT NULL,
  latched boolean NOT NULL,
  transition bigint NOT NULL DEFAULT 0,
  reference_time timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,rule_id,property_id),
  FOREIGN KEY (organization_id,rule_id) REFERENCES alert_rules(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,property_id) REFERENCES properties(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id uuid,
  recipient_id uuid,
  dedup_key text NOT NULL UNIQUE,
  -- Snapshot names contain no phone number. Full message is removed after completion.
  rule_name text NOT NULL,
  property_names text[] NOT NULL,
  message text,
  parts integer NOT NULL CHECK (parts BETWEEN 0 AND 12),
  estimated_cost_sek numeric,
  status text NOT NULL CHECK (status IN ('queued','processing','retry','simulated','simulated_failure','unknown','failed',
    'suppressed_cooldown','suppressed_quiet_hours','suppressed_limit','suppressed_cost','pending_verification','not_eligible',
    'delivery_disabled','accepted','sent','delivered')),
  provider text NOT NULL DEFAULT 'simulated' CHECK (provider IN ('simulated','46elks')),
  provider_id text UNIQUE,
  is_test boolean NOT NULL DEFAULT false,
  verification_required boolean NOT NULL DEFAULT true,
  simulation_scenario text NOT NULL DEFAULT 'success' CHECK (simulation_scenario IN ('success','failure','timeout','unavailable')),
  detail text,
  trigger_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  eligible_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,rule_id) REFERENCES alert_rules(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,recipient_id) REFERENCES sms_recipients(organization_id,id) ON DELETE CASCADE,
  UNIQUE (organization_id,id)
);
CREATE INDEX idx_notification_activity ON notification_outbox(organization_id,created_at DESC);
CREATE INDEX idx_notification_due ON notification_outbox(next_attempt_at) WHERE status IN ('queued','retry','processing');
CREATE TABLE notification_properties (
  organization_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  property_id uuid NOT NULL,
  PRIMARY KEY(organization_id,notification_id,property_id),
  FOREIGN KEY(organization_id,notification_id) REFERENCES notification_outbox(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,property_id) REFERENCES properties(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE notification_attempts (
  id bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,attempt)
);
-- No personal data or content. Usage survives short activity retention / rule removal.
CREATE TABLE notification_usage (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month date NOT NULL,
  simulated_messages integer NOT NULL DEFAULT 0,
  simulated_parts integer NOT NULL DEFAULT 0,
  estimated_cost_sek numeric NOT NULL DEFAULT 0,
  real_cost_sek numeric NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,month)
);
CREATE TABLE notification_daily_usage (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day date NOT NULL,
  scope_key text NOT NULL,
  messages integer NOT NULL DEFAULT 0,
  estimated_cost_sek numeric NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,day,scope_key)
);
-- Global counters contain no tenant or recipient reference, and survive tenant/rule deletion.
CREATE TABLE notification_global_usage (
  month date PRIMARY KEY,
  messages integer NOT NULL DEFAULT 0,
  parts integer NOT NULL DEFAULT 0,
  estimated_cost_sek numeric NOT NULL DEFAULT 0
);
CREATE TABLE notification_rate_buckets (
  minute timestamptz PRIMARY KEY,
  messages integer NOT NULL DEFAULT 0
);
CREATE TABLE sms_delivery_callbacks (
  notification_id uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('sent','delivered','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id,status)
);
