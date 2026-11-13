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
