# Phase 4 — SMS rules and simulated notifications

**Production mode: `Testläge – inga riktiga SMS skickas`.** The worker always constructs
`SimulatedSmsProvider`. No account, credit, subscription, Redis service or SMS credential is needed.
The prepared 46elks adapter additionally refuses every non-dry-run request with `phase4_live_lock`.
Adding credentials cannot enable real delivery. Development Clerk, the hosting plan, DNS and the
existing 3D/water components are unchanged by this phase.

## Base and customer workflow

Base verified: `agent3/public-data-monitoring` at `d38f78e`, clean before Phase 4. Dedicated branch:
`codex/phase4-sms-notifications`. Existing Phase 3 collectors, PostGIS matches, source versions,
`monitoring_changes` and PostgreSQL scheduler remain authoritative.

Open **SMS Rules** (`/sms-rules`), add a Swedish mobile number, register consent, choose recipients,
properties and a category, set conditions/frequency/quiet hours, and save. New rules default off.
Enable explicitly to evaluate future transitions. The page displays configuration, source semantics,
phone status, usage, exact previews and the latest 50 activity records. Saved rules survive refresh.
Property **Configure Alerts** and **Edit rules** open this page with the actual property selected.
Existing property/rule switches persist through the authenticated API. A property switch with no
enabled rules opens configuration; it never silently invents an opted-in rule.

The dashboard retains its existing cards, typography, colors and spacing. No scene, model, shader,
water animation or map provider is replaced. Demo fixture behavior remains isolated under `/demo`.

## Data model and migration

Additive, transactional, checksummed migration `0004_sms_notifications.sql`:

| Storage | Purpose |
|---|---|
| `alert_rules` (extended) | Existing rules table, `sms_version=1`, validated config, name, enabled state, activation timestamp and change cursor |
| `alert_rule_properties` | Explicit saved property scope with composite organization foreign keys |
| `alert_rule_recipients` | Explicit tenant-owned subscriptions |
| `sms_recipients` | E.164 number, consent, verification/challenge metadata; no plaintext OTP |
| `alert_evaluation_state` | Per-rule/property forecast latch, crossing sequence, model reference time |
| `notification_outbox` | Durable eligibility decision, grouped property names, parts/cost estimate, bounded pending text, lease and simulation status |
| `notification_properties` | Constrained property links for grouped alerts and daily controls |
| `notification_attempts` | Minimal outcome and attempt number; no number, body or provider response dump |
| `notification_usage` | Per-organization UTC calendar-month reservations, simulated parts and estimated cost; real cost remains zero |
| `notification_daily_usage` | Organization, property and pseudonymized recipient daily reservations |
| `notification_global_usage` | Monthly aggregate budget reservations with no tenant/phone reference; survives tenant/rule deletion |
| `notification_rate_buckets` | Global minute counters; survives activity/rule deletion |
| `sms_delivery_callbacks` | Idempotent prepared delivery-report records |
| `properties` (extended) | Random short-link key and persisted notification pause flag |

Composite foreign keys prevent attaching another tenant's property or recipient even if application
validation is bypassed. Every customer read/mutation filters the internal organization resolved from
the independently verified Clerk session. Client organization IDs are never trusted. System jobs
intentionally work across organizations and are not exposed as API trigger endpoints.

All timestamps are UTC. Quiet hours use `Intl.DateTimeFormat` with `Europe/Stockholm`, including
both occurrences of the autumn repeated hour and the spring jump. Daily/monthly accounting uses
explicit UTC boundaries, independent of the process timezone.

## Trigger semantics

| Category | Enabled behavior |
|---|---|
| SMHI warnings | Official warning-area ID and Phase 3 polygon match. Selected Yellow/Orange/Red levels, optional material updates and optional ended/cancelled transitions. Phase 3 content hash changes on level, text, validity or geometry, not a new fetch timestamp. |
| SMHI forecast | Existing normalized `property_forecasts.series.steps`. Rain = interval totals pro-rated by the existing SMHI aggregator; wind/gust/upper temperature/RH = maximum over the selected window; lower temperature/RH = minimum. Missing or incomplete windows do not trigger. |
| Krisinformation | Official geographically matched VMA only, at county/municipality/national precision inherited from Phase 3. County news, evergreen features and unclassified categories do not trigger. |
| Trafikverket | Significant (`warning`) nearby events and optional material updates, radius 100–2,000 m. Maximum matches are bounded by Phase 3's 2 km collector/matcher. New events published more than 24 hours ago are ineligible; material updates use the source update time. No accessibility claim. |
| Air / groundwater | Cataloged but disabled until representativeness, averaging period, coverage, units and threshold policy are approved. Regional SGU model never becomes a building measurement. |
| MCF / SCB | Informational only. No recurring static-flood or statistical emergency alerts; optional MCF onboarding SMS is not implemented. |

New/edited/re-enabled rules start at the current tenant change cursor and a new activation time.
Events issued before activation cannot become new alerts merely because a property was added or a
collector first sees them. Automatic event evaluation accepts changes up to 30 minutes old, only the
current source version, and fresh source snapshots (SMHI/traffic 20 min; Krisinformation 40 min).
Expired active events are rejected. Source removal/end notifications are explicit opt-ins.

Forecast rules baseline the first valid snapshot without notifying, even if already beyond the
threshold. Later false-to-true crossings notify once. A latched upper condition rearms only at
`value <= threshold - hysteresis`; a lower condition rearms at `value >= threshold + hysteresis`.
Null/stale data preserve the latch rather than silently rearming. Forecasts older than six hours are
ineligible. Editing a rule intentionally establishes a new baseline.

Preview and manual rule tests use actual saved normalized source records. A manual test can inspect
an existing event without advancing the automatic cursor or forecast latch. It is explicitly marked
`is_test`; when source data are unavailable or conditions are false it records **Not eligible**.
The UI cannot submit arbitrary source values or ask the API to send an arbitrary message. Test
scenario controls affect only the deterministic provider outcome (success/failure/timeout/unavailable).

## Deduplication and atomicity

Each evaluation runs on a dedicated pooled PostgreSQL connection in a transaction. A transaction
advisory lock serializes budget reservations and configuration mutations across processes. Changes,
forecast state, unique outbox insertion and usage reservation commit together. Crashes roll them all
back. Reads never require a gateway call.

Automatic key: organization + recipient + rule + source ID + official external ID + source version /
ended transition. Grouping omits the property from the key and combines affected property names into
one SMS for the recipient. Ungrouped rules include the property. Forecast keys include property and
durable crossing sequence. Each key has a database uniqueness constraint. Rule cursors prevent
replay after short outbox retention; forecast state is retained while its rule/property exists.
Different deliberately configured rules remain independent, subject to recipient/property limits.

Manual tests have a new UUID, never bypass quiet hours, number consent or usage limits, and remain
separate from automatic cooldown history. They still consume simulated reservation quotas.

Property scope choices:

* `selected`: one or multiple explicit existing properties.
* `all_current`: snapshot of current property IDs, frozen on rule toggles; no future inheritance.
* `all_future`: explicit ongoing opt-in for current and subsequently registered properties.

A property-level pause stops its existing subscriptions without modifying a multi-property rule.
Queued grouped messages are discarded if any linked property pauses before processing.

## Phone verification and authorization

`libphonenumber-js` with full metadata validates Swedish **mobile** numbers and normalizes them to
E.164. Landlines, foreign/invalid numbers and text containing an extracted number are rejected.
Responses and logs expose only masked numbers. The full number is available only to the backend
transport and constrained database operations, not in the client bundle or activity response.

Entering a valid number never verifies it. Default `UnavailableVerificationProvider` reports pending
and explains that no code was sent. The interface, ten-minute challenge expiry, one-minute request
throttle, five-attempt limit and 180-day verification lifetime are implemented. Wrong attempts commit
even when verification fails. Phone edits invalidate the challenge and reset verification on change.
Challenge hashes bind recipient ID, phone and code. Successful challenges are consumed.

`FakeVerificationProvider` is injectable only for non-production tests; its constructor and API
registration reject production. Fake evidence is explicitly excluded from real-delivery eligibility.
There is no environment flag or public API for marking numbers verified. OTP delivery remains
unavailable until a real verification provider is implemented/approved.

Clerk currently verifies session identity/organization/role; it does not provide recipient-specific
possession evidence in the existing application contract. Phase 4 deliberately does **not** reuse a
browser-supplied or assumed Clerk phone status. A future policy could reuse a matching server-fetched
Clerk phone only after verifying identity ownership, possession status, age and consent. No user is
assumed to have a verified Clerk phone.

Only verified Clerk `org:admin` members can mutate rules, recipients, property notification switches,
verification or run tests. Other members have masked read-only access. Authentication, active
organization, CSRF/same-origin checks and BFF route allowlisting remain in place. Writes, previews,
tests, verification requests and callbacks are throttled. Durable quotas remain authoritative across
process restarts; request token-bucket throttles are process-local.

## Outbox state machine and recovery

`matching transition → eligibility decision → queued → processing → simulated`

Other terminal evaluation states: `not_eligible`, `pending_verification` (consent missing),
`suppressed_quiet_hours`, `suppressed_cooldown`, `suppressed_limit`, `suppressed_cost`.
Unverified consented recipients may generate **local simulations** with `verification_required=true`;
this is never delivery or verified possession.

`sms_notifications` is a 30-second job in the existing PostgreSQL scheduler. Job leases and per-message
`FOR UPDATE SKIP LOCKED` claims, owner tokens and 60-second leases coordinate workers. The existing
single-job-at-a-time collector scheduler can delay execution during a long collector run; this is not
a guaranteed real-time delivery service.

Before a transport call, the worker rechecks rule/consent/property opt-out, current event version,
event status/freshness/expiry (or current forecast condition), and current quiet hours. A candidate
expires after 30 minutes. Suppressed notifications are terminal and never dumped after quiet hours.
Only explicitly eligible local transient retries retain their pending body.

* Success: `simulated`, not `sent`/`delivered`.
* Simulated rejection: `simulated_failure`, terminal.
* Unavailable: exponential backoff (60 s, 120 s), at most three claims; then `failed`.
* Timeout/network uncertainty: `unknown`, terminal, no blind retry.
* Worker crash: expired **simulator** lease can retry; an expired future provider lease becomes
  `unknown`, not automatically resent. A crash at the final claim becomes failed rather than stuck.
* Attempts use unique notification/attempt numbers and owner-checked completion updates.

Provider faults cannot create actual charges in Phase 4. The current worker rejects non-simulated
transports entirely. Enabling actual delivery requires an additional reviewed implementation release,
not just changing environment flags.

## Encoding, costs and limits

Swedish templates use actual property/source information, source dates, official level/event text
and a random short property URL (`/p/<16 hex chars>`). Links still require authentication and the
right organization; they are not bearer access tokens. No emojis or decorative Unicode are added.
There is no invented weather value, emergency classification or groundwater building measurement.

Part estimation counts GSM-7 extension characters as two septets (160 single / 153 multipart) and
UTF-16 code units including surrogate pairs (70 / 67). Maximum 12 estimated parts per candidate.
The UI displays the exact composed text, part count and estimated cost, or **price not configured**.
Price is configuration, not a permanent assumed tariff. Estimates are conservative; provider dry-run
must validate multipart/currency estimates before any future paid activation.

Backend reservations enforce per-rule cooldown, daily property and recipient caps, daily organization
cap, monthly simulation cap and global minute rate. Grouped alerts reserve each linked property.
Reservations are not released on a failure/unknown outcome, which is conservative. A positive global
estimated-cost cap is also testable in simulation; missing price under such a cap fails closed.
Global cost/rate counters survive activity and rule/tenant deletion. Red/VMA exceptions bypass **only**
quiet hours when explicitly selected, never budget/frequency limits.

Real delivery allowance remains **zero**. Simulation estimates are not charges. Monthly simulated
generation counts include reserved queued/retried/test messages, not only successful simulations.

## Configuration

| Variable | Safe/default meaning |
|---|---|
| `SMS_PROVIDER=simulated` | Deliberate provider selection; worker remains local simulator this phase |
| `SMS_ENABLED=false` | Real delivery disabled; does not disable local simulations |
| `SMS_DRY_RUN=true` | Prepared adapter serializes official `dryrun=yes` |
| `SMS_LIVE_SENDING_APPROVED=false` | Existing explicit owner/administrator approval flag |
| `ELKS_API_USERNAME`, `ELKS_API_PASSWORD` | Empty; server only; never required for simulator |
| `SMS_SENDER=FRadar` | Configurable alphanumeric sender, max 11 chars; not assumed approved |
| `SMS_DAILY_LIMIT_PER_ORG=20` | Durable daily generation reservation limit |
| `SMS_MONTHLY_LIMIT_PER_ORG=0` | Future real-delivery monthly allowance, required positive by live gate |
| `SMS_GLOBAL_DAILY_BUDGET_SEK=0` | Future real-delivery daily spending allowance, required positive by live gate |
| `SMS_MAX_GLOBAL_MONTHLY_COST_SEK=0` | Global real-SMS spending allowance zero; positive value additionally bounds simulation estimates |
| `SMS_SIMULATION_MONTHLY_LIMIT=100` | Separate non-billable generation quota |
| `SMS_MAX_MESSAGES_PER_MINUTE=10` | Global conservative rolling-window reservation rate |
| `SMS_ESTIMATED_PRICE_PER_PART_SEK=` | Empty = unknown estimate, never zero-cost assumption |
| `SMS_WEBHOOK_AUTH_SECRET=` | Empty = reject all callbacks; future credential needs ≥32 random chars |

The deployment script forces simulation, disabled delivery, no administrator approval and zero real
allowances. No Elks credentials are uploaded. Existing `SMS_TEST_ALLOWLIST` remains reserved for a
future staged activation policy, and is not a bypass of this phase's code lock.

## Prepared 46elks adapter and webhook

The adapter includes Basic Auth, URL-encoded UTF-8 form serialization, configurable sender,
`dontlog=message`, `dryrun=yes`, response validation, parts, cost-unit conversion (1/10,000 account
currency), auth/validation/rate/5xx mapping, timeout and uncertain outcome handling. It never calls
46elks without credentials. Its serializer supports `whendelivered`; actual callback wiring belongs
to the separately reviewed live activation release.

Future public callback: `POST /api/sms/delivery` → private `POST /v1/webhooks/46elks`.
Form-urlencoded only, bounded body, validated provider ID/status. Require Basic Auth username
`elks` and configured long secret; compare in constant time. No signature is assumed. No secret is
put in query strings or browser bundles. Callbacks update only `provider='46elks'` rows, acknowledge
duplicates/unknown IDs, and cannot change a simulated record. Sent cannot downgrade a terminal
delivery/failure. The first terminal outcome wins; contradictory terminal reports require future
operator reconciliation rather than silently changing history.

Official references checked 2026-11-13:
[overview](https://46elks.com/docs/overview), [send SMS](https://46elks.com/docs/send-sms),
[delivery reports](https://46elks.com/docs/sms-delivery-reports).
The docs specify Basic Auth, form data, dry-run estimates and retried callbacks. No provider account
or live API request was used to verify contracts; tests inject mocked HTTP responses.

## API surface

All customer endpoints start `/v1/notifications`, require a verified active Clerk organization,
and are exposed only through the same-origin authenticated `/api/app/notifications` BFF:

* `GET /` dashboard; `GET /categories`, `/rules`, `/recipients`, `/activity`, `/usage`.
* `POST /rules`; `PATCH /rules/:id` (full config or enabled flag); `DELETE /rules/:id`.
* `POST /recipients`; `PATCH /recipients/:id`; `DELETE /recipients/:id`.
* `POST /recipients/:id/verification` and `/verification/complete`.
* `POST /rules/:id/preview` and `/rules/:id/test` (persisted source data only).
* `PATCH /properties/:id` notification opt-out; `GET /links/:key` tenant-checked short-link resolution.

There is no customer endpoint accepting arbitrary SMS bodies, numbers or source values for delivery.
The separately authenticated delivery callback is not a send endpoint.

## Privacy, retention and production policy work

* Message text exists only while queued/retrying and is cleared on completion or suppression.
* Activity, attempts, callback metadata and minimal audit: 30 days, latest 50 displayed.
* Daily pseudonymous counters: 32 days; minute buckets: two days.
* Organization/global monthly aggregates: 13 months; global counters contain no recipient or tenant.
* Verification challenge material expires after ten minutes and is cleaned automatically.
* Unused unconsented/unverified recipients without subscriptions: removed after 30 days.
* Consented active recipients/configuration remain until removed or their organization is deleted.
* Tenant deletion cascades personal settings/activity. Global non-identifying counters remain.
* PostgreSQL access is private; full recipient numbers remain plaintext in the constrained database
  because the transport needs them. Application-level field encryption/key rotation is not added.

Before paid production use, the controller must approve purpose/legal basis, privacy and consent
wording/versioning, deletion/export process, hosting/provider processor terms, backup retention,
incident/access policy, and source licensing/alert reuse. Phase 3 manifest licensing approval remains
outstanding; simulation does not constitute approval for commercial SMS redistribution. Have the
appropriate privacy owner review the retention periods and verification lifetime. This is an
engineering inventory, not a legal compliance certification.

## Validation, deployment and limitations

Application **1cd74ae** deployed to `f-radar` on **2026-11-13**. Migration 0004 applied, all 12 jobs
healthy, active service flags confirmed disabled/simulated with zero real allowances. Isolated release
checks: **132 unit/DOM/regression + 21 real PostgreSQL/PostGIS + nine live provider tests passed**;
lint/typecheck/API and Next production builds/secret scan passed. Production dependency audit clean;
seven inherited moderate development-tool audit findings are documented in the root report.

Signed-in browser verified the property-specific Configure Alerts route, actual property selection,
forecast form, pending-phone/test-mode/zero-spend displays, current environmental data, 3D scene and
water canvas; no console errors. One temporary deployment smoke tenant used a real stored normalized
SMHI forecast and an unverified synthetic test number: the actual deployed worker produced
`simulated`, one attempt, cleared text and no real delivery. All temporary tenant records were removed.
Its non-identifying global simulated reservation remains by design. This did not change the owner's
customer rules or phone settings. Unauthenticated API and callback requests returned 401.

Rollback: previous application at `/home/instapod/app.prev`; migration 0004 is additive. Retain its
tables when rolling back the application so rules/outbox data are preserved. No other pod was accessed,
no paid infrastructure/account/credits were added, and Clerk Production/DNS were untouched.

`scripts/notification-smoke.mts` preserves the guarded deployment smoke workflow for engineers.
It requires explicit `PHASE4_DEPLOYMENT_SMOKE=1` and the FastighetsRadar database, creates only a
randomly named isolated smoke tenant, never calls a transport itself, and cleans only its own verified
completed test tenant. Invoke `setup`, then `status <org UUID>`, then `cleanup <org UUID>` using the
existing f-radar-only operations wrapper. It is not a public endpoint or a fixture feed for customers.

See the Phase 4 entry in `IMPLEMENTATION_PROGRESS.md` for final commands/results, deployed commit and
acceptance matrix. Automated suites include server validation, Swedish numbers, threshold hysteresis,
stale/missing data, warning versions/severity, old events, DST quiet hours, auth/roles, encoding,
transport failures, CRUD persistence, tenant composite constraints, grouped/concurrent deduplication,
scope inheritance, quota reservations, restarts/retries, OTP expiry/attempt limits, callbacks and UI.

Known deliberate limits: no real OTP or SMS channel; no reuse of assumed Clerk phone evidence;
no custom public-event category taxonomy; no environmental threshold alerts; no optional MCF
onboarding SMS; no provider account integration test; no source license approval by this work;
no guarantee of sub-minute processing on a collector-busy $7 pod. Real delivery remains code-locked.

Activation must follow [`notifications-activation.md`](notifications-activation.md), separately from
this phase. Do not enable the provider merely because credentials become available.
