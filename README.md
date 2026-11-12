# FastighetsRadar

Adressbaserad bevakning av svensk offentlig data för fastighetsportföljer.
Plan: [`IMPLEMENTATION.md`](IMPLEMENTATION.md) · Progress: [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md) ·
Architecture: [`docs/decisions/0001-architecture.md`](docs/decisions/0001-architecture.md)

> The dashboard currently runs in **demo mode**: every value comes from labelled fixtures copied
> from the approved design. No public API is called and no SMS can be sent.

## Layout

```text
apps/web            Next.js dashboard (Portfolio Overview, Property Detail)
apps/api            Fastify API (health, source status)
packages/domain     Zod schemas, types, formatters, demo fixtures
packages/config     Server env validation, data-mode, SMS safety
packages/integrations  Source manifest + adapter interfaces/stubs (Geoapify, SMHI, …)
packages/db         PostGIS SQL migrations + runner
FastighetsRadar dashboard complete/   Approved design export – untouched reference
```

## Requirements

Node.js ≥ 20.11 (developed on 24), npm ≥ 10. Docker for PostgreSQL/PostGIS + Redis (optional for the dashboard).

## Commands

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev            # web on http://localhost:3000 (demo mode)
```

```bash
npm run dev:api        # API on http://localhost:4000 (/health/live, /health/ready, /v1/sources/status)
```

```bash
npm run design:reference   # original prototype on http://localhost:5050 for visual comparison
```

```bash
npm run services:up    # PostGIS + Redis via docker compose
```

```bash
npm run db:migrate     # apply SQL migrations (needs DATABASE_URL + running PostGIS)
```

```bash
npm test               # vitest (no network)
```

```bash
npm run lint && npm run typecheck && npm run build
```

## Data modes

`FASTIGHETSRADAR_DATA_MODE=demo` (default) renders the design with fixtures from
`packages/domain/src/fixtures`. `live` reads only from the API and shows an explicit
"unavailable" state until the portfolio endpoints exist – it never falls back to fixtures.
