# Data sources

Machine-readable manifest: `packages/integrations/src/sources/manifest.ts`. Runtime health:
`GET /v1/sources/status` (authenticated) – configuration status merged with collector job health
(`provider_jobs`). A source reports `ok` **only** after a successful real fetch inside its freshness window.

Last verified against the live APIs: **2026-11-13** (Agent 3, Phase 3). `displayPermitted` /
`alertsPermitted` remain `false` in the manifest until a formal licence review is recorded; the dashboard
shows the data with attribution, and no alerts/SMS are sent.

## Provider completion matrix

| Provider | Source id | Data class | Status | Evidence |
|---|---|---|---|---|
| SMHI SNOW1gv1 point forecast | `smhi_forecast` | FORECAST | **Working and live-tested** | fixture tests, live smoke test, running on f-radar (every 15 min tick, 60 min per point) |
| SMHI IBWW warnings | `smhi_warnings` | OFFICIAL_WARNING | **Working and live-tested** | 28 warning areas ingested on first run; PostGIS polygon matching tested on real DB |
| SMHI IBWW county polygons | (reference data) | – | **Working and live-tested** | 21 counties in `admin_areas` |
| SMHI MetObs | `smhi_observations` | OBSERVATION | **Working and live-tested** | 1 014 station values / run (6 parameters) |
| Krisinformation v3 (news + VMA) | `krisinformation` | PUBLIC_EVENT / OFFICIAL_WARNING (VMA) | **Working and live-tested** | 2 news items live; VMA path covered by fixture tests (no active VMA during verification) |
| Trafikverket Situation | `trafikverket` | PUBLIC_EVENT | **Working and live-tested** | 16 deviations within 2 km of current properties |
| Air quality (SMHI datavärd luft, 52°North) | `air_quality` | OBSERVATION (preliminary) | **Working and live-tested** | 169 station values / run, ~145 s per run (slow upstream) |
| SGU groundwater – HYPE model areas | `sgu_groundwater` | OBSERVATION (model) | **Partially supported** | Modelled percentiles per 4×4 km area work live; SGU *observed* station levels are not integrated yet |
| MCF översvämningskartering (WFS) | `mcf_flood` | STATIC_GEODATA | **Working and live-tested** | Uppsala/Fyrisån hits all 3 scenarios; Stockholm property: no mapped area within 1 km |
| SCB PxWebApi v2 (TAB628) | `scb` | REGIONAL_STATISTIC | **Working and live-tested** | Stockholm 0180: population, density, land area (2025) |
| SMHI oceanography (sea level) | `smhi_oceanography` | OBSERVATION | **Not implemented** | Shown in the approved design; endpoint/terms not verified |
| Geoapify geocoding | `geoapify_geocoding` | – | Working and live-tested (Agent 2) | onboarding only |
| Lantmäteriet address | `lantmateriet_address` | – | **Disabled pending authorization** | requires approval + credentials |
| Boverket energy declarations | `boverket_energy` | – | **Disabled pending authorization** | requires written clearance |
| 46elks SMS | `sms_46elks` | – | **Disabled pending authorization** | dry-run only; no SMS can be sent |

## Per-provider details

### SMHI SNOW1gv1 – point forecast
* **Endpoint:** `{SMHI_FORECAST_BASE_URL}/category/snow1g/version/1/geotype/point/lon/{lon}/lat/{lat}/data.json` (coordinates rounded to 4 decimals).
* **Schema (verified):** `referenceTime`, `createdTime`, `geometry` (model grid point), `timeSeries[]` with `time`,
  `intervalParametersStartTime`, `data{…}`. 81 steps: hourly first, then 6 h and 12 h. `9999` = missing.
  Precipitation (`precipitation_amount_mean`) is the **total over the interval** in mm.
* **Cadence:** model run hourly (`Cache-Control: max-age=3600`). Collected per property point when older than ~58 min
  (identical points within ~100 m share one request). Max 40 properties per run; more → re-run after 30 s.
* **Derived values (documented):** current hour = step whose interval contains *now*; *24 h precipitation* =
  sum of interval totals over the next 24 h (pro-rated for partial overlap; `null` if any interval is missing).
  Shown as **forecast**, never as a measurement. Forecast older than 6 h is not shown as current.
* **Licence/attribution:** SMHI open data, CC BY 4.0 – "Källa: SMHI".

### SMHI IBWW – impact-based warnings
* **Endpoint:** `SMHI_WARNINGS_URL` (`…/ibww/api/version/1/warning.json`); counties from `…/metadata/area.json`.
* **Schema:** warnings → `warningAreas[]` with `warningLevel.code` (`MESSAGE|YELLOW|ORANGE|RED`), `approximateStart/End`,
  `published`, `descriptions`, GeoJSON `area` (EPSG:4326 Polygon/MultiPolygon).
* **Normalisation:** one event per warning area (`externalId = warningId:areaId`). Level Yellow/Orange/Red →
  severity monitor/warning/critical; MESSAGE → level `Info` (shown, but never changes property status).
  Official text is stored and shown **unaltered**. Areas without geometry or with unknown levels are skipped (counted).
* **Matching:** `ST_Intersects(warning polygon, property point)`.
* **Lifecycle:** versioned by content hash; removed from the feed → `ended (removed_from_feed)`; `approximateEnd` passed →
  `ended (valid_to_passed)`. A failed fetch never ends anything.
* **Cadence:** every 5 min (one request for the whole country). Freshness window 20 min.
* **County polygons:** 21 `SWE_COUNTIES` areas (`id` = official county code) stored in `admin_areas`, refreshed weekly.
  They are generalised shapes (fine for county assignment, not for boundary-precise use).

### Krisinformation v3
* **Endpoints:** `/v3/news?format=json&allcounties=true`, `/v3/vmas?format=json`. `/v3/features` is evergreen
  preparedness content and deliberately not collected.
* **Classification:** news → PUBLIC_EVENT (severity `info`, "regional information – not a local incident");
  VMA → OFFICIAL_WARNING (level `VMA`, severity `critical`). Items without any area are skipped.
* **Matching:** county name (property county via `ST_Covers` on the county polygons), `'*'` (whole country) or
  municipality name. No distance is shown.
* **Cadence:** every 10 min. Freshness window 40 min.

### Trafikverket (Situation, road.trafficinfo 1.6)
* **Endpoint:** `POST https://api.trafikinfo.trafikverket.se/v2/data.json` with an XML query; up to 20 property points
  OR-ed per request (`WITHIN … radius="2000m"` on `Deviation.Geometry.Point.WGS84`). Key in `TRAFIKVERKET_API_KEY`,
  enabled by `TRAFIKVERKET_ENABLED=true`; the key is never logged.
* **Normalisation:** one PUBLIC_EVENT per Deviation (`Id`), WKT line (preferred) or point geometry, `MessageCode` +
  `LocationDescriptor` as headline, `SeverityCode` 1–5 → info/monitor/warning (traffic never becomes `critical`).
* **Matching:** `ST_DWithin(geometry, point, 2 km)` with exact distance to the closest point of the line.
  (5 km produced ~50 events around central Stockholm – too noisy.) The portfolio feed only lists traffic changes
  of severity `warning`; all matched events are listed on the property page.
* **Cadence:** every 5 min.

### SMHI MetObs
* **Endpoint:** `{SMHI_OBSERVATIONS_BASE_URL}/version/1.0/parameter/{p}/station-set/all/period/latest-hour/data.json`.
* **Parameters:** 1 temperature, 4 wind speed, 21 gust, 3 wind direction, 6 RH, 7 precipitation (1 h).
* **Storage:** latest value per station/parameter in `observation_stations` (central). Per property: nearest station
  with a value from the last 3 h (`ORDER BY location <-> point`), max 50 km, with distance, time and quality code
  (`G` controlled, `Y` suspect/aggregated).
* **Cadence:** every 30 min.

### Air quality (SMHI datavärdskap luft – 52°North)
* **Endpoint:** `{AIR_QUALITY_BASE_URL}/timeseries?phenomenon={id}&expanded=true` for PM2.5 (6001), PM10 (5), NO₂ (8), O₃ (7).
* **Findings:** very slow (17–60 s per phenomenon) → hourly, sequential, 120 s timeout per request. Series older than
  24 h are dropped; hourly series preferred. Values are **preliminary**.
* **Matching:** nearest station with a value from the last 6 h, max 25 km, with station name and distance.
* **No AQI is computed** (no documented, approved method). The "Air Quality" index field stays "—".

### SGU groundwater (HYPE model areas)
* **Endpoints:** `{SGU_REGIONAL_GROUNDWATER_BASE_URL}/collections/omraden/items?bbox=…` (area id),
  `…/collections/grundvattennivaer-tidigare/items?filter-lang=cql-text&filter=omrade_id=<id> AND datum>='…'`.
* **Meaning:** `fyllnadsgrad_*` = percentile vs all modelled levels; `grundvattensituation_*` = percentile vs the same
  time of year; `_sma`/`_stora` small/large magazines; `-1` = not applicable (shown as "Ej tillämpligt").
* **Caveat shown in UI:** regional 4×4 km model, not a measurement at the building. Series lags a few days.
* **Cadence:** each property every 12 h. Observed SGU stations (`grundvattennivaer-observerade`) are **not** integrated
  (nearest observed station is often > 5 km away; follow-up).

### MCF översvämningskartering (WFS)
* **Endpoint:** `https://inspire.msb.se/oversvamning/ows` (WFS 2.0), layers `NZ_Oversvamning_100`, `_200`, `_BHF`.
* **Findings:** features are huge multipolygons (76 nationwide for the 100-year layer); geometry is never downloaded.
  The plain `bbox=` parameter and `INTERSECTS(point)` returned no hits; a CQL `BBOX(geom, lon/lat…, 'EPSG:4326')` works.
* **Method:** per scenario, one query with a 1 km box; only on a hit, narrow down with 15/100/250/500 m boxes.
  "Inside" = intersects the 15 m box (address points are not exact). Exposure class mapping (documented, not a score):
  inside 100-year area → High, inside 200-year → Medium, inside BHF only → Low, otherwise `unknown`.
* **Coverage caveat shown in UI:** only selected watercourses are mapped; "nothing within 1 km" does **not** mean no risk.
  Static scenario data – never an alert, never a current water level.
* **Cadence:** each property weekly and whenever its pin moves.

### SCB PxWebApi v2
* **Base:** `https://statistikdatabasen.scb.se/api/v2` (apiVersion 2.3.2; `/config`: 30 calls / 10 s, 150 000 cells, CC0).
* **Table:** `TAB628` (Befolkningstäthet, folkmängd och landareal efter region), latest year, both sexes.
* **Region code:** municipality name from geocoding ("Stockholms kommun") mapped to the 4-digit code via the table metadata.
* **Use:** context only (REGIONAL_STATISTIC) – never alerts or assessments. Re-checked weekly.

## Retention (job `retention`, daily)

| Data | Kept |
|---|---|
| Point forecasts | latest run per property only (overwritten) |
| Station observations | latest value per station/parameter; stations silent > 2 days deleted |
| Warnings / events | while active; ended/cancelled events deleted 7 days after ending |
| Change log (`monitoring_changes`, future SMS input) | 30 days |
| Collector runs (`integration_runs`) | 14 days |
| Context (MCF/SGU/SCB) | latest per property; deleted with the property |

## Design sources not covered by any adapter

The approved design's demo data references "SLB-analys", "Radar", "Stockholm Vatten", "Nacka kommun",
"Räddningstjänsten", "SL Trafikinfo", "Länsstyrelsen". These exist only in demo fixtures (`demo_other`).

## Reference: documentation, auth, version, units, resolution, cache

| Source | Official documentation | Auth | API version | Units / fields used | Geographic resolution | Cache / refresh | Licence / attribution | Test result (2026-11-13) |
|---|---|---|---|---|---|---|---|---|
| SMHI SNOW1gv1 | https://opendata.smhi.se/metfcst/snow1gv1/ | none | snow1g v1 | °C, m/s, °, %, mm per interval, %; `symbol_code` | model grid (~2.5 km), distance to grid point shown | latest run per property, refetch ≥ 58 min | CC BY 4.0 – "Källa: SMHI" | fixtures ✔, live ✔ |
| SMHI IBWW | https://opendata.smhi.se/warnings/ | none | ibww v1 | level code, event, area polygon, approximate start/end, official text | warning polygons | every 5 min, versioned | CC BY 4.0, text unaltered | fixtures ✔, live ✔, PostGIS ✔ |
| SMHI MetObs | https://opendata.smhi.se/metobs/ | none | 1.0 | °C, m/s, °, %, mm/h, quality G/Y | station (distance shown) | latest-hour sets every 30 min | CC BY 4.0 | fixtures ✔, live ✔ |
| Krisinformation | https://www.krisinformation.se/om-krisinformation.se/oppen-data/ | none | v3 | headline, preamble, area (county/municipality), published/updated, web | county / municipality | every 10 min | "Källa: Krisinformation.se" | fixtures ✔, live ✔ |
| Trafikverket | https://data.trafikverket.se/get-started | API key (`TRAFIKVERKET_API_KEY`) | v2, Situation schema 1.6 | MessageCode, SeverityCode 1–5, LocationDescriptor, Start/EndTime, WGS84 WKT | line/point, 2 km radius, exact distance | every 5 min | CC0 – "Källa: Trafikverket" | fixtures ✔, live ✔ |
| Air quality | https://www.naturvardsverket.se/amnesomraden/luft/ (datavärd luft, SMHI) | none | 52°North Timeseries API | µg/m³ (PM2.5, PM10, NO₂, O₃), preliminary | station (≤ 25 km) | hourly, sequential | "Källa: SMHI / Naturvårdsverket" | fixtures ✔, live ✔ |
| SGU HYPE | https://www.sgu.se/grundvatten/grundvattennivaer/ | none | OGC API Features v1 | percentiles 0–100 (`fyllnadsgrad_*`, `grundvattensituation_*`), −1 = n/a | 4×4 km model area | per property every 12 h | CC BY 4.0 – "Källa: SGU" | fixtures ✔, live ✔ |
| MCF flood mapping | https://www.mcf.se/sv/verktyg--tjanster/oversvamningsportalen/ | none | WFS 2.0 (GeoServer) | scenario layer hit/miss, `beginlifespanversion` | mapped watercourse polygons, probed at 15 m–1 km | per property weekly / on move | "Källa: MCF Översvämningsportalen" (terms to confirm) | fixtures ✔, live ✔ |
| SCB | https://www.scb.se/vara-tjanster/oppna-data/pxwebapi/pxwebapi-v2/ | none | PxWebApi 2.3.2 | persons, inv/km², km² (TAB628) | municipality | per property weekly | CC0 – "Källa: SCB" | fixtures ✔, live ✔ |
