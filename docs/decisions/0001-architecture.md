# ADR 0001 – Application foundation

**Status:** Accepted (Phase 0/1, 2026-11-12)

## Context

The repository contained only `IMPLEMENTATION.md` and an approved design export
(`FastighetsRadar dashboard complete/`): a single `.dc.html` template rendered by a custom
runtime (`support.js`, React 18 UMD + Babel from unpkg), with Three.js and Leaflet loaded
from public CDNs at runtime. No application, build system or backend existed.

## Decision

| Area | Choice | Notes |
|---|---|---|
| Monorepo | **npm workspaces** (`apps/*`, `packages/*`) | IMPLEMENTATION.md suggests pnpm + Turborepo "or equivalent". pnpm is not installed on the dev machine; npm workspaces avoid a global tool. Switching later is mechanical. |
| Frontend | **Next.js 16 (App Router) + React 19 + TypeScript** | `apps/web`. Routes `/overview` and `/properties/[propertyId]`. |
| Styling | **Inline style objects + design tokens** (`lib/design/tokens.ts`) + one global CSS file | The approved design is authored entirely in inline styles. Porting them 1:1 preserves the visual result exactly. Tailwind/shadcn were not introduced (would be a redesign, not a migration). |
| 3D | **three@0.160.0, bundled locally**, plain Three.js (no R3F) | Same version as the prototype so the scene renders identically. Scene code ported verbatim into `components/three/property-scene.ts`, lazy-loaded. |
| Maps | **Leaflet 1.9.4, bundled locally** | IMPLEMENTATION.md recommends MapLibre GL; the approved design uses Leaflet. Kept Leaflet to preserve the design; revisit together with the tile-provider decision. |
| Fonts | `geist` package (self-hosted Geist / Geist Mono) | No runtime Google Fonts request. |
| API | **Fastify 5 + Zod**, `apps/api` | Health (`/health/live`, `/health/ready`), `/v1/sources/status`, RFC 9457 problem details, request IDs, pino logging with redaction. |
| Shared validation | **Zod 4** schemas in `packages/domain` | Types are inferred from schemas – one source of truth for web, API and adapters. |
| Config | `packages/config` – Zod env schema | Missing optional keys never fail startup; SMS defaults to disabled + dry-run. |
| DB | **PostgreSQL 16 + PostGIS**, plain SQL migrations (`packages/db`) | Small checksummed forward-only runner. Spatial types/indexes are first-class; spatial queries will be SQL anyway. |
| Integrations | `packages/integrations` – manifest + adapter interfaces + stubs | No external calls in this phase. |
| Tests | **Vitest** at the root | 47 tests across packages. Playwright E2E not yet added. |

### Data separation

* `packages/domain/src/fixtures/` holds the design's demo data, typed with the real domain
  schemas and tagged `origin: 'demo_fixture'` everywhere.
* `FASTIGHETSRADAR_DATA_MODE=demo|live` (server-side) selects the source. Live mode never
  falls back to fixtures; it renders an explicit "unavailable" state until the API exists.
* View-models (`apps/web/lib/view-models`) turn typed snapshots into display values. Missing
  or non-`ok` values render as "—", never as 0 or "normal".

### Property detail keeps WebGL alive

`app/(dashboard)/properties/layout.tsx` renders `<PropertyDetail/>` so the component stays
mounted when `[propertyId]` changes. The 3D scene is updated in place and the map flies to the
new location, as in the prototype, instead of tearing down a WebGL context per switch.

## Consequences

* The design is preserved exactly, but styles live in TSX rather than CSS classes. Future
  refactors can extract shared surfaces further via `tokens.ts`.
* A worker app (`apps/worker`, BullMQ) is not created yet – it belongs with the first
  collectors (Phase 4/6).
