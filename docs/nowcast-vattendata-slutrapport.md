# Slutrapport – nowcast och vattendata

2026-11-13. Arbetet finns på `codex/nowcast-vattendata` i den separata worktreen `D:\F-Radar\.worktrees\nowcast-vattendata`, utgående från `fd711bc` på `codex/phase4-5-security-hardening`.

Huvudkatalogens ocommittade säkerhetsarbete har inte ändrats eller tagits med i dessa commits. Inget har pushats, ingen PR har öppnats och ingen produktionsdeploy eller aktivering har gjorts.

## Leverans per del

| Del | Commit | Resultat |
|---|---|---|
| 1 | `ac5280c` | Utökade SMHI-fält, lagringsversion v2 med v1-kompatibilitet, nya prognosrader, nederbördens min–max och fem rullande dygn. |
| A | `be98365` | MET Norway-adapter, databaslagrad gridcache, Expires/304, domänsammanfattning, radarstaplar och märken i tabell/lista. |
| 2 | `9574fde` | SMHI OCObs parameter 14 i RW, station inom 15 km, uppmätt trend och tydlig källa/mättid. |
| 3 | `ae1c88c` | SMHI HydroObs parameter 2, station inom 5 km, strömmad arkivhämtning och månadsreferenser P75/P95. |
| 4 | `f4a8c1f` | Närliggande stationshistorik i 35 dygn, 10-minuters havsvärden, 15-minuters nederbörd, täckningskontrollerade summor och längre trender. |
| Databasrättning | `d737282` | Explicit numerisk typning av radier i den nya spatialfrågan, verifierad med riktig PostGIS. |
| Slutjusteringar | `4e5bb8b` | Korrekt dygnsgräns för temperatur, första nederbördsperiodens topp/slut, tooltip med osäkerhetsintervall, källangivelser och mobilanpassning. |

Migrationen är `0005_nowcast_water_data.sql`; den lägger även in de nya källorna i `source_catalog`. ADR 0004 dokumenterar källor, trösklar, ordval, täckning, datavolym och avgränsningar. Källmanifest, `docs/sources.md`, `docs/implementation-progress.md` och `.env.example` är uppdaterade.

## Verifiering

* `npm run typecheck`: godkänt.
* `npm run lint`: godkänt.
* `npm test`: **259 tester godkända i 29 testfiler**, inklusive befintlig notifikationsmotor och utökad kontroll av förbjudna formuleringar.
* `npm run build`: godkänt för **API och webb**.
* Tre avgränsade `npm run test:live -- -t ...` kördes och godkändes: MET Norway nowcast; SMHI oceanografi RW; SMHI hydrologi inklusive corrected-archive. Övriga leverantörers liveprov kördes inte om.
* `node scripts/run-real-db-tests.mjs`, efter lokal bundling och från den rena separata worktreen: **22 av 22 godkända** på `fastighetsradar_test`, endast på `f-radar`. Testbundle och migrationer laddades upp; ingen `.env` skickades. Testerna omfattar faktisk migration, idempotenta historikinsättningar, närhetsfilter, retention, tenantavgränsning, cache/304 och befintliga notifikationer.
* Översikt och detaljsida granskades i Chrome med demodata vid **375 px och desktop**. Sidbredd och panelernas scrollbredder kontrollerades mot viewporten. Nya paneler och vattennivåns källrader granskades visuellt utan överlapp eller horisontellt sidöverflöde. Tillfälliga breddinställningar återställdes och lokala granskningsservrar stoppades.

Första real-DB-körningen hittade ett fel i den nya SQL-frågans typinferens för `CASE`-uttryckets radier. Det gav ett API-fel och följdfel i efterföljande tester. Efter explicit `double precision` och ett separat regressionstest gick hela sviten igenom; även slutkörningen efter slutjusteringarna var grön.

## Svar på frågorna

**MET-kontakt:** Ägaren bekräftade `https://f-radar.se`. Exempelkonfigurationen använder den via `MET_NORWAY_CONTACT`; privata kontaktuppgifter används inte. Saknad kontakt ger jobbstatus `skipped`. `SOURCE_MET_NOWCAST_ENABLED` är fortfarande false som standard. [MET Norways villkor](https://api.met.no/doc/TermsOfService) har lästs: identifiering, högst fyra decimaler, utspridda anrop under totalgränsen, cache enligt Expires, villkorade anrop samt CC BY 4.0 med källa, licenslänk och bearbetningsnotering är hanterade. Ingen Yr/MET/NRK-profilering har lagts till.

**Havets referenssystem:** Parameter **14 är cm RW**, relativt respektive års beräknade medelvattenstånd. RW betyder Relative Water Level. Parameter **13 avser RH 2000** och används inte. Verifierat mot parameterresursen, stationsresurs 33097 och SMHI:s [databeskrivning för RW-minutvärden](https://www.smhi.se/data/sok-oppna-data-i-utforskaren/se-of-oceanografiska-observationer-havsvattenstand-rw-minutvarde) samt [förklaring av höjdsystemen](https://www.smhi.se/kunskapsbanken/oceanografi/vattenstand-i-havet/hojdsystem-och-vattenstand). Den tidigare dekorativa texten ”Översvämningsgräns +60 cm” är borttagen, eftersom en stationsnivå inte anger en byggnads gräns.

**Flödesreferenser:** Ja. Liveprovet för VÄSTERSEL, station 1583, gav användbara referenser för samtliga tolv månader. Produktionsjobbet hämtar arkiv högst veckovis och bara för stationer nära bevakade fastigheter. Minst tre olika år och 30 olika mätdagar krävs per UTC-kalendermånad. Bara kvalitetskod G används i referenserna. Saknad eller för gammal referens ger ingen klassning. Stationen kan ligga i ett annat vattendrag; den upplysningen visas alltid.

**Befintliga critical-rader:** Vindbyar och dygnsnederbörd har lämnats oförändrade enligt uppdraget. Rekommendationen är att även dessa härledda prognosrader högst får tonen `warning`, genom ett separat produktbeslut. Nya härledda rader använder högst `warning`; kommande officiella varningsperioder prioriteras före härledd information.

## Begränsningar och vad som inte är gjort

Ingen körning av de nya insamlingsjobben mot produktionsdatabasen är verifierad. Produktionsmigration, verklig stationsmatchning för kundportföljen och resursförbrukning under lång drift återstår inför eventuell aktivering. Alla nya källflaggor är avstängda som standard; produktionskonfigurationen är orörd.

Historik samlas framåt och fylls inte automatiskt bakåt. Summeringar visas först när täckningen räcker; saknade värden blir aldrig noll. Havstrenden använder 6 h historik när den finns, annars senaste timmens minutvärden. Flödestrenden kräver 24 h historik. Femdygnsvyn visar rullande 24 h-fönster, och längre prognosintervall pro-rateras enligt dokumenterat antagande. Min–max för nederbörd är ett modellintervall, inte ett beräknat konfidensintervall för dygnssumman.

Riskindex v1 är oförändrat. Inga nya SMS-regeltyper, riktiga SMS eller händelserapporter per fastighet har lagts till. Inga betaltjänster, planuppgraderingar, Clerk Production-ändringar eller domänändringar har gjorts. Andra poddar har inte berörts.
