# FastighetsRadar

Adressbaserad bevakning av svensk offentlig data för fastighetsportföljer.
Plan: [`IMPLEMENTATION.md`](IMPLEMENTATION.md) · Progress: [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md) ·
Architecture: [`0001`](docs/decisions/0001-architecture.md), [`0002 auth/tenancy/deployment`](docs/decisions/0002-auth-tenancy-deployment.md)

**Live (development Clerk instance):** https://f-radar.fr-2.instapods.app

> Customers sign in with Clerk, create/select an organization and register properties by Swedish
> address (Geoapify). Public data (SMHI forecast/warnings/observations, Krisinformation, Trafikverket, air quality,
> SGU groundwater, MCF flood mapping, SCB) is collected centrally by a scheduler in the API process, matched to
> properties with PostGIS and pushed to the dashboard via SSE. No risk score is computed. No SMS can be sent.
> Sources and status: [`docs/sources.md`](docs/sources.md).

## Layout

```text
apps/web              Next.js 16 (App Router): dashboard, Clerk auth, /api/app BFF proxy
apps/api              Fastify API (private): Clerk token verification, properties, portfolio, geocoding
packages/domain       Zod schemas/types, formatters, demo fixtures (/demo only)
packages/config       Server env validation, Clerk key selection, SMS safety gate
packages/integrations Source manifest + provider adapters (zod-validated, retry/timeout helper)
packages/db           PostGIS SQL migrations, runner, tenant-scoped property repository
deploy/pod/index.js   Process supervisor for the InstaPods pod
scripts/              instapods.mjs (f-radar only), deploy-pod.mjs, run-real-db-tests.mjs, pod-sql.mjs (read-only), check-no-secrets.mjs, serve-design.mjs
tests/integration/    Real PostgreSQL/PostGIS suite (runs inside the pod: scripts/run-real-db-tests.mjs)
tests/live/           Live provider smoke tests (network; npm run test:live)
FastighetsRadar dashboard complete/   Approved design export – untouched reference
```

## Run locally

Requirements: Node.js ≥ 20.11 (developed on 24), npm ≥ 10. PostgreSQL 16 + PostGIS via Docker for the API.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in the Clerk development pair (`NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY`, `CLERK_SECRET`), `GEOAPIFY_API_KEY`
(server-side address search) and `NEXT_PUBLIC_GEOAPIFY_MAP_KEY` (a **separate**, origin/referer-restricted Geoapify key
for map tiles – the build refuses to reuse the server key). Without a map key the maps work but show no tiles.
Map style: `NEXT_PUBLIC_MAP_STYLE` (default `positron`). Details: `IMPLEMENTATION_PROGRESS.md` → Agent 2.5.

```bash
npm run services:up
```

```bash
npm run db:migrate
```

```bash
npm run dev:api
```

```bash
npm run dev
```

Open http://localhost:3000 (sign-up → create organization → Add Property). The design reference with
fixtures is at http://localhost:3000/demo/overview when `FASTIGHETSRADAR_DEMO_ENABLED=true`.

```bash
npm run design:reference
```

## Quality gates

```bash
npm test
```

```bash
npm run lint && npm run typecheck && npm run build
```

Live provider smoke tests (network, not part of `npm test`):

```bash
npm run test:live
```

Real-database integration suite (inside the pod, against `fastighetsradar_test` only):

```bash
node node_modules/tsup/dist/cli-default.js --config tsup.deploy.config.ts && node scripts/run-real-db-tests.mjs
```

## Deploy to InstaPods (`f-radar` only)

Requires `INSTAPOD_TOKEN` in `.env`. The scripts refuse to touch any other pod.

```bash
node scripts/deploy-pod.mjs
```

The script builds (tsup bundles + Next.js standalone), assembles `.deploy/release`, scans it for secrets,
uploads to `/home/instapod/app-next`, runs migrations, swaps `app` ↔ `app-next` (previous release kept in
`app.prev`), sets only the required runtime env vars, restarts the `app` service and health-checks.

Useful operations (on Git Bash set `MSYS_NO_PATHCONV=1`):

```bash
node scripts/instapods.mjs logs 200 app
```

```bash
node scripts/instapods.mjs exec -- sudo systemctl restart app
```

```bash
node scripts/instapods.mjs exec -- sh -c "cd /home/instapod && rm -rf app.bad && mv app app.bad && mv app.prev app && sudo systemctl restart app"
```

(the last command rolls back to the previous release)
