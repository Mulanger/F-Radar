# Historik – leverans och verifiering

Verifierad lokalt 13–14 november 2026. Gren: `codex/historik`, separat worktree `.worktrees/historik`, bas `codex/nowcast-vattendata` vid `80de2ef`. Huvudkatalogens säkerhetsarbete är orört. Ingen push, PR, driftsättning eller ändring i Clerk Production har gjorts.

## Leverans

* URL-styrd Nu/Historik-kontroll i befintlig detaljlayout. Hero, WebGL och karta behålls. Historikvalet följer fastighetsväljaren.
* Perioder 30/90 dygn, rullande tolv månader och egna datum upp till 24 månader.
* Nyckeltal, nederbördsstaplar med månadsnormaler och versionstrogna varningsband, vatten, temperatur/frost och byvind. Luckor visas utan nollersättning.
* Timregn från lagrade kvartar för ett eller två dygn inom råhistorien. Tim- och SMHI-dygn blandas inte.
* Tidslinje med fem kategorier, källtext och versioner, samt tabellalternativ och CSV med station, avstånd, ursprung, datumdefinition, fastighetsid, matchningsperioder och källangivelse.
* Alla åtta demofastigheter har deterministiska syntetiska årsserier i det befintliga demots referensår. Nackas vind är uppgraderad gul–orange; Ulvsunda har VMA och ett syntetiskt flödesexempel. `historikexempel=luckor` respektive `historikexempel=tom` fungerar endast i demots dataflöde och märks tydligt i vyn.
* Migrering `0007_property_history.sql`; jobb `history_backfill` och `history_aggregate`. Endast en GET-rad är tillagd i BFF-allowlistan.

## Historiskt djup

| Datatyp | Tillgänglighet och begränsning |
| --- | --- |
| Myndighetshändelser | Från arkivets start, inklusive de matchningar som fortfarande finns vid migreringen. Avslutade matchningar/versioner har 24 månaders retention. Tidigare raderade händelser hittas inte på. |
| Nederbörd, temperatur, byvind | Upp till fem års stationstäckning från SMHI:s arkiv, med senaste perioden från `latest-months`. Vyn kan läsa högst 24 månader per anrop. Kräver kvalificerad station inom avståndsgränsen. |
| Hav och flöde | Upp till fem år där arkivet och närliggande station räcker. RW-timvärden respektive källans dygnsflöde. Nya dagar kommer från `latest-day` och, för hav, även egen insamling. |
| Detaljerat timregn | Högst de 35 dygn då kvartsdata finns kvar, och högst två valda dygn åt gången. Luckor efter driftstopp eller saknad rapportering finns kvar. |
| Nederbördsnormal | 1991–2020, minst 24 olika kompletta månadsår för aktuell kalendermånad och samma station. Saknas underlaget visas ingen jämförelse. |

## Genomförda kontroller

| Kontroll | Resultat |
| --- | --- |
| `npm run typecheck` | Grön i alla workspaces. |
| `npm run lint` | Grön. |
| `npm test` | 36 testfiler, **303 godkända tester**. |
| `npm run build` | API och optimerat Next-produktionsbygge gröna. |
| `npm run test:live` | **20 godkända**, ett överhoppat befintligt prov. Arkiven för 1, 2, 5, 19, 20, 21, 23, RW 12 och HydroObs 1 har lästs från SMHI. |
| Real PostgreSQL/PostGIS | **23 godkända tester** på enbart `f-radar`, databas `fastighetsradar_test`. Testpaketet byggdes med den angivna tsup-konfigurationen och kördes från denna worktree. |
| Migrering och initial fyllning | Själva 0007-migreringen körs också över redan existerande matchningar i ett isolerat schema, med återställning via rollback. |
| Isolering och livscykel | Andra organisationer får 404; läsning och radering är isolerade. Arkivet överlever källans sjudygnsrensning och raderas med fastigheten. Matchning som upphör/återkommer bevarar intervallen utan ny påhittad myndighetsversion. Retention och omkörning av återställd testdatabas godkända. |
| Svensk tid och kvalitet | 23-/25-timmarsdygn, täckningsluckor, nollvärden, normalkrav, stationsavstånd, källversioner, nollpassager och CSV-formelprefix testade. Native-dygn kvalificeras separat från egna kalenderdygn. |
| Händelsearkivets start | Starten är fastighetsspecifik. En ny fastighet gör inga anspråk på täckning före skapandet; ofullständigt startdygn och svensk årsskiftesformatering har regressionsprov. CSV redovisar startdatum för händelser och mätningar. |
| Desktop och 375 px | Demot visuellt granskat: nyckeltal, läsbara diagramaxlar, perioder, tryckdetaljer, veckostaplar vid 90 dygn, tabeller och ingen horisontell scroll i den granskade mobilvyn. |
| Webbläsarflöden | Direktlänk till Historik, byte av fastighet med vyn kvar, Nu/Historik med bibehållen karta, alla tidslinjekategorier, utvecklad källtext, gul–orange-versioner, egna datum, tomt läge och luckor verifierade. |
| CSV-knapp | Knappen har aktiverats i Chrome. Ett DOM-test klickar också den renderade knappen, kontrollerar skapad Blob, filnamn, MIME-typ och faktiskt filinnehåll. |

Ett kantfall med Leaflets `flyTo` vid direktlänk till en dold karta hittades och rättades i detaljvyns behållare. Kartkomponenten ändrades inte. Dolda Nu-paneler är inerta och behåller layoutmått.

## Volym och källanrop

Årssvaren för de åtta demofastigheterna är uppmätt **39 515–43 876 byte**, inklusive diagramserier, källtext, normaler och ursprungskoder. En officiell text trunkeras inte för att hålla en mycket händelserik adress under en viss bytegräns.

Fem år är cirka 1 826 rader per station/parameter/dygnsdefinition: uppskattningsvis **0,37–0,64 MB** med index. Åtta långserier är cirka 14 608 rader. Med tre kandidater per parameter är ett fullt nytt områdes exempel cirka 43 824 dygnsrader, **8,8–15,3 MB**, plus egna aggregat av andra råparametrar. Stationer delas mellan fastigheter; samma stationsområde ger inga dubbla dygnskopior. Händelsevolymen per fastighet är antal arkiverade versioner gånger officiell text plus metadata/index och varierar särskilt med trafikhändelser.

Initialt högst 51 serieförfrågningar i exemplet med samtliga åtta parametrar och tre kandidater; tom katalog tillför åtta katalogförfrågningar. De fördelas på högst tre stations-/parameterkombinationer per körning. Vid återanvända stationer blir det inga nya fullarkivhämtningar. Existerande prognos- och observationsjobb tillkommer oförändrat. Se ADR 0005 för uträkning och reservationer.

## Inte verifierat eller aktiverat

* Inga nya migreringar eller jobb är körda i applikationens produktionsdatabas. Driftskapacitet, kötid för full tillbakafyllning och riktiga organisationers historik behöver kontrolleras i en godkänd provdrift före aktivering.
* Chrome-verktyget kunde inte bekräfta filens sparande på disk: nedladdningsväntan gav timeout och åtkomst till `chrome://downloads` blockerades av verktygets URL-policy. Ingen kringgång gjordes. CSV-innehåll och knapputlösning är i stället verifierade med enhets-/DOM-test, och en fristående demo-CSV har skapats från samma exportfunktion.
* Ingen fullständig manuell skärmläsarrevision eller extern WCAG-certifiering ingår. Semantik, tabellalternativ, fokus, färger och reducerad rörelse finns i implementationen.
* Den valfria portföljkalendern ingår inte i denna leverans. Kärnvyn och datakedjan har prioriterats.

## Beslut före driftsättning

Bekräfta 24 månaders händelser och fem års dygn, gränserna regn 25 km/väder 50 km/hav 15 km/flöde 5 km/trafik 1 km, kvalificering 300 av 365 dygn, tre kandidater per parameter och de separata dygnsdefinitionerna. Besluta också om senare korrigeringar ska hämtas på nytt och hur långa vattenluckor ska repareras efter driftstopp; nu hämtas fullarkiv en gång enligt uppdraget. Flytt av en fastighetsmarkör bevarar historik under samma fastighetsid men ger inget komplett geometriskt revisionsbevis för tidigare adresser.

## Lokala commits

* `3861397` – kontrakt, kalenderberäkningar och deterministiska demoserier.
* `7fbd826` – timdetalj, observerade nollpassager och matchningsintervall.
* `d002e0f` – migrering, stationslagring, SMHI-adaptrar, referenser och arkiv-/DB-test.
* `0f826a8` – organisationsisolerat API och begränsade insamlingsjobb.
* `54f52eb` – historikvy, diagram, tidslinje, tillgängliga tabeller och CSV.
* `2989269` – svensk leveransrapport, volymberäkningar och beslut före drift.

Slutgranskningens separata fix omfattar fastighetsspecifik arkivstart och svensk tidsgräns. Den är den sista lokala committen i leveransen. Ingen push, PR eller driftsättning görs utan ägarens besked.
