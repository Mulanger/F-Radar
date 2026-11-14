# ADR 0005 – Historik per fastighet

**Status:** Implementerad och verifierad lokalt 2026-11-13–14. Ingen produktionsaktivering.

## Bakgrund

En fastighetsägare behöver kunna se mätningar och tidigare myndighetshändelser vid sin adress. Dagens sjudygnsarkiv för avslutade händelser och 35 dygn med råmätningar räcker inte för en årsöversikt. Historiken beskriver omgivningen, inte skador eller förhållanden i byggnaden. Riskindex v1, regler, notifieringsköer och SMS ändras inte.

## Händelsearkiv

Migration `0007_property_history.sql` inför `property_event_history`. Databastriggers sparar en version när en geografisk matchning skapas/uppdateras och sparar avslut/återkallelse innan den aktuella matchningen tas bort. Samma version är idempotent. Text, rubrik, område, källänk och källangivelse bevaras. Insamlingens tidigare trunkering av rubrik/beskrivning tas bort för att arkivet ska kunna återge den officiella texten.

Arkivet har ingen främmande nyckel till `source_events`, som fortsätter att rensas efter sju dygn. Fastighet och organisation har däremot `ON DELETE CASCADE`. Organisationen hämtas från fastigheten vid arkivering, och alla läsningar filtrerar både organisation och fastighet. Händelser grupperas på källa och externt id; versionerna ligger i samma tidslinjerad. Versionernas tidsintervall klipps vid nästa publicerade ändring, så en senare orange nivå inte färgar en tidigare gul period.

En ändrad polygon eller adresspunkt kan upphöra att matcha medan källhändelsen fortsätter. Därför lagras `matched_until` och separata matchningsintervall utan att den officiella giltigheten ändras. En matchning som återkommer skapar ett nytt matchningsintervall i samma myndighetsversion. Diagram, varningsdygn och CSV använder dessa intervall. Om den första bevarade versionen redan är en uppdatering börjar dess nivå vid den dokumenterade ändringstidpunkten.

Varningsgeometrier sparas inte i långtidsarkivet. Kartan behöver dem för aktuell matchning men historikvyn behöver bara utfallet: metod, avstånd och områdesnamn. Därmed kan historiken återge den då gjorda matchningen men inte räkna om gamla polygoner mot en ny adresspunkt. Vid flytt av en befintlig fastighetsmarkör följer gamla matchningar fastighetens id. Arkivet är inte ett geospatialt revisionsbevis för en flyttad adress.

SMHI-händelser och VMA arkiveras. Trafikverkets händelser arkiveras endast med källans `warning`/`critical` och ett uppmätt avstånd på högst **1 000 m**; i historikens UI är de information. Krisinformation.se:s regionala meddelanden är kategorin `CountyInfo`. Ett VMA för andra kommuner i samma län finns kvar i tidslinjen med matchningsmetod men räknas inte som ett varningsdygn vid adressen och färgar inte mätgrafen.

Migreringen kopierar befintliga matchningar en gång. Tidigare borttagna händelser och äldre versioner går inte att återskapa. `history_archive_state.started_at` anger när arkivet startade. UI:t visar datumet och räknar inte äldre luckor som ett bevis för att inga varningar förekom. Avslutade händelseversioner sparas **24 kalendermånader efter avslut**. Pågående händelser behålls tills de avslutas.

## Stationsserier och dygn

SMHI:s öppna CSV-format och periodresurser kontrollerades live 2026-11-13. Korta oförändrade utdrag finns i `packages/integrations/test/fixtures/history-*.csv`. Arkiven strömmas med samma läsare som hydrologireferenserna; bara högst fem års dygnsresultat behålls i minnet och databasen. Månadsnormalen är undantaget och läser referensåren.

| Serie | Källa/parameter | Dygn och bearbetning |
| --- | --- | --- |
| Nederbörd | MetObs 5 | Källans representativa datum, perioden kl **06–06 UTC**. Datumet avser början: kl 07 vintertid/08 sommartid. Summor för månader använder samma definition. |
| Temperatur min/max | MetObs 19/20 | Källans representativa dygn, **18–18 UTC**. Bandet paras bara när samma station används för min och max. Linjen är mitten av intervallet, uttryckligen inte dygnsmedel. |
| Temperatur medel | MetObs 2 | Källans representativa dygn, **00–00 UTC**. Ingår i serier och CSV. |
| Observerade nollpassager | MetObs 1 | Timtemperaturer över svenska kalenderdygn. Kräver samtliga timvärden inklusive baslinjen vid midnatt. Nollvärden dubbelräknas inte. Hela måndag–söndag krävs för veckosumman; ingen slutsats om passager mellan mättillfällena. |
| Byvind | MetObs 21 | Högsta timvärdet under svenska kalenderdygn. |
| Havsvattenstånd | OCObs **12** | **RW, cm, timvärden**. Svenska kalenderdygn: min/max/medel av timvärden, inte minutextremer. 0 är årets beräknade medelvattenstånd. Parameter 13/RH2000 används inte. |
| Vattenföring | HydroObs **1** | Dygnsmedel, källans datum enligt CSV-rubriken ”Datum (svensk sommartid)”. Det konverteras inte till svenska kalenderdygn. |
| Kort regndetalj | Befintliga MetObs 14-kvartar | Separat timserie för upp till två valda dygn inom råhistoriens 35 dygn. Varje hel timme kräver fyra kvartsvärden. UTC-intervall sparar även höstens två olika kl 02. |

Egen aggregering av intervallslut använder `(00,24]` i `Europe/Stockholm`. Dygnen kan vara 23 eller 25 timmar. Momentan timtemperatur har dessutom ett värde vid början som baslinje. Timregnet och våra kalenderdygnssummor får aldrig ersätta eller komplettera parameter 5:s dygn. `day_definition` ingår i primärnyckeln.

Råvärden aggregeras nattligen och dessutom alltid före råretention, även efter driftstopp. Endast kompletta dygn får ett sammanfattande värde. Övriga har täckning och `null`, som visas som luckor. Den nattliga aggregeringen sparar även de övriga råparametrarna i egna kalenderdygn. För hav används endast hela timtidpunkter så definitionen stämmer med det långa timarkivet. Nollpassager räknas från timtemperaturerna och gissas aldrig från min/max.

Källor:

* [MetObs parameter 5](https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/5.json) och [CSV för Stockholm-Observatoriekullen A](https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/5/station/98230/period/corrected-archive/data.csv).
* [MetObs parameter 23](https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/23.json).
* [RW timvärden](https://opendata-download-ocobs.smhi.se/api/version/latest/parameter/12.json). Resursen erbjuder `corrected-archive` och `latest-day`, inte `latest-months`.
* [HydroObs dygnsvärden](https://opendata-download-hydroobs.smhi.se/api/version/latest/parameter/1.json). Resursen erbjuder också `corrected-archive` och `latest-day`.

## Stationsval och arbetskö

Alla nya policyvärden finns i `packages/domain/src/history.ts`, `HISTORY`:

* Nederbörd och kort regndetalj: högst **25 km**. Övrigt väder: **50 km**. Hav: **15 km**. Flöde: **5 km**. Avståndet är geografiskt och bevisar ingen koppling till ett vattendrag.
* En lång serie kräver minst **300 kompletta dygn under de senaste 365 dygnen**. Därför kan vyn ärligt innehålla luckor eller sakna en lämplig station; 12 månader kan inte garanteras överallt.
* Närmaste kvalificerade station väljs per parameter. För regn föredras närmaste kvalificerade station med tolv giltiga månadsnormaler; annars visas bara de normaler som håller för den valda stationen. Inga stationer blandas i en serie.
* Upp till **tre kandidater per fastighet och parameter** samlas in. De delas mellan alla fastigheter. **Tre stations-/parameterkombinationer per körning**, därefter `moreWork` och den befintliga schemaläggarens fortsättningskörning. En kombination som saknar tillräcklig historik kan alltså ersättas av nästa kandidat.
* Stationskatalog och nya dygn hämtas **dagligen**. Misslyckade försök bokförs och väntar minst **sex timmar**. HTTP 429 avbryter omedelbart och lämnar `Retry-After` till schemaläggaren.
* Jobbet `history_backfill` ingår i `PER_PROPERTY_JOBS`. Vyn hämtar bara lagrad data, aldrig SMHI. En helt ny station behöver den schemalagda tillbakafyllningen innan värden kan visas, vanligen några korta kökörningar.
* `corrected-archive` hämtas **en gång per station/parameter**. MetObs fyller därefter på från `latest-months` (hela den senaste fyramånadersfilen eftersom källan inte erbjuder en verifierad deltaendpoint); databasen skriver bara nya/mer kompletta dygn. Vattenkällorna använder `latest-day`. Driftavbrott kan därför lämna vattenluckor; hav kan också fyllas från våra lagrade timtidpunkter.
* `history_backfill_checks` överlever omstarter. En redan hämtad korrigerad fil hämtas inte om för ett nytt fastighetsid. Senare korrigeringar av redan kompletta källvärden synkroniseras inte automatiskt; detta följer kravet om en arkivhämtning.

`station_daily` har **fem års** retention. Det är en delad stationslagring och ingen kopia per fastighet. Metadata ligger separat från `observation_stations`, vars tvådygnsrensning fortsätter oförändrat. Svarens tillgänglighet beror på faktisk källtäckning; saknade värden och saknad station får inte bli 0.

## Referenser och jämförelser

Nederbördsnormaler beräknas från parameter 23 för **1991–2020**. Varje kalendermånad kräver **24 olika år av 30** med publicerade, numeriska månadssummor och kvalitet G/Y. Dubbletter räknas en gång, saknade värden inte alls. En giltig men otillräcklig serie kontrolleras högst **en gång per år**. Stationer utan parameter 23 får samma årliga frånvarokontroll. Misslyckade nätanrop ger ingen ny normal. Jämförelser kräver samma station och kompletta kalendermånader; normalvärden prorateras inte till godtyckliga delar av en månad. En rullande tolvmånadersperiod kan därför få månadskonturer men ingen procentsiffra för hela perioden.

Flödets P75/P95 bygger separat på kompletta **dygnsvärden**, högst fem lagrade år, med samma percentilmetod och minimikrav (tre år, 30 dygn per månad) som befintliga hydrologireferenser. `history_flow_references` räknas om högst årligen från lagrade dygn. Den nuvarande panelens referenser från 15-minutersvärden blandas inte med dygnsserien. Detta är en säsongsreferens, inte nederbördens klimatnormal 1991–2020. Saknas underlag visas inget referensband.

Nyckeltalet dygn med minst **10 mm** är statistik. Blötaste dygn och vattenmax avser endast kompletta observerade dygn; om perioden har luckor anges det. Ingen härledd mätning kallas varning.

## API och UI

`GET /v1/properties/:id/history` kräver verifierad organisation och ägd fastighet; annars 404. Zod validerar `30d`, `90d`, `12m` eller en datumperiod på högst **24 kalendermånader**, utan framtida slutdatum. Perioder är inkluderande datum, och förval slutar igår i svensk tid. Serier delar datumaxel och skickar värden/täckning som parallella arrayer. Kompakta ursprungskoder anger per datum SMHI-fil (`s`), egen aggregering (`o`) eller ingen lagrad rad (`-`); CSV skriver ut hela ursprungsnamnet. Servern sammanställer månader, nyckeltal, veckor och tidslinje. Stationskvalificering räknar bara dygn med rätt definition, och ”historik sedan” gäller den lagrade serien även när vald period inte överlappar den.

Endast en GET-rad läggs till i BFF-allowlistan. Historiken laddas separat när `?vy=historik` öppnas. Hero, WebGL och aktuella kartkomponenter avmonteras inte vid vybyte; den dolda kartan behåller positiva layoutmått också vid en direktlänk. Historikvalet följer med när fastighetsväljaren används. Periodchips, diagram med luckor, tidslinjefilter, versioner och CSV använder befintliga designtokens. När fler än **60** dygnsstaplar inte får plats på mobil visas veckoblock; ett block med lucka får ingen summa. Månadsbandens varningsfärg omfattar bara de verkliga varningstimmarna, inte en hel månad med en tvådagarsvarning. Min/max från olika temperaturstationer visas separat.

Tabellalternativ och tangentbords-/tryckstyrda diagramdetaljer finns. CSV är UTF-8 med BOM, semikolon, tydliga radtyper, tomma celler för saknade värden, station/avstånd, källor, definitioner, versioner och källangivelser. Formelprefix i källtext neutraliseras för kalkylprogram. Ingen PDF ingår.

## Demo, volym och uppföljning

Alla åtta fastigheter har deterministiska syntetiska serier i samma referensår som det godkända demot (12 november 2025). Hösten är blötare än referensen. Den uppgraderade orange vindhändelsen hör till Nacka och VMA till Ulvsunda. Inga verkliga äldre myndighetshändelser tillskrivs demot.

Fem år ger cirka **1 826 rader per station och parameter/dygnsdefinition**. Åtta långserier motsvarar cirka **14 608 rader** om alla väder- och vattenserier finns. Med tre kandidater per parameter är takexemplet cirka **43 824 rader** för en helt ny plats, plus separat egen aggregering av råparametrar. Stationer delas; en ny fastighet vid befintliga stationer tillför inga duplicerade dygn. Ungefär 200–350 byte per dygn inklusive index ger 0,37–0,64 MB per stationsserie. Verklig Postgres-storlek beror på fyllnadsgrad och index.

En helt ny plats med samtliga källor och tre kandidater per parameter kan initialt ge högst **51 serieförfrågningar**: 18 väderserier × två perioder, sex vattenserier × två perioder, samt tre normalarkiv. Vid tom katalog tillkommer **åtta katalogförfrågningar**. Dessa sprids över små körningar. Närliggande fastigheter delar redan bokförda hämtningar. Befintliga observations-/prognosjobb tillkommer oförändrat. Ett vanligt tillägg inom samma stationsområde ska inte starta nya fullarkivhämtningar.

Ett tolvmånaderssvar med de syntetiska testserierna hålls under **50 KiB** i test. Händelsernas oförändrade texter kan göra ett verkligt, mycket händelserikt svar större; texter trunkeras inte för att nå en godtycklig bytegräns. Händelser lagras per fastighet och version; deras volym beror huvudsakligen på den officiella textens storlek.

Före produktionsaktivering behövs ägarens beslut om retention, avstånd, kandidatantal, dygnsdefinitioner och hantering av senare källkorrigeringar. Långa haveri-/vattenluckor fylls inte om genom att hämta hela arkiv på varje sidvisning. Portföljens valfria kalenderöversikt prioriteras efter den verifierade detaljvyn.
