# FastighetsRadar – Implementation progress

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
