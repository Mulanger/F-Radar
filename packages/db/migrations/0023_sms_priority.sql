-- SMS at large events (docs/plans/skalning.md, Fas 5 / S-23): the queue sends the most urgent first
-- (2 = VMA or red warning, 1 = orange warning or an outage starting, 0 = the rest), and a message
-- over the per-minute rate waits in the queue instead of being dropped.
ALTER TABLE notification_outbox ADD COLUMN priority smallint NOT NULL DEFAULT 0;

CREATE INDEX idx_notification_queue ON notification_outbox (priority DESC, created_at)
  WHERE status IN ('queued', 'retry');
