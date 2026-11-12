# Data sources

The machine-readable manifest is `packages/integrations/src/sources/manifest.ts`
(IMPLEMENTATION.md §3.3). This page summarises the state after Phase 0/1.

**No adapter is implemented yet.** Every source reports `not_implemented`, `pending_access`
or `disabled` via `GET /v1/sources/status`. Nothing reports `ok` until a real fetch succeeds.
All entries have `displayPermitted=false` / `alertsPermitted=false` until licence review.

| ID | Authority | Access | Phase-1 status (default env) | Notes |
|---|---|---|---|---|
| `smhi_forecast` | SMHI SNOW1gv1 | public | not_implemented | Point forecast, not indoor values |
| `smhi_warnings` | SMHI IBWW | public | not_implemented | Unaltered official text + attribution |
| `smhi_observations` | SMHI MetObs | public | not_implemented | Show station distance/time |
| `smhi_oceanography` | SMHI | public (unverified) | not_implemented | **Not in IMPLEMENTATION.md §3** – the design shows sea level ("Saltsjön +38 cm"). Endpoint/terms must be verified. |
| `krisinformation` | Krisinformation v3 | public | not_implemented | County-level → "regional information" |
| `air_quality` | Naturvårdsverket/SMHI | public | not_implemented | Station-based; no building AQI |
| `sgu_groundwater` | SGU | public | not_implemented | Observed vs regional model kept separate |
| `mcf_flood` | MCF | legal_review | disabled (`MCF_FLOOD_ENABLED=false`) | Static scenarios only |
| `scb` | SCB PxWeb v2 | public | not_implemented | Context only |
| `trafikverket` | Trafikverket | requires_key | disabled → pending_access when enabled without key | |
| `geoapify_geocoding` | Geoapify | requires_key | pending_access | Primary geocoder; manual pin fallback |
| `lantmateriet_address` | Lantmäteriet | requires_approval | disabled | Optional, never blocking |
| `boverket_energy` | Boverket | disabled | disabled | Off until written clearance |
| `sms_46elks` | 46elks | requires_key | disabled | Dry-run only; live sending not implemented |

## Design sources not covered by IMPLEMENTATION.md

The approved design's demo data references labels that have no adapter/manifest entry:
"SLB-analys" (mapped to `air_quality` in fixtures), "Radar", "Stockholm Vatten",
"Nacka kommun", "Räddningstjänsten", "SL Trafikinfo", "Länsstyrelsen". In fixtures these are
`demo_other` (or the nearest planned source). Each needs a product decision before it can be
shown with live data.
