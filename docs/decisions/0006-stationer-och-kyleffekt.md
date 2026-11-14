# ADR 0006 – Kyleffekt och observerat grundvatten

Beslut: 2026-11-14. Gäller produktens liveväg. Vattenpanelen använder ingen numerisk översvämningsgräns, inte heller i `/demo`.

## Vindens kyleffekt

[SMHI:s formel och giltighetsområde](https://www.smhi.se/kunskapsbanken/meteorologi/vind/vindens-kyleffekt)
kontrollerades inklusive formelbilden. Med temperatur T i °C och medelvind v i m/s:

`Teff = 13.12 + 0.6215*T - 13.956*v^0.16 + 0.48669*T*v^0.16`.

Beräkna endast för −40 ≤ T ≤ +10 och 1,3 ≤ v ≤ 35. Utanför området, vid saknat eller ogiltigt
indata utelämnas värdet. SMHI anger att formeln inte ska användas där; vi sätter därför inte ett
ersättningsvärde. Avrundning till 0,1 °C sker efter beräkningen. Båda indata kommer från samma
SMHI-prognosintervall. Fältet är **härlett ur modell/prognos**, med modellpunktens avstånd och
prognosens giltighetstid, aldrig en observation eller ett värmeindex. Metod: `smhi_wind_chill_v1`.

## Befintlig vattenkoppling

Havsvattenstånd och hydrologi följer [ADR 0004 – Nowcast och vattendata](0004-nowcast-och-vattendata.md).
Den enda havskopplingen är `smhi/ocobs.ts`: SMHI OCObs parameter **14**, **cm RW** relativt årets
beräknade medelvattenstånd, närmaste station inom **15 km**, insamling var **10:e minut**.
Trend beräknas ur `observation_history` över 6 h, annars senaste timmens minutserie, med liveversionens täckningskrav och dödband.
Stationens nivå anger ingen gräns för en byggnad. Varken startsidan, livepanelen eller demot visar
någon numerisk översvämningsgräns. Hydrologins befintliga flödesobservationer och referenser behålls.

## Observerat grundvatten

[SGU:s OGC API och OpenAPI-länk](https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1)
och samlingarnas `queryables` verifierades med riktiga anrop. `stationer` ger koordinater och namn;
`nivaer` saknar geometri och kopplas med **platsbeteckning**.

Välj närmaste aktiv station inom **10 km** med en anmärkningsfri, daterad observation högst
**31 dagar** gammal. Gränserna är våra presentationsval för ett glest nät med olika mätintervall,
ingen representativitetsgaranti från SGU. Stationens mätdatum visas alltid, även när det är flera
veckor gammalt. Hämta dagligen per fastighet; annan tid än mättid får inte visas som mätdatum.

Visa `grundvattenniva_m_u_markyta` i **m under stationens markyta**. Positivt tal är djup;
negativt tal är ovan markytan. Använd varken meter under röröverkant eller höjd över havet som
ersättning. Observationen hålls åtskild från SGU HYPE:s 4×4 km regionala **modell**, vars percentiler
fortsätter visas separat. Ingen observation → **—**, ingen källarrisk härleds från observationen.

Riktiga anrop visade att `sortby=-obsdatum` ignoreras. Därför hämtas hela den begränsade
31-dagarsperioden och sorteras lokalt. Om `numberMatched` överstiger hämtat antal (10 000) blir
resultatet ett fel, aldrig ett felaktigt ”senaste värde”. Närmaste station utan godtagbart värde
ersätts av nästa station inom 10 km. Stationslistan får inte heller vara trunkerad.
