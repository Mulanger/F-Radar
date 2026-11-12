# ADR 0002 – Authentication, tenancy and deployment (Phase 2)

**Status:** Accepted (Agent 2, 2026-11-12)

## Decisions

### Identity: Clerk (no local password store)
* Clerk is the authority for users, sessions and organization memberships. PostgreSQL stores no
  passwords and no user profiles. The empty `users` / `organization_members` tables from 0001
  were dropped in migration 0002.
* Clerk **Organizations** are the tenant model. Every property belongs to exactly one organization.
  The development instance has Organizations enabled with `force_organization_selection` (no personal
  accounts): a user without an active organization is sent to `/onboarding` (`<OrganizationList hidePersonal>`).
  A "personal workspace" is an organization with a single member.
* Key selection: a complete development pair (`NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY`, `CLERK_SECRET`) takes
  precedence over the standard names (`selectClerkKeys` in `packages/config`, mirrored in
  `apps/web/next.config.ts` and `scripts/deploy-pod.mjs`). The production instance (`clerk.f-radar.se`) is
  not used yet: its DNS does not exist and production keys only work on their own domain.

### Request flow and trust boundary
```
Browser ──(Clerk session cookie, HTTPS)──▶ Next.js (public, 0.0.0.0:3000 behind nginx)
   │  proxy.ts: clerkMiddleware – protects all pages except /sign-in, /sign-up, /onboarding
   │  /api/app/*: allowlisted BFF route, same-origin check for writes, attaches `Authorization: Bearer <session JWT>`
   ▼
Fastify (private, 127.0.0.1:4000)
   │  @clerk/backend authenticateRequest: signature (JWKS / CLERK_JWT_KEY), expiry, azp ∈ CLERK_AUTHORIZED_PARTIES
   │  organization = verified `org_id` claim ONLY (ids in URL/body/headers are ignored)
   │  ensureOrganization(clerk_org_id) → internal uuid; every query filters organization_id
   ▼
PostgreSQL 16 + PostGIS 3.4 (localhost/Unix socket only, peer authentication – no password in config)
```
* Fastify does **not** trust Next.js – a bug or bypass in the web tier still cannot select another tenant.
* Requests without an active organization get **403 `organization-required`** – never an empty list that
  could be mistaken for "no properties".
* Cross-tenant access returns **404** (no existence oracle).

### Data separation
* `/overview`, `/properties/:id` – live customer data from the API only. No fixture fallback.
* `/demo/*` – the approved design with labelled fixtures, for design comparison. Disabled unless
  `FASTIGHETSRADAR_DEMO_ENABLED=true` (false on the pod; the route returns 404).
* Live monitoring fields are explicit "not connected / unknown" until public-data adapters exist.

### Geocoding
* Geoapify autocomplete runs server-side (key never reaches the browser) behind `/api/app/geocoding/suggestions`.
* Client: 350 ms debounce + AbortController per keystroke. Server: per-user token bucket (30 burst, 0.5/s),
  10-minute LRU cache, daily budget guard (2 500 of the free 3 000 credits), one retry with backoff on 5xx/timeouts,
  Retry-After on 429, Sweden-only results, attribution "Powered by Geoapify · © OpenStreetMap contributors".
* The confirmed point is stored separately from the geocoder's point; `position_source` records
  `geocoded` / `manual_adjusted` / `manual_pin`. Stored properties are never re-geocoded on view.

### Deployment (InstaPods `f-radar`, Build plan)
* One systemd unit (`app`, `Restart=on-failure`) runs `deploy/pod/index.js`, a tiny supervisor that starts
  the Next.js standalone server (public) and the bundled Fastify API (private). If either exits, the
  supervisor exits and systemd restarts both. No extra process manager, no extra paid infrastructure.
* Releases are uploaded to `app-next`, migrated, then swapped (`app` → `app.prev` kept for rollback).
* Secrets are provisioned individually via the InstaPods env API (`/etc/instapods/app.env`); the local
  `.env` is never uploaded. Every release is scanned for `.env` secret values before upload.
* PostGIS: not provided by the managed PostgreSQL service; installed inside our own pod from the Ubuntu
  archive (`postgresql-16-postgis-3`) and enabled per database by the local `postgres` superuser. Requires no plan change.
