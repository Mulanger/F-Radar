# Verifiering av migration 0005 mot PostgreSQL/PostGIS

Verifierad 2026-11-14 på `codex/landing-data-parity`, efter `dd933f4` och `8a71d10`.
Ingen produktionsdatabas, f-radar-podd eller `scripts/instapods.mjs` användes.

## Lokal databas

Docker och en Windows-installation av PostgreSQL saknades. I den befintliga lokala WSL-distributionen
Ubuntu 24.04.4 installerades PostgreSQL och PostGIS från Ubuntus paketförråd:

- PostgreSQL **16.15** (`16.15-0ubuntu0.24.04.1`), 64 bit.
- PostGIS **3.4.2**, GEOS 3.12.1, PROJ 9.4.0.
- Separat kluster **fr-parity-audit**, endast `127.0.0.1:55432`, manuellt startat.
- Ny databas **fr_parity_20261114_test**, UTF-8. Inga kunddata eller sparade API-nycklar användes.

## Resultat

| Kontroll | Resultat |
|---|---|
| Tom databas före körning | 0 tabeller i public-schemat |
| Första migrationskörningen | **5 applicerade**, 0001 → 0002 → 0003 → 0004 → 0005 |
| Andra körningen, samma databas | **0 applicerade**; samtliga **5 kontrollsummor godkända** |
| Befintliga verkliga databasintegrationer, `tests/integration/real-db.test.ts` | **21/21 godkända** i avslutande ordinarie körning |
| Databaspaketets tester, `packages/db/test` | **13/13 godkända**, varav **6 nya tester mot riktig PostgreSQL/PostGIS** i station-history.test.ts |
| Hela Vitest-sviten med riktiga databasfallen aktiverade | **233/233 godkända**, 23 testfiler; inga överhoppade databasfall |
| Lint | Godkänd |
| Typkontroll, alla workspaces | Godkänd |
| Migrationerna 0001–0004 | Oförändrade; kontrollsummor verifierade mot riktiga migrationsregistret |

De centrala kontrollerna kördes dessutom direkt med den **committade** migrationsrunnern och
`monitoring.ts`, extraherade från HEAD utan arbetskopians andra ändringar. Runnern applicerade 5
migrationer, sedan 0. Den committade repository-koden skrev en station med en färsk och en åtta dagar
gammal observation. `loadOrgMonitoring` läste tillbaka originalvärdet **5,01** och korrekt station med
0 m avstånd. `applyRetention` minskade historiken från **2 till 1 rad** och behöll det färska värdet.
Dessa provdata skrevs i en transaktion som rullades tillbaka.

De nya riktiga stationstesterna verifierar även korrigering av samma timme utan dubblett, att ett äldre
värde inte flyttar tillbaka senaste observationen, organisations-/fastighetsavgränsning och att
`MODEL` accepteras för SGU-kontext efter migration 0005. Testernas egna data och rensningar rullas
tillbaka på samma anslutning. De kräver uttryckligen `TEST_DATABASE_URL` på loopback, ett databasnamn
som slutar på `_test` och inga URL-parametrar som kan byta värd. Vanlig körning utan variabeln förblir offline.

## Ändringar inom uppgiften

- `packages/db/test/station-history.test.ts`: behåller de tre befintliga SQL-kontraktstesterna och
  lägger till sex opt-in-tester med riktig databas.
- `tests/integration/real-db.test.ts`: lägger historiktabellen i testsvitens befintliga schemaåterställning,
  så att sviten kan köras igen efter migration 0005. Ingen produktionskod eller migrations-SQL ändrades.
- Källdokumentation och tidigare slutrapport länkar till denna uppföljning.

En första körning av den bredare integrationssviten gav **18/21**: tre befintliga SMS-simuleringstester
fick `not_eligible` eller saknad simulerad användning i stället för förväntad status/räknare. En
diagnostisk omkörning och därefter en **ordinarie omkörning utan diagnostik** gav båda **21/21**.
Orsaken till det intermittenta utfallet är inte fastställd. Ingen SMS-kod, telefonverifiering,
inloggning, SL-konfiguration eller licensflagga ändrades för att få testerna att passera.

Node-pg 8 gav en deprecationsvarning när repository-funktionen köar flera SELECT på samma Client
i transaktionstesterna. Frågorna exekverades och alla kontroller godkändes; ingen pg-uppgradering ingår.

## Körning av testerna

Mot det isolerade lokala klustret (inga lösenord eller nycklar i repot):

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/fr_parity_20261114_test'
node --import tsx --test --test-reporter=spec tests/integration/real-db.test.ts
node node_modules/vitest/vitest.mjs run packages/db/test --reporter=verbose
npm test -- --reporter=dot
npm run lint
npm run typecheck
```

Integrationssviten återställer endast den angivna testdatabasen. Använd aldrig en produktionsanslutning.
Arbetskopians tidigare ocommittade ändringar jämfördes med en sparad kopia och är oförändrade;
de ingår inte i uppgiftens commit.
