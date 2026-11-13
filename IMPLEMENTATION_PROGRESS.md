# FastighetsRadar – Implementation progress

> Newest phase first: Agent 2.5 → Agent 2 → Agent 1.

---

# Agent 2.5 – Geoapify maps, stabilization & pre-Phase 3 verification

**Date:** 2026-11-13 · **Branch:** `agent2.5/geoapify-maps` (based on `agent2/clerk-postgres-onboarding`, no history rewritten, nothing pushed/merged)
**Live:** https://f-radar.fr-2.instapods.app · **Pod:** `f-radar` (id `f0630977661da075867bee0ee31eb9d1`, Build plan, EU) – `vaktskolan` only listed, never touched.

## 1. Map provider: CARTO → Geoapify

| Item | Result |
|---|---|
| Provider config | One module `apps/web/lib/maps/tile-config.ts` (pure, unit-tested); `components/maps/leaflet-utils.ts` applies it to every map. No tile URLs elsewhere. |
| Maps migrated | Portfolio Overview map, Property Detail "Local Context" map, Add/Edit Property location picker (all three Leaflet maps in the app). |
| Tile URL | `https://maps.geoapify.com/v1/tile/{style}/{z}/{x}/{y}{r}.png?apiKey=<browser key>` (`{r}` → `@2x` on retina screens) |
| Style | **`positron`** (default). Compared side-by-side with `osm-bright-grey` on the same tiles: Positron is the OpenMapTiles rendition of CARTO's light basemap used by the approved prototype (muted greys, small grey labels, no road shields) and therefore the closest match. `osm-bright-grey` (the brief's initial preference) is noticeably busier; it remains selectable with `NEXT_PUBLIC_MAP_STYLE=osm-bright-grey`. Allowed light styles: positron, osm-bright-grey, osm-bright-smooth, osm-bright, klokantech-basic, toner-grey, osm-liberty. |
| Attribution | `Powered by Geoapify \| © OpenMapTiles © OpenStreetMap contributors` (links to geoapify.com, openmaptiles.org, openstreetmap.org/copyright) – required on the free plan. Verified topmost (not covered by legend/zoom overlays) on both dashboard maps and visible in the picker. |
| Zoom limits | min 4 (Sweden) – max 19 |
| Cost controls | `keepBuffer: 1`, `updateWhenIdle`, `updateWhenZooming: false`; one map + one tile layer per component instance (also under React StrictMode); maps removed on unmount. Live measurement: 12 tile requests for the overview map; **0 additional** requests on unrelated re-renders (SMS toggle) and on rain/flood overlay toggles. |
| Failure handling | After 6 consecutive tile errors (invalid/unauthorised key, 429, network) the tile layer is removed (no further paid requests) and the attribution corner shows "Map tiles unavailable". Missing/invalid key → maps render without tiles, attribution "Map tiles not configured" – never CARTO, never a watermark. Markers/overlays keep working. |
| Swappable | `NEXT_PUBLIC_MAP_TILE_URL` + `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` override the provider without code changes. |
| No tile cache/proxy | Tiles load directly from Geoapify in the browser (no server proxy, no stored tiles) – no extra load on the 1 GB pod and no caching-terms question. |

### Keys and restrictions

| Variable | Where | Purpose |
|---|---|---|
| `GEOAPIFY_API_KEY` | server only (pod env) | Address autocomplete/geocoding. **Never** in the browser – release secret scan confirms it is absent from all 1 676 shipped files. |
| `NEXT_PUBLIC_GEOAPIFY_MAP_KEY` | build-time, public | Map tiles only. Separate key created by the owner on 2026-11-13. `next.config.ts` and `deploy-pod.mjs` refuse to build/deploy if it equals `GEOAPIFY_API_KEY`. |
| `NEXT_PUBLIC_MAP_STYLE` | build-time, public | Optional, default `positron`. |

Geoapify dashboard settings of the map key (project "F-radar" → API keys → key created 11/13/2026), set with the owner's permission:
* Allowed HTTP Origins: `https://f-radar.fr-2.instapods.app`, `http://localhost:3000` (a mistyped `…instapods.app/` entry with a trailing slash was corrected – origins never contain a path).
* Allowed HTTP Referers: `^https://f-radar\.fr-2\.instapods\.app/.*$`, `^http://localhost:3000/.*$`.
* IP restrictions: none (a browser key cannot be IP-restricted).

Verified enforcement (header-level tests, ~0.25 credits each):
* `api.geoapify.com` with this key: foreign Referer → 401, foreign Origin → 401, pod Referer → 200. The key **cannot be used for geocoding from other sites**.
* `maps.geoapify.com` tiles: foreign **Origin** → 401; pod and localhost → 200. **Referer rules are not enforced on the tile endpoint** – requests with a foreign Referer or none still return tiles. Browsers send no Origin header for plain `<img>` tiles, so the tile endpoint cannot distinguish our pages from someone reusing the public key in their own `<img>` tags. This is a provider limitation of browser tile keys.
* Residual risk and mitigation: a copied key could consume tile credits. On the free plan this cannot create charges (limits are soft; no paid plan enabled). Watch **MyProjects → F-radar → Usage & statistics** (daily credits per key); if abuse appears, rotate the map key (create new key, update `.env`, redeploy, delete old key) or switch to a server-side tile proxy with caching/rate limits.
* Recommended (owner): restrict the **server** key `GEOAPIFY_API_KEY` to the pod's egress IP address in the same dashboard (Allowed IP addresses) – it is only used from the pod.

## 2. Map functionality verified

| Check | How | Result |
|---|---|---|
| Tiles render, CARTO watermark gone | Live (owner's Chrome) + local | ✅ overview 8/8, detail 8/8, picker 6/6 tiles; no `cartocdn` / "API KEY REQUIRED" anywhere in the page |
| Property markers + titles | Live + DOM tests | ✅ one marker per property, title = property name |
| Marker click → property detail | DOM test | ✅ |
| Hover tooltip | Local demo map | ✅ |
| Zoom in/out | Live (visible Chrome) | ✅ z13 → z14 → z13, 0 broken tiles. (In the hidden in-app browser pane animations are paused, so zoom could only be verified in the visible browser.) |
| Rain overlay / flood zones toggles | Local demo map | ✅ flood 3 shapes, +rain 6, flood off → 6 |
| Local map centred on property, events/radius/flood overlays | Live + demo | ✅ pin exactly centred; overlays render |
| Location picker: draggable pin, click to correct | Live (dialog opened & cancelled) + DOM test | ✅ draggable pin present; map click reports corrected position (drag itself verified live by Agent 2 – unchanged code path) |
| Map cleanup / no duplicate maps | DOM tests (StrictMode, unmount, re-render) | ✅ |
| 3D scenes & water animation | Live canvases (overview 1, detail 2) | ✅ |
| Design unchanged | `/demo/overview` & `/demo/properties/*` locally vs. Agent 1 screenshots | ✅ only the basemap imagery changed (CARTO → visually equivalent Positron) |

## 3. Regression verification (Agent 2 features)

| Area | Evidence | Result |
|---|---|---|
| Clerk auth / protected routes | `/overview`, `/properties` → 307 to `/sign-in`; owner's live session works; API calls 200 when signed in | ✅ |
| Server-side API authorization | `/api/app/properties`, `/api/app/portfolio` unauthenticated → 401 JSON; cross-site POST → 403 | ✅ |
| PostgreSQL health | `/health/ready` = ready, `database: ok, postgis 3.4.2` | ✅ |
| Persistence across restart | Deploy restarted the service; the owner's properties (2 rows, 2 orgs) still load | ✅ |
| Tenant isolation | Real-DB suite re-run on the pod (7/7) incl. repository isolation and API cross-org 404s; unit tests for forged tokens / smuggled org ids | ✅ |
| Migrations | "Database is up to date" – no migration ran, nothing destructive | ✅ |
| Geoapify address search | API key unchanged; contract tests pass (live autocomplete verified by Agent 2) | ✅ (not re-exercised live this phase to save credits) |

## 4. Tests executed

| Suite | Result |
|---|---|
| Vitest (unit, contract, DOM) | **10 files, 77 tests passed** (+11 new: `apps/web/test/tile-config.test.ts`, `apps/web/test/maps.dom.test.tsx`) |
| Real PostgreSQL/PostGIS on the pod (`fastighetsradar_test`) | **7/7 passed** |
| ESLint / typecheck (all workspaces) | clean |
| Production build + release secret scan | passed, 1 676 files clean |
| Live browser checks | see §2/§3 (Claude in Chrome in the owner's signed-in session; console: only Clerk's expected "development keys" warning) |

New dev dependencies: `jsdom`, `@testing-library/react` (DOM tests only).

## 5. Git

* Branch **`agent2.5/geoapify-maps`**, created from `agent2/clerk-postgres-onboarding` @ `9617803`. All Agent 1/2 commits preserved; no rebase, force-push, branch deletion, merge or push.
* `786f8f3` – Geoapify map migration (deployed; recorded in `/home/instapod/app/RELEASE`).
* Final documentation commit follows on the same branch (see `git log`).
* `.env`, `.env.*` (except `.env.example`), build output and deploy artifacts are git-ignored; staged files were scanned for secrets before each commit.

## 6. Deployment

Deployed to the existing `f-radar` pod with `node scripts/deploy-pod.mjs` (pre-checks: pod id/plan, typecheck, lint, tests, build, secret scan). Clerk: development instance. Map tiles: Geoapify `positron`. Previous release kept in `/home/instapod/app.prev` (rollback command in README). No new pods, plans, domains or paid services.

## 7. Clerk production – deferred (domain not yet purchased)

Nothing domain-related was configured. When `f-radar.se` is purchased:
1. Clerk Dashboard → create/complete the **production** instance for `f-radar.se`; add the DNS records Clerk lists (Frontend API `clerk.f-radar.se`, account portal, email DKIM records); enable **Organizations** (personal accounts off) on the production instance.
2. InstaPods → `f-radar` → Custom domains → add `app.f-radar.se` (free; no plan change); point DNS for `app.f-radar.se` as instructed.
3. `.env`: production pair in `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` and remove (or blank) the development pair; set `CLERK_AUTHORIZED_PARTIES=https://app.f-radar.se` (the deploy script currently derives it from the pod URL – update it to use the custom domain).
4. Geoapify map key: add `https://app.f-radar.se` to allowed origins and `^https://app\.f-radar\.se/.*$` to referers.
5. Redeploy with `node scripts/deploy-pod.mjs --allow-live-clerk` and repeat the auth test procedure below.
No domain names are hard-coded in application logic (they come from env / pod metadata).

## 8. Manual owner test (2 minutes)

1. Open https://f-radar.fr-2.instapods.app → you are redirected to sign-in if signed out.
2. Sign out via the avatar menu (top right) → you land on `/sign-in`.
3. Sign in again → Portfolio Overview shows your properties with Geoapify map tiles.
4. Switch organization (header) → only that organization's properties are shown; switch back.
5. Add Property → type a Swedish address → pick a suggestion → drag the pin → Save → the property opens on its detail page; reload → it is still there.

## 9. Remaining issues

1. **Tile referer restriction not enforceable** (provider limitation, §1) – monitor usage; rotate the map key if abuse appears.
2. **Explicit logout → login** still not observed by the agent (credentials are the owner's) – use the manual test above.
3. Server key `GEOAPIFY_API_KEY` is not IP-restricted yet (recommended owner action).
4. Sweden validation remains a bounding box (Oslo/Copenhagen pass) – unchanged from Agent 2.
5. Clerk `createRouteMatcher` deprecation warning – unchanged, harmless.
6. No Playwright E2E; browser verification was manual.
7. Dev-instance test data from Agent 2 ("Isolation Test Org") may still exist.

## 10. Phase 3 readiness checklist

- [x] Maps on an approved provider (Geoapify, Positron) with required attribution; CARTO removed
- [x] Separate public map key; server geocoding key never shipped to the browser
- [x] Markers, overlays, zoom, picker, local map, cleanup verified (tests + live)
- [x] Clerk auth + organizations working (development instance)
- [x] PostgreSQL 16 + PostGIS 3.4.2 healthy; migrations idempotent; data survives restarts
- [x] Tenant isolation verified on real PostgreSQL (7/7) and in unit tests
- [x] Typecheck, lint, 77 unit/DOM tests, production build, secret scan all green
- [x] Deployed to `f-radar` with rollback available; `vaktskolan` untouched
- [x] Work committed on `agent2.5/geoapify-maps`
- [ ] Owner: run the manual logout/login test (§8)
- [ ] Owner (recommended): IP-restrict the server Geoapify key; monitor map-key usage
- [ ] Deferred by decision: Clerk production + `f-radar.se` domain (§7)

**Verdict:** ready for Phase 3 (geo engine & data model / first public-data adapters). The open owner items do not block development.

---

# Agent 2 – Infrastructure, Clerk, PostgreSQL & property onboarding

**Date:** 2026-11-12 · **Branch:** `agent2/clerk-postgres-onboarding` · **Live:** https://f-radar.fr-2.instapods.app

## 1. Work completed

| Area | Result | Verified how |
|---|---|---|
| InstaPods pod | `f-radar` created (Build plan, EU, Node.js 22). `vaktskolan` only listed, never touched | REST API reads; helper hard-refuses any other pod name |
| PostgreSQL | Managed service **PostgreSQL 16.15**, localhost/Unix socket only, auto-generated credentials | `ss -ltn` (127.0.0.1/::1:5432), service API |
| PostGIS | **3.4.2 installed and functional** (`postgresql-16-postgis-3` from Ubuntu, inside our pod, enabled by local superuser) | `PostGIS_Version()`, geography distance, point-in-polygon, real-DB tests |
| Migrations | `0001` + `0002` applied to `fastighetsradar`; re-run = no-op | migrate CLI on the pod, real-DB tests on `fastighetsradar_test` |
| Clerk | Sign-up, sign-in, sign-out (UserButton), protected routes (`proxy.ts`), branded auth pages, organization onboarding + switcher | Live: user registered and created org; isolation test org created via switcher |
| Server-side auth | Fastify verifies Clerk session JWTs itself; organization from verified claims only | Unit + real-DB tests; live traffic (0 auth errors) |
| Property CRUD | Add (Geoapify), view, rename, address change, pin correction, delete, switch | Live UI in Chrome + DB row inspection |
| Geoapify | Real adapter: debounce/cancel, cache, retry/backoff, budget, Sweden filter, attribution | Contract tests + live smoke test + live UI autocomplete |
| Dashboard | Overview & detail show the organization's real properties; monitoring shows explicit "not connected" | Live UI checks; view-model tests |
| Trafikverket | Key recognised, integration **disabled** (`key present, disabled` in API config log) | Pod logs; no traffic API called |
| Deployment | Next.js public (nginx/HTTPS), Fastify private 127.0.0.1:4000, systemd restart, secrets via env API | `ss`, curl from outside, health checks |

## 2. Files created or modified

**New:** `apps/api/src/{auth.ts,portfolio.ts,rate-limit.ts,routes/customer.ts}`, `apps/api/test/auth.test.ts`,
`apps/web/proxy.ts`, `apps/web/app/{sign-in,sign-up,onboarding,demo,api/app/[...path]}/**`,
`apps/web/components/auth/AuthFrame.tsx`, `apps/web/components/properties/{PropertyEditorDialog,PropertyEditorHost}.tsx`,
`apps/web/components/dashboard/EmptyPortfolio.tsx`, `apps/web/components/maps/LocationPickerMap.tsx`,
`apps/web/lib/server/internal-api.ts`, `apps/web/lib/design/clerk-appearance.ts`,
`packages/domain/src/api.ts`, `packages/db/src/properties.ts`, `packages/db/migrations/0002_clerk_tenancy_properties.sql`,
`packages/integrations/test/geoapify.test.ts`, `tests/integration/real-db.test.ts`, `tsup.deploy.config.ts`,
`deploy/pod/index.js`, `scripts/{instapods.mjs,deploy-pod.mjs,check-no-secrets.mjs,smoke-geoapify.mts}`,
`docs/decisions/0002-auth-tenancy-deployment.md`.

**Modified:** `apps/api/src/{app.ts,main.ts,routes/health.ts}`, `apps/web/app/{layout.tsx,(dashboard)/**}`,
`apps/web/next.config.ts`, `apps/web/lib/{data/portfolio.ts,state/dashboard-state.tsx,view-models/*}`,
`apps/web/components/{shell/*,dashboard/*,properties/*,maps/LocalEventsMap.tsx,ui/Toggle.tsx}`,
`apps/web/test/view-models.test.ts`, `packages/config/src/env.ts`, `packages/domain/src/{entities.ts,index.ts}`,
`packages/db/src/{index.ts,migrations.ts}`, `packages/integrations/src/{geoapify/index.ts,types.ts,registry.ts}`,
`apps/api/test/app.test.ts`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `README.md`, `docs/sources.md`,
`docs/implementation-progress.md`, `package.json`/`package-lock.json` (Clerk SDKs).

## 3. InstaPods

| Item | Value |
|---|---|
| Pod name / id | `f-radar` / `f0630977661da075867bee0ee31eb9d1` |
| URL | https://f-radar.fr-2.instapods.app |
| Plan | **build** (confirmed via API; no resize/upgrade performed) |
| Region / server | `eu` / `instapods-fr-2` |
| Runtime | Node.js 22 (`nodejs` preset), Ubuntu 24.04, systemd unit `app` (`Restart=on-failure`) |
| Resources observed | ~217 MB RAM used of ~1.9 GB visible (plan: 1 GB effective), disk 2.3 GB / 24 GB |
| Other pods | `vaktskolan` (launch, running) – never targeted; `scripts/instapods.mjs` refuses every pod name except `f-radar` |
| Paid changes | Only the authorized Build pod. No domains, upgrades or extra services |

## 4. Database

* **PostgreSQL 16.15** (InstaPods service, `localhost:5432`, peer auth over `/var/run/postgresql`).
* **PostGIS 3.4.2 (GEOS, PROJ)** – not part of the managed service; installed with `sudo apt-get install postgresql-16-postgis-3`
  inside our pod (the `instapod` user has passwordless sudo in its own container) and enabled per database by the
  local `postgres` superuser. Re-provisioning the pod requires repeating this step (documented below).
* Databases: `fastighetsradar` (app), `fastighetsradar_test` (destructive tests only; the suite refuses any DB not ending in `_test`).
* Connection pooling: `pg.Pool` (max 10) in the single API process. No PgBouncer (not needed at this scale; not provided by the service).
* **Migration results:** `0001_init.sql`, `0002_clerk_tenancy_properties.sql` applied; second run "Database is up to date"; checksums recorded.
* Schema highlights (0002): `organizations.clerk_org_id` (unique, format-checked), properties with confirmed `location` and
  original `geocoded_location` (both `geography(Point,4326)`), geocoding metadata, `position_source`, audit columns
  (`created_by/updated_by` = Clerk user ids, `updated_at` triggers), Sweden bounding-box CHECK, `property_monitoring`
  (SMS off by default), indexes `idx_properties_org`, `idx_properties_org_created`, GIST `idx_properties_location`.

## 5. Clerk integration status

* SDKs: `@clerk/nextjs` 7.9.25 (Next 16 `proxy.ts` + `clerkMiddleware`), `@clerk/backend` 3.27 (Fastify).
* **Instance in use: DEVELOPMENT** (`adjusted-moray-6291`). Organizations enabled via Backend API with owner approval;
  `force_organization_selection=true` (no personal accounts).
* Pages: `/sign-in`, `/sign-up`, `/onboarding` (OrganizationList), styled to the dashboard design language.
  Header: Clerk `UserButton` (profile, sign-out) + `OrganizationSwitcher`.
* The production instance (`clerk.f-radar.se`) is **not usable yet**: its DNS records do not exist and Organizations are disabled
  there. Not modified.

## 6. Organization isolation strategy

1. `proxy.ts` requires a session for all dashboard pages; the dashboard layout additionally requires an active organization.
2. The browser only talks to Next.js. `/api/app/*` is an allowlisted proxy (no open proxy), with same-origin checks on writes.
3. Fastify verifies the Clerk JWT itself (signature, expiry, `azp`) and takes `org_id` only from the verified claims.
4. Every repository query filters `organization_id = <internal id resolved from the verified Clerk org>`.
5. No org → 403 `organization-required`; other org's property → 404 (no existence oracle).
Verified by: unit tests (forged token, smuggled org ids), the real-DB suite (repo + API), and live: from a second organization, GET/PATCH/DELETE of
the first org's property and its detail page all returned 404 and the rows were unchanged.

## 7. Geoapify status

Implemented and live. Key read server-side only (never in browser bundles – release secret scan clean). Live smoke
test: "Sveavägen 42, Stockholm" → building-level match 59.33677, 18.06270. In the UI: autocomplete, selection, map
confirmation, manual pin correction (46.4 m shift stored as `manual_adjusted`), attribution shown. Fallback when the key/quota fails:
"Place the pin manually". Stored properties are never re-geocoded.

## 8. Tests executed

| Suite | Result |
|---|---|
| Vitest (unit/contract, no network) | **8 files, 66 tests passed** (incl. Agent 1's 47) |
| Real PostgreSQL/PostGIS (`node --test`, inside pod, `fastighetsradar_test`) | **7/7 passed**: PostGIS, clean migrate + repeatability, tables/FKs/indexes, constraints, CRUD + geography query, repo isolation, API end-to-end isolation & persistence |
| Geoapify live smoke test | passed (1 credit) |
| ESLint / typecheck (6 workspaces) | clean |
| Production build (tsup bundles + Next standalone) | passed; release secret scan clean (1 676 files) |
| Deployed health | `/health/ready` = ready (database ok, postgis 3.4.2; redis skipped – not used yet), web 200 |
| Exposure checks (from internet) | `/overview` → 307 to own `/sign-in`; `/api/app/*` unauth → 401 JSON; unknown API path → 404; cross-site POST → 403; `/demo` → 404; Fastify/Postgres bound to localhost |
| Live browser (owner's Chrome session) | Registration + org creation (by owner); overview/detail with real data; add 2 properties via Geoapify; pin correction; switcher prev/next; local map centred (pin offset 0,0); rename; delete; second org isolation; data present after service restart |
| Design regression | `/demo/overview` (fixtures) renders identically to Agent 1's verified design |

## 9. Deployment status

Deployed (release from branch `agent2/clerk-postgres-onboarding`). Process layout on the pod:
`/home/instapod/app/index.js` (supervisor) → `web/apps/web/server.js` (0.0.0.0:3000, `--max-old-space-size=384`) and
`api/main.mjs` (127.0.0.1:4000, 192 MB). Previous release in `/home/instapod/app.prev`.
Runtime env set on the pod (names only): `APP_URL, CLERK_AUTHORIZED_PARTIES, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY,
GEOCODING_PROVIDER, GEOAPIFY_API_KEY, TRAFIKVERKET_API_KEY, TRAFIKVERKET_ENABLED=false, DATABASE_URL (socket, no password),
FASTIGHETSRADAR_INTERNAL_API_URL, FASTIGHETSRADAR_DEMO_ENABLED=false, SMS_ENABLED=false, SMS_DRY_RUN=true, LOG_LEVEL, TZ`.
Logs: `node scripts/instapods.mjs logs 200 app`.

### Re-provisioning PostGIS on a fresh pod
```
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-16-postgis-3
sudo -u postgres createdb -O instapod fastighetsradar
sudo -u postgres psql -d fastighetsradar -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

### Running the real-PostgreSQL tests
Build `npx tsup --config tsup.deploy.config.ts`, upload `dist-deploy/tests/real-db.test.mjs` + `packages/db/migrations/` to
`/home/instapod/fr-ci`, then inside the pod:
`TEST_DATABASE_URL="postgresql:///fastighetsradar_test?host=/var/run/postgresql" FASTIGHETSRADAR_MIGRATIONS_DIR=/home/instapod/fr-ci/migrations node --test real-db.test.mjs`

## 10. Missing configuration

* **Production Clerk**: DNS for `clerk.f-radar.se` (and accounts.f-radar.se etc.), a custom domain on the pod, Organizations enabled on that instance, then swap keys and `CLERK_AUTHORIZED_PARTIES`.
* Map tile provider/key (`NEXT_PUBLIC_MAP_TILE_URL`) – maps still show CARTO's "API KEY REQUIRED" watermark.
* `CLERK_JWT_KEY` (optional, enables networkless token verification).
* Redis (not needed until the worker/collector phase).

## 11. Outstanding issues / not verified

1. **An explicit logout → login cycle was not observed by the agent** (the agent may not enter credentials on Clerk; please sign out and back in once to confirm). The agent is not permitted to enter
   credentials on Clerk. Persistence itself is verified: rows survive reloads, organization switches and a full service restart,
   and the real-DB suite re-reads data through a fresh API instance.
2. The Sweden check is a bounding box (points in e.g. Oslo or Copenhagen pass). A precise national-boundary polygon check is a future improvement.
3. `createRouteMatcher` is deprecated in Clerk 7.9 (warning only). Pages/handlers already enforce auth themselves; migrate when Clerk removes it.
4. Fixture "demo" route is off on the pod; local only.
5. No Playwright E2E yet (browser checks were manual via Claude in Chrome).
6. Adding an SSH key to the pod for a DB tunnel was blocked by the agent's permission guard; tests therefore run inside the pod via the exec API.
7. Test data in the live dev instance: organizations "Kevins org" (1 property "Sveavägen 42") and "Isolation Test Org" (no properties). Remove if unwanted.
8. Building facts (type/floors/units) are not collected yet; the 3D view uses a neutral default and is labelled an illustration.

## 12. Recommended next phase

Phase 4 per IMPLEMENTATION.md §19: SMHI SNOW1gv1 forecasts + SMHI warnings + Krisinformation adapters with a collector
in a new `apps/worker` (BullMQ needs Redis – consider a lightweight in-process scheduler first on the Build plan), mapping into the existing
`PropertySnapshot` contract so the "not connected" panels light up per source. In parallel: production Clerk domain setup
and a licensed tile provider.

---

# Agent 1 – Design preservation & application foundation

**Phase covered:** Agent 1 – design preservation & application foundation (IMPLEMENTATION.md Phase 0 + Phase 1)
**Date:** 2026-11-12
**Next owner:** Agent 2

---

## 1. Starting point (inventory)

The repository contained only:

* `IMPLEMENTATION.md` – the plan (Swedish).
* `FastighetsRadar dashboard complete/` – approved design export:
  * `FastighetsRadar.dc.html` (922 lines): a single template for both views, written for a custom
    runtime (`<x-dc>`, `sc-if`, `sc-for`, `style-hover`, `{{ }}` bindings) plus a `Component`
    class holding all state, demo data, Three.js scene builder, Leaflet map logic and a wave canvas.
  * `support.js`: the generated runtime (React 18 UMD + Babel loaded from unpkg at runtime).
  * `uploads/*.png`: three third-party dashboard screenshots used as **inspiration** (logistics
    dashboards) – not the FastighetsRadar design itself. The `.dc.html` is the design reference.

No application, build tooling, backend or tests existed. The design folder was **not modified**
(SHA-256 `FastighetsRadar.dc.html` = `4e8445e3…df91`, `support.js` = `8fe7df74…8cbe`).

## 2. Architecture established

See [`docs/decisions/0001-architecture.md`](docs/decisions/0001-architecture.md). Summary:

* **npm workspaces** monorepo (`apps/*`, `packages/*`) – pnpm isn't installed; documented deviation.
* **apps/web** – Next.js 16 App Router, React 19, TypeScript. Routes `/overview`,
  `/properties/[propertyId]` (`/` and `/properties` redirect).
* **apps/api** – Fastify 5 + Zod, pino logging with redaction, RFC 9457 problem details,
  request IDs, `/health/live`, `/health/ready`, `/v1/sources/status`.
* **packages/domain** – Zod schemas (single source of truth for types), formatters, demo fixtures.
* **packages/config** – server env validation, data mode, SMS safety gate.
* **packages/integrations** – source/licence manifest, adapter interfaces, per-source stubs.
* **packages/db** – PostGIS baseline migration + checksummed SQL migration runner + CLI.
* `docker-compose.yml` (PostGIS 16 + Redis 7), `.env.example`, ESLint flat config, Vitest.

## 3. Files created or changed

All files are new. Nothing outside the list below was touched.

| Area | Files |
|---|---|
| Root | `package.json`, `package-lock.json`, `tsconfig.base.json`, `.env.example`, `.gitignore`, `docker-compose.yml`, `eslint.config.mjs`, `vitest.config.mts`, `README.md`, `IMPLEMENTATION_PROGRESS.md`, `.claude/launch.json`, `scripts/serve-design.mjs`, `tests/stubs/server-only.ts` |
| Docs | `docs/decisions/0001-architecture.md`, `docs/sources.md`, `docs/implementation-progress.md` |
| packages/domain | `src/common.ts` (status/kind/geo/freshness/origin vocab + `Measurement`), `src/entities.ts` (Property, Portfolio, EnvironmentalMetric, WeatherForecast, OfficialWarning, GeographicEvent, FloodExposure, DataSourceStatus, AlertRule, PropertySnapshot, DemoRiskAssessment …), `src/contracts.ts` (DataPoint, MonitorEvent, ProblemDetails, Readiness), `src/format.ts`, `src/fixtures/demo-portfolio.ts`, `src/fixtures/synthetic-series.ts`, `test/fixtures.test.ts` |
| packages/config | `src/env.ts`, `src/data-mode.ts`, `test/env.test.ts` |
| packages/integrations | `src/types.ts`, `src/sources/manifest.ts`, `src/registry.ts`, `src/status.ts`, `src/not-implemented.ts`, `src/{smhi,krisinformation,air-quality,sgu,mcf,scb,trafikverket,geoapify,lantmateriet,boverket,sms}/index.ts`, `test/integrations.test.ts` |
| packages/db | `migrations/0001_init.sql`, `src/migrations.ts`, `src/pool.ts`, `src/cli.ts`, `test/migrations.test.ts` |
| apps/api | `src/main.ts`, `src/app.ts`, `src/errors.ts`, `src/logger.ts`, `src/routes/health.ts`, `src/routes/sources.ts`, `tsup.config.ts`, `test/app.test.ts` |
| apps/web | `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/(dashboard)/layout.tsx`, `app/(dashboard)/overview/page.tsx`, `app/(dashboard)/properties/{layout,page}.tsx`, `app/(dashboard)/properties/[propertyId]/page.tsx`, `components/**` (see §4), `lib/design/tokens.ts`, `lib/state/dashboard-state.tsx`, `lib/data/portfolio.ts`, `lib/view-models/{overview,detail,rules,snapshot,chart}.ts`, `test/view-models.test.ts`, `next.config.ts` |

## 4. Components migrated

| Design block | Component(s) |
|---|---|
| Sidebar, nav, source status card | `shell/Sidebar.tsx` |
| Header (search, Quick switch, range, bell, Add Property, user) | `shell/Header.tsx`, `ui/Popover.tsx`, `properties/PropertyList.tsx` |
| Shell / shared state | `shell/AppShell.tsx`, `lib/state/dashboard-state.tsx` |
| Portfolio 3D hero + glass stat cards + risk ring | `dashboard/PortfolioHero3D.tsx`, `three/ThreeScene.tsx`, `three/property-scene.ts` |
| Six KPI cards | `dashboard/PortfolioKPIs.tsx` |
| Portfolio map (pins, tooltips, rain/flood layers, legend, zoom) | `maps/PortfolioMap.tsx`, `maps/leaflet-utils.ts` |
| Alert feed | `dashboard/AlertFeed.tsx` |
| Monitoring status table (incl. SMS toggles) | `dashboard/PropertyStatusTable.tsx`, `ui/Toggle.tsx` |
| Portfolio health donut + categories, Upcoming conditions | `dashboard/PortfolioAnalytics.tsx` (`PortfolioAnalytics`, `UpcomingConditions`) |
| Group filter (All / Innerstad / Förort & Kust) | `dashboard/PortfolioOverview.tsx` |
| Detail header, breadcrumb, back, Configure Alerts | `properties/PropertyDetail.tsx` |
| Property switcher (prev / dropdown / next) | `properties/PropertySwitcher.tsx` |
| Property 3D hero + overlays | `properties/PropertyHero3D.tsx` |
| Overall property risk gauge + factors | `properties/PropertyRiskPanel.tsx` |
| Official warnings | `properties/OfficialWarnings.tsx` |
| Five instrument cards | `properties/EnvironmentalMetrics.tsx` |
| Environmental conditions chart + tabs | `properties/WeatherCharts.tsx` |
| Water risk + animated wave canvas | `properties/WaterRiskPanel.tsx` |
| Local events list / Local context map | `properties/LocalEventsPanel.tsx`, `maps/LocalEventsMap.tsx` |
| Property timeline | `properties/PropertyTimeline.tsx` |
| SMS alert rules | `properties/SMSRulesPanel.tsx` |
| Icons | `ui/icons.tsx` (verbatim SVGs) |

The prototype's `renderVals()` logic was ported into pure, tested view-model functions
(`lib/view-models/*`). Colours, radii, shadows, spacing and typography are copied verbatim
into `lib/design/tokens.ts` / inline styles; keyframes (`frPulse`, `frBreath`, `frShimmer`,
`frFade`) and Leaflet overrides into `globals.css`. `style-hover` became `.fr-hover-*` classes.

## 5. Interactive features preserved (verified in browser)

* Sidebar Dashboard / Properties navigation (Properties opens the last-selected property).
* Quick switch dropdown (8 properties) → opens detail, smooth scroll to top.
* Group filter → KPIs, map pins (4/8), table, feed and analytics all re-filter.
* Map: pin tooltips, pin click → detail, Rain overlay / Flood zones toggles, zoom +/−, fit-to-bounds.
* Alert feed and table row click → detail. SMS toggle in table does not navigate and updates the
  "SMS Triggers Armed" KPI (30 → 34 verified).
* Detail: breadcrumb, Back to Portfolio, prev/next and dropdown switcher (wraps around, `n/8`),
  Configure Alerts scrolls to SMS panel, chart tabs (Temperature/Precipitation/Wind/Humidity) with
  animated peak marker, SMS master toggle + per-rule toggles with Armed/Triggered/Off states.
* Animations: 3D orbit camera, animated water mesh, pulsing alert rings, rising particles, fade-in,
  shimmer, breathing dots, pulse pins, gauge/bar/donut grow-in (`ready` flag), wave canvas easing.
* Switching property keeps the same WebGL canvas and Leaflet map (scene `update()` + `flyTo`).

## 6. Data separation

* All design values live in `packages/domain/src/fixtures/demo-portfolio.ts`, mapped into the real
  domain types. Every object carries `origin: 'demo_fixture'`; ids are `demo-*`.
* Every measurement carries value, unit, sourceId, kind, sourceTimestamp, fetchedAt, freshness,
  availability and geographic relevance (`Measurement` schema).
* `FASTIGHETSRADAR_DATA_MODE=demo|live` (server-only). Live mode renders `LiveUnavailable` and never
  falls back to fixtures (tested).
* Missing / non-`ok` data renders "—", "Unknown" or "Not assessed" – never 0 or Normal (tested).
* The 0–100 risk score and factors exist only as `demoRisk` (`method: 'unspecified_demo_value'`);
  live mode shows "Not assessed". No risk calculation was invented.
* The chart time series are the prototype's **synthetic** generator, isolated in
  `fixtures/synthetic-series.ts`; the demo timeline is built by `buildDemoTimeline()` and is never
  shown for non-demo data.
* Visible demo labelling (minimal text changes only): date line "· Demo data", sidebar card
  "Demo data · not live / Fixture snapshot 14:32 · no sync" (was "All sources live / Last sync"),
  hero pill "Demo portfolio twin", feed badge "Demo" (was "Live"), detail pill
  "Illustrative property twin" (§14.3 – generic model must be labelled illustration), "Demo
  snapshot 14:32", subtitle "Demo of … monitoring" (was "Real-time …"), chart subtitle
  "· synthetic demo series", risk card "· demo values".

## 7. Infrastructure

* **Env:** `packages/config` validates all §6 variables; empty/missing optional keys → `undefined`,
  sources then report `pending_access`/`disabled`. Added `SMS_LIVE_SENDING_APPROVED`,
  `FASTIGHETSRADAR_DATA_MODE`, `API_HOST`, `NEXT_PUBLIC_MAP_TILE_URL/ATTRIBUTION`.
* **SMS safety:** `resolveSmsMode()` returns `live` only with SMS_ENABLED + !DRY_RUN + explicit
  approval flag + production + credentials; `createSmsProvider()` refuses to build a live provider
  in this phase anyway. Dry-run records messages in memory, dedupes, never touches the network.
* **Secrets:** read server-side only; pino redaction + query strings stripped from request logs;
  production client bundle grep for key names/DB password: no hits.
* **DB:** `0001_init.sql` – PostGIS + pgcrypto, organizations, users, organization_members,
  properties (`geography(Point,4326)` + GIST), source_catalog, property_source_profiles,
  alert_rules (`enabled DEFAULT false`), integration_runs. Runner is transactional, checksummed.
* **Integrations:** manifest for 14 sources (all `displayPermitted=false` pending licence review),
  interfaces for geocoding / forecast / observation / statistics / flood / event feeds / SMS, stubs per
  source returning `not_implemented` / `access_required` / `disabled` with no network access,
  Geoapify request builder (Sweden filter, `lang=sv`, limit 5) + key redaction.

## 8. Build & test results

| Check | Command | Result |
|---|---|---|
| Unit/integration tests | `npm test` | **6 files, 47 tests passed** (no network) |
| Lint | `npm run lint` | **0 errors, 0 warnings** |
| Typecheck | `npm run typecheck` | **pass** (all 6 workspaces) |
| Production build | `npm run build` | **pass** (API via tsup, web via `next build`) |
| API smoke test | `node dist/main.js` + curl | `/health/live` 200, `/health/ready` 200 `degraded` (DB/Redis not configured), `/v1/sources/status` 200, unknown route 404 problem+json |
| Browser (dev + prod) | built-in browser at 1440×900 vs `npm run design:reference` | both pages render and match the prototype; 3D, water, maps, switcher, tabs, filters, toggles work; 404 for unknown property id; no console errors in a fresh production load |
| WebGL leak check | 12 overview↔detail navigations | canvas count stable (1 overview / 2 detail), 1 Leaflet container, no "too many WebGL contexts" warnings |

Test coverage highlights: overview/detail view-models reproduce the prototype numbers exactly
(8 properties, 14 alerts, 3 at risk, 3 warnings / 4 affected, 7 weather events, 30 SMS triggers,
risk 43, 38 % healthy, category bars 4/3/2/6/2, warning times "Wed 16:00 → Thu 10:00");
missing-data rendering; Stockholm time zone incl. summer time; env parsing; SMS gating; source
statuses never `ok`; secrets absent from API output; migration ordering/rollback/checksum.

## 9. Known issues / not verified

1. **Map tiles show "API KEY REQUIRED" watermarks.** The prototype's CARTO `light_all` tiles now
   require a key/licence – the original prototype shows the same watermark. URL is configurable via
   `NEXT_PUBLIC_MAP_TILE_URL`; the tile provider decision (§24) is open.
2. **PostgreSQL/PostGIS and Redis were not run** – Docker and psql are not installed on this machine.
   Migrations are covered by unit tests against a fake client only; `npm run db:migrate` against a real
   PostGIS instance is unverified. `/health/ready` reports DB/Redis `skipped` without `DATABASE_URL`.
3. **No E2E (Playwright) tests yet**; browser verification was manual via the built-in browser.
4. **UI language is English** (as in the approved design); the product language is sv-SE (§0). i18n is
   a later decision – not changed to avoid altering the approved UI.
5. **Placeholder controls kept but inert** (as in the prototype): header search, Range pill, bell,
   Add Property, Edit rules, sidebar Alerts / Map View / Analytics / SMS Rules / Settings (marked
   `aria-disabled`). SMS toggles are local UI state only (not persisted).
6. **Mobile layout** is as responsive as the prototype (flex-wrap cards) but the 236 px sidebar does not
   collapse; small-screen behaviour (§14.3) is not yet addressed.
7. Demo fixtures intentionally violate production defaults copied from the design: SMS rules start
   **on** (production default must be off – enforced in the DB schema), and design-derived labels like
   "Basement risk", "Surface water", dew point and "condensation risk" are heuristics from the prototype
   with no documented method. They must not be shown for live data until a method is approved.
8. The design's sea-level panel ("Saltsjön +38 cm") implies an SMHI oceanography source that is not in
   IMPLEMENTATION.md §3; added to the manifest as `smhi_oceanography` (unverified). Several other
   design source labels have no planned source (see `docs/sources.md`).
9. `prefers-reduced-motion` freezes the 3D scene/wave to a static frame and shortens CSS animations –
   verified by code review only, not in a browser with the setting enabled.
10. `apps/worker` (BullMQ) was not scaffolded – no collectors exist yet to run in it.

## 10. Remaining tasks for Agent 2 (Phase 2 onward)

1. Start PostGIS/Redis (`npm run services:up`), run `npm run db:migrate`, wire the DB probe as
   critical in `/health/ready`, add a Redis probe; add Testcontainers integration tests.
2. Choose and integrate the auth provider; organisations/members; tenant guards on every endpoint
   (including `/v1/sources/status`).
3. Implement Geoapify autocomplete/resolve behind `/v1/geocoding/*` (response schema, rate limit,
   debounce, caching, smoke test with real key) + manual-pin fallback; property CRUD.
4. Implement `GET /v1/portfolio/*` and `/v1/properties/:id/*` returning `Portfolio` /
   `PropertySnapshot` shapes, then switch `apps/web/lib/data/portfolio.ts` live mode to call them.
5. Phase 4 adapters (SMHI forecast/warnings/MetObs, Krisinformation) using the interfaces in
   `packages/integrations`, with fixture contract tests + recorded smoke tests; flip
   `ADAPTER_IMPLEMENTATION` entries only then. Scaffold `apps/worker` with the first collector.
6. Decide map tile provider (and Leaflet vs MapLibre), set `NEXT_PUBLIC_MAP_TILE_URL`.
7. Add Playwright E2E for the two pages (navigation, switcher, tabs, demo labelling).
8. Product decisions needed: risk-score methodology (or remove the gauge in live mode), sv-SE copy,
   sources for design labels without a planned adapter, SMS rule defaults in UI.
