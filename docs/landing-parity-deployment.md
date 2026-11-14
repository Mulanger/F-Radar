# Driftsättning av landing-parity-live

Godkänd av ägaren 2026-11-14 efter den ursprungliga merge-verifieringen. Den tidigare
grenspärren får anpassas och huvudkatalogens `.env` får läsas för befintliga nycklar.
Alla arbetsfiler ändras fortsatt enbart i `.worktrees/landing-merge`.

## Förkontroll

Podd `f-radar`, `https://f-radar.fr-2.instapods.app`, svarade ready med release `e46b1bf`.
PostgreSQL hade migrationerna 0001–0007; samtliga sju kontrollsummor matchade releasefilerna.
Inga äldre migrationer ändras. Den lokala tomdatabaskörningen applicerade 8 migrationer,
därefter 0, med godkända kontrollsummor; PostgreSQL/PostGIS-integrationerna gav 23/23.

Efter tillgång till befintliga nycklar och verklig kontaktväg är hela liveprovningen grön:

| Svit | Godkända | Överhoppade |
|---|---:|---:|
| Vitest med lokal databas | 328 | 0 |
| node:test PostgreSQL/PostGIS | 23 | 0 |
| node:test deployregler | 8 | 0 |
| environment.live.test.ts | 3 | 0 |
| history.live.test.ts | 15 | 0 |
| providers.live.test.ts | 13 | 0 |

## Kontakt och miljö

MET Norway kräver ingen nyckel. Kontaktvägen är
`https://github.com/Mulanger/F-Radar/issues`: repot är publikt och issues är öppna.
Den anges i `MET_NORWAY_CONTACT` och skickas i User-Agent enligt
[MET Norways identifieringskrav](https://api.met.no/doc/FAQ#general-api-use).
Ingen tillfällig brevlåda eller påhittad kontakt har skapats.

Runtime-miljön hämtas från podden och bevaras, inklusive Clerk-nycklar, tillåtna origin,
Trafikverket, andra aktiverade källor och alla SMS-gränser. Lokala utvecklingsnycklar får
inte ersätta poddens inloggningsinstans. Den ignorerade worktree-filen `.env` använder
samma Clerk-konfiguration för webbbygget som podden redan kör.

Avsiktliga tillägg:

- `SOURCE_MET_NOWCAST_ENABLED=true`, med ovanstående kontaktväg.
- `SOURCE_SGU_OBSERVED_ENABLED=true` för den nya SGU-kopplingen.
- `SOURCE_SL_DEVIATIONS_ENABLED=false` uttryckligen; SL aktiveras aldrig av releasen.

Vid förkontrollen var havsvattenstånd och hydrologi avstängda genom befintliga standardvärden;
de förblir avstängda. Deras livekod, historik och UI behålls i releasen. SMS förblir
disabled/simulated/dry-run, utan godkännande för riktiga utskick.

## Release och återställning

`scripts/deploy-pod.mjs` godkänner nu även `codex/landing-parity-live`. Main och andra grenar
stoppas fortfarande. Skriptet kräver en ren commit och att den inkluderar aktuell livecommit.
Byggen körs direkt med node, utan npm-binlänkar. Spårade `.env`-filer tas bort ur paketet och
hemlighetsskanning måste godkännas före uppladdning.

Miljö och release kontrolleras igen före serverändringar. En exakt serverkopia av app.env
sparas med dess ursprungliga rättigheter. Migrationerna körs före appbytet. Den nuvarande
appen sparas som `app.prev`; en äldre sådan kopia arkiveras med tidsstämpel.

Efter bytet krävs en ny systemd-process, API ready och HTTP 200 från inloggningssidan.
Vid fel återställs appen och den exakta miljöfilen automatiskt, följt av en ny hälsokontroll.
Migration 0008 är additiv och behålls även vid återställning av applikationen.

Efterkontrollen ska dessutom kontrollera migrationsregistret, jobbstatus, att SMS/Clerk
är oförändrade, att SL är av och att den publika startsidans desktop- och mobiltexter är rättade.
Ingen annan podd får beröras. Hemliga miljökopior stannar i ignorerade lokala filer eller
serverns skyddade backupfil och ingår aldrig i git eller releasearkivet.
