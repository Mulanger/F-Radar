# ADR 0004 – Nowcast och vattendata

**Status:** Implementeras lokalt 2026-11-13. Ingen produktionsaktivering.

## Bakgrund

FastighetsRadar visar mer av redan hämtad SMHI-prognos och kompletterar med radarprognos och stationsmätningar. Detta är information; Riskindex v1 och SMS-regler ändras inte.

## Källor

SMHI SNOW1gv1: nederbördens medel, min, median och max samt snöandel, frusen sannolikhet och nederbördstyp. 9999 och negativ snöandel betyder saknat värde. Alla nederbördsmängder gäller ett intervall, inte automatiskt en timme.

## Trösklar och beräkningar

Konstanterna finns samlade i `packages/domain/src/weather-information.ts`, `WEATHER_WATER`.

* Intensivt regn: medel ≥5 mm i ett verkligt entimmessteg ger monitor, ≥15 mm warning.
* Åska: ≥30 procent ger monitor.
* Snö: ≥5 mm vatten under 24 h, viktat med frusen andel. Tumregel 1 mm vatten ≈1 cm snö; alltid ”ca”. Ingen snörad om den våta serien saknar snöandel eller täckning.
* Halka: ≥0,2 mm vid −2 till +1 °C, eller regn direkt efter ett sammanhängande steg med minusgrader.
* Växlande grader: minst två teckenbyten på 48 h; nollvärden räknas inte dubbelt och luckor bryter följden.
* Fem rullande 24 h-fönster från snapshotens tid. Nederbörd pro-rateras vid 6/12 h-intervall, med uttryckligt antagande om jämn fördelning. Luckor eller överlapp ger null. Min/max är summerade modellintervall, inte en sannolikhetsprognos för dygnssumman. Temperaturens min/max gäller modellstegen.

## Ordval och saknad data

Härledda rader heter prognos och får högst tonen warning. Bara myndighetsvarningar och VMA kallas varningar. Saknade värden visas ”Ej tillgänglig”; äldre v1-prognoser läses med null för nya fält. Osäkerhetsintervallet visas sekundärt till medelvärdet. Varje panel anger källa och modellkörning/mättid.

## Medvetna avgränsningar

Inget ändrat riskindex, inga nya SMS-regler och ingen händelserapport. Befintliga critical-rader för vindbyar och dygnsregn lämnas enligt uppdraget; förslag: även dessa härledda rader bör högst använda warning i ett separat produktbeslut.

## Radarprognos

MET Norway nowcast 2.0 complete, CC BY 4.0. Villkoren https://api.met.no/doc/TermsOfService lästes 2026-11-13. Ingen Yr/MET-profilering. Ägaren bekräftade kontaktwebbadressen https://f-radar.se; den anges via MET_NORWAY_CONTACT, aldrig privat e-post. Saknad kontakt ger skipped. Högst fyra parallella anrop i batcher med 1 sekund emellan (inga automatiska HTTP-omförsök), en databasleasad singleton-jobbtyp över alla API-instanser. Cache på gemensam tvådecimalerspunkt; Expires och exakt Last-Modified/If-Modified-Since bevaras i databasen, även över omstart. 304 förnyar cachemetadata utan att ersätta serien. Vid många punkter bör hämtning begränsas till punkter där SMHI visar nederbörd kommande 3 h; detta är inte infört.

0,2 mm/h skiljer nederbörd från brus. Lätt <2,5, måttligt <10, kraftigt <50, skyfallsintensitet ≥50 mm/h. Endast ≥10 får tonen warning. Rate anger vattenmängd; ≤0,5 °C troligen snö, <2 °C regn eller snö. Mängder integreras rate × faktisk överlappande del av femminuterssteget, summering kräver full timtäckning. Luckor ger unavailable. 15–30 min efter hämtning märks inaktuell; över 30 min tas prognostext och stapelvärden bort. Saknade staplar streckas. Märket i översikten visas bara för färska serier med pågående nederbörd eller start inom 60 min och påverkar ingen sortering.

## Havsvattenstånd

SMHI OCObs parameter 14: cm RW (Relative Water Level), relativt årets beräknade medelvattenstånd. Parameter 13 är RH 2000 och används inte. https://opendata.smhi.se/ocobs/resources/parameter och SMHI:s databeskrivning https://www.smhi.se/data/sok-oppna-data-i-utforskaren/se-of-oceanografiska-observationer-havsvattenstand-rw-minutvarde verifierades med parameterresursen och stationsresurs 33097. Därmed används befintligt vattennivåkontrakt med explicit RW. Närmaste station inom 15 km, jobbkadens 10 min. Alla minutvärden behålls för timtrend; ±2 cm uppmätt ändring är dödband. Minst 75 procent av trendfönstret måste spännas av mätningar, med senaste värde i sista fjärdedelen. Ingen slutsats om byggnaden, inget +60 cm-gränsvärde.

## Vattenföring

SMHI HydroObs parameter 2 (15 min, m³/s), CC BY 4.0. Närmaste station inom 5 km. Det är ett geografiskt avstånd, inte en hydrologisk koppling; texten om att stationen kan ligga i ett annat vattendrag visas alltid. Parameter 3 används inte.

corrected-archive har CSV-format (verifierat station 1583), med UTC-datum/tid, värde och kvalitetskod. Filen strömmas och bara G-värden används. Referenser beräknas för var och en av årets tolv UTC-kalendermånader från stationens hela tillgängliga serie; ingen fast klimatnormalperiod påstås. Kräver minst 3 olika år och 30 olika mätdagar per månad. P75 och P95 beräknas med linjär interpolation vid index (n−1)×p. Under P75: Normalt för årstiden; P75 till och med P95: Högt för årstiden; över P95: Mycket högt för årstiden. Detta är vår beskrivande klassning, ingen officiell flödesvarning.

En separat källflaggad collector söker stationsnära referenser, högst två stationer per körning, högst en arkivhämtning per station och vecka. Upp till 14 dagar gamla referenser får visas. Misslyckade hämtningar skriver inte över referenser; saknad/gammal referens ger null och en tydlig text. Lång historik lagras endast som tolv percentilpar samt antal värden/år, inte som alla arkivvärden.

## Mäthistorik och datavolym

observation_history lagrar källa, station, parameter, faktisk UTC-mättid, värde och kvalitet. Primärnyckeln gör omförsök idempotenta (ON CONFLICT DO NOTHING). Retention är 35 dygn. Alla aktuella stationsvärden skrivs fortfarande till observation_stations, men historik lagras bara om minst en aktiv fastighet finns inom källans matchningsavstånd: MetObs 50 km, luft 25 km, hav 15 km, flöde 5 km. Havsvärden väljs på exakta 10-minuterstidpunkter; inga interpolerade mättider skapas.

MetObs parameter 14 (summa 15 min, fyra gånger per timme) behåller alla värden i senaste timmens svar. Jobbet körs var 15:e minut. Summeringen avslutas vid senaste avslutade kvart, använder intervallens sluttid och kräver minst 90 procent av förväntade kvartsvärden (1 h:4, 24 h:96, 72 h:288). Saknas mer än 10 procent visas ofullständig mätserie utan summa. Ingen extrapolering av saknade mängder; den faktiskt observerade summan och täckningsgraden visas. Historik byggs framåt, utan automatisk tillbakafyllning; dygnssummor blir tillgängliga först när tillräcklig serie samlats in. Havstrend använder 6 h när sådan historik finns, annars senaste timmens minutserie; flödestrend kräver 24 h historik.

Volym per dygn: 144×S (havsstationer) +96×H (flödesstationer) +96×P (kvartsregnstationer) +24×M (övriga MetObs station/parameter-kombinationer) +24×A (luftstation/parameter-kombinationer). Exempel med S=10, H=20, P=30, M=180 och A=40 ger 11 520 rader/dygn, ca 403 200 rader för 35 dygn. Vid uppskattade 200–350 byte per rad inklusive index motsvarar det ca 80–141 MB, plus WAL och underhåll. Stationer delas mellan fastigheter; fastighetsantal multiplicerar inte antalet historikrader. Faktisk volym ska mätas före produktionsaktivering. Inga sparklines läggs till; befintlig panel visar tydliga trendtexter.
