# ADR 0007 – EEA-baserat stationsindex för luft

Beslut och källkontroll: 2026-11-14. Metodversion: `eea_hourly_2024_v1`.

## Officiell metod och svensk motsvarighet

[EEA:s aktuella metod, ”About the European Air Quality Index”](https://airindex.eea.europa.eu/AQI/)
använder **timhalter för samtliga fem ämnen**, även PM2,5 och PM10. Det äldre antagandet om
rullande dygnsmedelvärden används därför inte. [SMHI:s svenska beskrivning, uppdaterad 26 mars
2026](https://www.smhi.se/data/luftkvalitet/luftkvalitetsindex) anger också senaste timmens
preliminära mätvärden och EEA:s grund. [Naturvårdsverkets hänvisning till datavärden och EEA](https://www.naturvardsverket.se/amnesomraden/luft/statistik--utslapp-och-halter/luftkvaliteten-i-realtid-och-preliminar-statistik/)
kontrollerades. Luftwebbs översikt nämner fortfarande åttatimmarsmedel för ozon; vi väljer den
uttryckliga, nu publicerade EEA-metoden för samtliga ämnen och kallar inte resultatet ett svenskt myndighetsindex.

Indexet är det sämsta ämnesbandet vid **en station under en och samma timme**. Det är sex
kategorier, inte en skala 0–100. Det tidigare ”26 Bra” tas bort från startsidan.

| Ämne, µg/m³ | Nivåernas fem övre gränser; över sista gränsen = nivå 6 |
|---|---|
| PM2,5 | 5, 15, 50, 90, 140 |
| PM10 | 15, 45, 120, 195, 270 |
| NO₂ | 10, 25, 60, 100, 150 |
| O₃ | 60, 100, 120, 160, 180 |
| SO₂ | 20, 40, 125, 190, 275 |

Nivånamn i vår svenska vy: Bra, Acceptabel, Måttlig, Dålig, Mycket dålig, Extremt dålig.
Publicerade heltalsintervall tillämpas med kontinuerliga övre gränser: exempelvis PM2,5 **5,01**
hamnar i nivå 2. Detta gränsfall är vårt uttryckliga presentationsval; vi avrundar inte rådata
nedåt före klassningen. Indexet är en egen beräkning enligt EEA:s band, inte ett återpublicerat
resultat från EEA:s karttjänst. Ingen bedömning av miljökvalitetsnormer eller byggnadsrisk görs.

## Medelvärdesperiod, historik och stationsidentitet

- Indata är leverantörens `primaryData=hour`, det vill säga **en timmes** mätdata. Minut- och
  dygnsserier får visas med sin upplösning men får inte gå in i indexet. Vi skapar inte ett
  timmedelvärde av ett ensamt minutvärde. Inget nytt 8/24-timmarsmedelvärde räknas.
- Hämta fem ämnen centralt, sekventiellt varje timme (SMHI:s långsamma API). Spara timvärden
  med ursprunglig precision, enhet, kvalitetsstatus, serie-id, uppströms stations-id och tid i
  `station_observation_history`, unikt per källa/station/ämne/timme. Bevara **7 dagar** och hantera
  uppdaterade värden på samma nyckel. Historiken låter olika insamlingstidpunkter mötas på samma
  timme; lyckad senare hämtning får aldrig skriva tillbaka ett äldre ”senaste värde”.
- Riktiga svar visar olika `station.id` för olika ämnen vid samma plats (exempel: Malmö Rådhuset
  117/118/121/120/125). Den dokumenterade fysiska stationsnyckeln är JSON av **exakt publicerat
  stationsnamn, longitud, latitud och klassificering**. Alla fyra måste vara lika. Ingen
  avrundning, namngissning eller koppling bara på närhet tillåts. Uppströms id sparas i `extra`.
  En metadataändring kan därför tillfälligt ge inget index; det är bättre än att blanda stationer.
- Indexet använder senaste kompletta godtagbara timme, högst **3 timmar** gammal, för närmaste
  station inom **25 km**. Vid samma station väljs den senaste godtagbara timmen. Råvärden får
  visas upp till 6 timmar gamla, med sin egen mättid. Databasfrågan är organisationsavgränsad.

### Varför två historiktabeller finns

Liveversionens `observation_history` (migration 0005, ADR 0004/0005) bevaras för den gemensamma
observationshistoriken: stationsvärden nära aktiva fastigheter, 35 dygn och befintliga historikflöden.
Den tabellen har varken `unit` eller `extra` och lagrar presentationsavrundade luftvärden.
Migration **0008_environment_station_history.sql** lägger därför till `station_observation_history`
för indexets timunderlag: originalprecision, enhet, upplösning, stationsklass, serie-id och uppströms
stations-id måste följa varje timme för att undvika att blanda inkompatibla observationer.
Endast luftdata med `resolution=hour` skrivs här; samma källa/station/ämne/tid uppdateras vid revision
och rensas efter 7 dagar. Samma mätning kan alltså finnas i båda tabellerna, med olika kontrakt och
retention. Ingen andra havs-, väder- eller hydrologihistorik införs. Båda skrivvägarna behövs för att
behålla liveversionens beteende samtidigt som indexet får sitt fullständiga, reviderbara underlag.

## Saknade ämnen och presentation

EEA:s minimiunderlag används: gaturum kräver **NO₂ och minst ett av PM2,5/PM10**;
bakgrunds-/industristation kräver dessutom **O₃**. Beräkna värsta bandet av alla fem ämnen som
faktiskt finns för samma station/timme. Lista både ingående och saknade ämnen i vyn. Okänd
stationsklass eller otillräckligt minimiunderlag ger **inget index**. Saknad halt är aldrig noll.

Ingen CAMS-modell eller interpolering fyller luckor i vår produkt. Ett index med minimiunderlag
men utan ett eller flera andra ämnen är uttryckligen ett index för **tillgängliga ämnen**, aldrig
ett påstående om alla föroreningar. SMHI:s värden är preliminära och kan revideras. Vid tomt
underlag visas **— / Ej bedömd**, och separata råvärden med station, avstånd, tid, upplösning och
källa visas där de finns. Vi sätter ingen färgmarkör för ett saknat index.

Gränssnittet märker beräkningen **härlett EEA-baserat stationsindex**, källorna
**SMHI / Naturvårdsverket**, dataklass **observation (härledd)**. Station och mättid gäller
indexets indata, inte byggnadens luft. Demots tidigare skala behålls enbart under `/demo`.
