# Verifiering av migration 0008 och landing-sammanslagningen

Verifierad 2026-11-14 i `D:\F-Radar\.worktrees\landing-merge`, gren
`codex/landing-parity-live`. Livebas: `e46b1bf`; merge-förälder: `771532e`.
Huvudkatalogens arbetsfiler och andra worktrees har inte ändrats.

## Lokal PostgreSQL/PostGIS

- Befintligt WSL Ubuntu-kluster **fr-parity-audit**, endast lokal anslutning på **55432**.
- PostgreSQL **16.15**, PostGIS **3.4.2**, GEOS 3.12.1, PROJ 9.4.0.
- Ny isolerad databas: **fr_landing_merge_20261114_test**, UTF-8.
- Före migrationsprovet: **0 tabeller** i public-schemat. Inga kunddata eller API-nycklar.

| Kontroll | Resultat |
|---|---|
| Första körningen med repositoryts migrationsrunner | **8 applicerade**, 0001–0008 i ordning |
| Andra körningen i samma databas | **0 applicerade**, alla **8** kontrollsummor godkända |
| Migrationerna 0001–0007 | Oförändrade mot livebasen e46b1bf |
| CHECK på property_context.data_class | Samtliga tidigare klasser behålls, MODEL tillkommer |
| Nya source_catalog-id:n | sgu_observed_groundwater och sl_deviations; ON CONFLICT skyddar befintliga poster |
| Separata databasintegrationer (node:test) | **23/23**, 3 sviter, inga överhoppade |
| Hela Vitest-sviten med databasfallen aktiverade | **328/328**, 40 testfiler, inga överhoppade |
| Typkontroll | Alla 6 paket/appar godkända, direkt via node/tsc |
| Lint | Godkänd, direkt via node/eslint |
| Produktionsbygge | Next.js och tsup (API, migration CLI, databastester) godkända |

Migration 0008 krockar inte med schemaobjekten från 0005–0007. Den skapar
`station_observation_history` och utökar det befintliga CHECK-villkoret från 0003 med MODEL.
Alla fem klasser som kontextkoden skriver testas mot riktig PostgreSQL:
FORECAST, MODEL, OBSERVATION, STATIC_GEODATA och REGIONAL_STATISTIC.
OFFICIAL_WARNING och PUBLIC_EVENT skrivs till händelsetabeller, inte property_context.
Befintliga SGU HYPE-poster klassas om till MODEL av 0008; ingen äldre migration ändras.

Stationstesterna verifierar originalprecision (5,01), unit/extra, stationsavstånd,
reviderade timmar utan dubblett, att äldre data inte flyttar tillbaka senaste värdet,
organisations-/fastighetsavgränsning och rensning efter sju dagar. De sex riktiga databasfallen
använder en transaktion som rullas tillbaka. Den separata integrationssviten återställer endast
sin uttryckligt valda databas med suffixet _test och provar även oförändrad SMS-simulering,
inloggningsavgränsning, historik, jobbleasing och geografisk matchning.

`observation_history` från liveversionen bevaras med 35 dygns retention. Indexets separata
7-dygnshistorik behöver originalprecision, enhet och metadata för varje timme; se
[ADR 0007](decisions/0007-luftkvalitetsindex.md). Det är avsiktligt att samma luftmätning kan
förekomma i båda tabellerna med olika kontrakt. Ingen extra vattenhistorik införs.

## Antal godkända Vitest-fall

| Paket/app | Godkända |
|---|---:|
| packages/config | 6 |
| packages/domain | 89 |
| packages/db | 15 (inklusive 6 mot riktig databas) |
| packages/integrations | 77 |
| apps/api | 50 |
| apps/web | 91 |
| Totalt | **328** |

## Liveprov mot offentliga API:er

| Svitsfil | Godkända | Överhoppade |
|---|---:|---:|
| environment.live.test.ts | 2 | 1 |
| history.live.test.ts | 15 | 0 |
| providers.live.test.ts | 11 | 2 |
| Totalt | **28** | **3** |

Inga fel. De två Trafikverket-proven (Situation och vägfärjor) hoppades över eftersom
TRAFIKVERKET_API_KEY saknas i denna worktree. MET Norway-provet hoppades över eftersom
MET_NORWAY_CONTACT saknas. Befintliga kontrakts- och fixturtester för dessa källor är gröna.
SL aktiverades inte. Bland godkända liveprov finns havsvattenstånd **parameter 14, cm RW**,
hydrologi, korrigerade SMHI-arkiv, SGU-observationer och alla fem luftämnen med stationsindex.
Första liveförsöket nekades nätverk av sandlådan; den redovisade körningen gjordes med nätverksåtkomst.

## Granskning av startsidan och livefunktionerna

Mobilens struktur och CSS-klasser har behållits. CSS-filen och `smhi/ocobs.ts` är oförändrade
mot e46b1bf. Desktop- och mobiltexter, inklusive MOBILE_FEATURE_ITEMS, granskas i samma
renderade DOM-test. Startsidan saknar översvämningsgräns, källarrisk, VMA-avstånd, 1 km-radie,
SL-färjor, 26 Bra och områdesfilterlöftet. Demot saknar också gränslinjen; dess källarriskruta
behålls som tidigare illustration. Inga rester av den borttagna alternativa havsadaptern eller
konfliktmarkeringar finns i arbetskopians källfiler. Liveversionens RH2000-enum och presentation
behålls som del av det befintliga kontraktet; den insamlade havsserien är enbart RW.

## Driftsättning och begränsningar

Ingen driftsättning görs. `scripts/deploy-pod.mjs` tillåter endast
`codex/phase4-sms-notifications` eller detached HEAD och blockerar därför den begärda grenen.
Spärren och skriptet är oförändrade; ingen detached checkout eller alternativ publiceringsväg används.

Enligt kommandoutdata i chatten ”Add Fastighetshistorik-vy” driftsattes e46b1bf med
`.deploy/stage-mobile-web.mjs` och `.deploy/publish-mobile-web.mjs`. Det var en webbuppdatering:
hemlighetsskanningen var ren, API/migrationer/runtime-konfiguration var undantagna, API blev ready
och startsidan svarade 200. Webbens återställningskopia låg i
`/home/instapod/web-prev-mobile3a-e46b1bf`. Den metoden verifierar inte den här fullständiga releasen.

Den aktuella worktreen saknar både .env och INSTAPOD_TOKEN; poddklienten bekräftar att token saknas.
Poddens aktuella miljövariabler, körande jobb, RELEASE, faktiska produktionsschema, migration 0008
samt startsidan efter en ny release har därför inte verifierats. Ingen poddmiljö, SMS-konfiguration,
inloggning eller återställningskopia har ändrats. Hälsokontroll och rollback efter ny release är
inte aktuella eftersom inget har publicerats.

Node-pg 8 ger sin befintliga deprecationsvarning om köade SELECT på samma Client i transaktionstesterna;
alla databasfall är gröna. Ingen pg-uppgradering eller beteendeändring görs för att dölja varningen.

## Reproducera lokalt

Kör från denna worktree, med den isolerade testdatabasen:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/fr_landing_merge_20261114_test'
node --import tsx --test --test-reporter=spec tests/integration/real-db.test.ts
node node_modules/vitest/vitest.mjs run
node node_modules/vitest/vitest.mjs run --config vitest.live.config.mts
node node_modules/eslint/bin/eslint.js .
# Från vart och ett av packages/* och apps/*:
node ../../node_modules/typescript/bin/tsc --noEmit -p .
```

Den separata node:test-sviten återställer testdatabasen. Kör den före Vitest och aldrig parallellt
mot samma databas. Använd aldrig en produktionsanslutning för dessa prov.
