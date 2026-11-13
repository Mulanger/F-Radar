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
