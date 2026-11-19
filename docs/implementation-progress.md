# Implementation progress

The authoritative progress log is [`/IMPLEMENTATION_PROGRESS.md`](../IMPLEMENTATION_PROGRESS.md)
at the repository root.

| Phase | Owner | Status | Blockers |
|---|---|---|---|
| 0 – Repo/design inventory | Agent 1 | Done | – |
| 1 – Project infrastructure | Agent 1 + 2 | Done – PostgreSQL 16 + PostGIS 3.4 on the f-radar pod, migrations verified | Redis/BullMQ not provisioned (not needed yet) |
| 2 – Auth, organisations, properties | Agent 2 | Done on a Clerk **development** instance; deployed to https://f-radar.fr-2.instapods.app | Production Clerk instance (clerk.f-radar.se) needs DNS + domain on the pod |
| 2.5 – Geoapify maps & stabilization | Agent 2.5 | Done – Geoapify `positron` tiles live, regression verified, ready for Phase 3 | Tile referer restriction not enforced by provider (monitor usage) |
| 3 – Geo engine, public data & monitoring | Agent 3 | Done – 9 providers collected centrally, PostGIS matching, live SSE dashboard on f-radar | smhi_oceanography not implemented; SGU observed stations partial |
| 4 – SMS rules and simulated delivery | Agent 4 | Done — application 1cd74ae deployed to f-radar; 132 regression + 21 DB + 9 live tests pass | Real sending deliberately locked; future verification channel/account activation separate |

## Prognosfält och kommande dygn (2026-11-13)

SMHI-serier sparas som v2; v1 läses med null för nya fält. Informativa trösklar och fem rullande dygn dokumenteras i ADR 0004. Riskindex v1 och SMS-regler är oförändrade.

## MET Norway nowcast (2026-11-13)

Fixture och identifierat live-rökprov godkända lokalt: `npm run test:live -- -t "MET Norway nowcast"` (1 passed). CC BY 4.0; Data från MET Norway, bearbetad av FastighetsRadar. Villkor: https://api.met.no/doc/TermsOfService. Kontaktwebbadress: https://f-radar.fr-2.instapods.app (f-radar.se är ännu inte registrerad; byt när domänen är i drift). Flaggan är false som standard, ingen produktionsaktivering. Cache och 304 verifieras i enhetstester; databasverifiering görs i slutsteget.

## Havsvattenstånd (2026-11-13)

SMHI OCObs parameter 14, cm RW. RW betyder Relative Water Level, relativt årets beräknade medelvattenstånd. Parameter 13 avser RH 2000 och används inte. Verifierat via parameterresurs, station 33097 (Göteborg-Hisingsbron) och SMHI:s officiella databeskrivning: https://www.smhi.se/data/sok-oppna-data-i-utforskaren/se-of-oceanografiska-observationer-havsvattenstand-rw-minutvarde och https://www.smhi.se/kunskapsbanken/oceanografi/vattenstand-i-havet/hojdsystem-och-vattenstand. Fixture och `npm run test:live -- -t "SMHI oceanography RW minute data"` godkända (1 passed). 600 s jobb, station inom 15 km, timtrend med 2 cm dödband. Flaggan avstängd som standard. Den dekorativa linjen ”Översvämningsgräns +60 cm” togs bort eftersom en stationsnivå inte anger byggnadens gräns.

## Vattenföring (2026-11-13)

SMHI HydroObs parameter 2, m³/s, alla 15-minutersvärden från latest-hour. Stationsnära månadsreferenser kan hämtas från corrected-archive/data.csv. Riktig fixture, parser-, percentil-, gränsvärdes- och matchningstester finns. Liveprov `npm run test:live -- -t "SMHI hydrology flow and corrected archive"`: 1 passed, 27 s; VÄSTERSEL (1583), tolv användbara månadsreferenser och mer än tre års data. Arkivet strömmas, bara G-värden används. Stationer inom 5 km kan få veckovis referenshämtning. Saknad referens ger ingen klassning. Parameter 3 används inte (station-set/latest-hour saknar användbar väg). Inget aktiverat i produktion.

## Historik och kvartsmätt nederbörd (2026-11-13)

Migration 0005 omfattar nowcast_points, hydrology_references/checks och observation_history, inklusive källkatalogens nya poster. Historik 35 dygn, hav nedsamplat till exakta 10 min; bara stationer nära aktiva fastigheter lagras. MetObs parameter 14 och alla värden i latest-hour samlas varje 15 min. Täckningskontrollerade summor 1/24/72 h och 6/24 h-trender visas utan ändrat riskindex. Se ADR 0004 för volym och avgränsningar.

Kommande-listan prioriterar kommande officiella perioder före härledda rader, därefter ton och tid. Nya rader visar källans uppdateringstid och förklaringen för växlande grader; långa värden radbryts på mobil.
# Fler avbrott i hela landet – 2026-11-19

- Egen gren `codex/avbrott-hela-landet`, egen worktree från `codex/landing-parity-live` / `e9945d5`.
- Fas 0 delvis: nationella kundunderlag/rangordningar, poddprov och fixtures sparade;
  [underlag](sources/utility-outages-2026-11-19/README.md). Fortsatt källutredning i respektive fas.
- Baslinje: 57 testfiler, 466 godkända och 6 överhoppade tester; alla workspace-typer och lint gröna.
  PostGIS: 32/32 via godkänt skript mot `fastighetsradar_test`, 0 anslutningar före körning.
- Produktägaren tillåter endast testskriptets testskrivningar i podden; inga produktionsändringar.
- Beslut: proxy-stöd utan serverinköp; behåll "El och värme"; kokningsrekommendationer enligt §2.3;
  kommande avstängningar enligt §5.6 bakom avstängd flagga; ingen Fas 7-implementation.
- Fas 0 commit `9ee7b22`.
- Fas 1: täckningsrapport i dator/mobil och tenantbundet API, lucksignal utan adresslogg,
  migration 0017, värdlåst proxy och pinnade mellanliggande CA-certifikat.
  Verifiering: 60 filer, 474 godkända/6 överhoppade, typer/lint gröna; PostGIS 33/33.
  API-build och webb-webpack-build passerar. Lokal Turbopack/standalone begränsas av externa junctions.
  Proxy saknas, ny TLS-kod ej provad i podden, inget aktiverat eller deployat.
- Fas 1 commit `78c82cb`.
- Fas 2 delvis: fyra nationellt prioriterade elnät, 335 510 abonnemang, potential 68,7677 → 74,7453 %.
  Fulla poddsvar normaliserade med 0 skipped, nya källor avstängda via egna flaggor.
  61 filer, 481 godkända/6 överhoppade; typer/lint gröna; PostGIS 33/33.
  Övriga elnät, aktiv Umeå-el och fler Skellefteå-statusar är inte färdigverifierade.
- Fas 2 commit `03417d8`.
- Fas 3: gemensam water/WaterSupply och noticeKind, migration 0018, VA-profiler och avstängda
  vatten-/gasflaggor. Kokningsklassificering/vatten-SMS följer i Fas 5. Utility-avgränsad debounce.
  64 filer, 492 godkända/6 överhoppade; typer/lint gröna; PostGIS 34/34.
  Koordinatlistor utan yta ger partial; ingen påhittad polygon eller falsk tomgång.

2026-11-19 Fas 4: Exergi, Vattenfall Värme, Solör och Umeå värme/kyla bakom avstängda flaggor.
Fulla poddsvar normaliseras utan skipped. Mälarenergi/Öresundskraft saknar ännu säker värmegeometri.
65 Vitest-filer, 496 godkända och 6 överhoppade; typer/lint gröna; PostGIS 34/34.
Ingen aktivering/deploy. Ny värme får inte antagen återställning.

2026-11-19 Fas 5: SVOA och Tekniska verken Water kopplade i samma pipeline, avstängda som standard.
Separata SMS-kategorier/spärrar (simulerat), strikt precision/färskhet, dedup och ett SMS-segment.
Inga antagna återställningar skickas. Nationell VA-utbyggnad och aktiva kokningsfall återstår.
67 filer/504 godkända/6 överhoppade, typer/lint gröna, PostGIS 35/35 efter ledighetskontroll.
