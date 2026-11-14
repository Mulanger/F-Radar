# ADR 0004 – Kyleffekt och närliggande vattenstationer

Beslut: 2026-11-14. Gäller produktens liveväg; `/demo` behåller sina tidigare värden och illustrationer.

## Vindens kyleffekt

[SMHI:s formel och giltighetsområde](https://www.smhi.se/kunskapsbanken/meteorologi/vind/vindens-kyleffekt)
kontrollerades inklusive formelbilden. Med temperatur T i °C och medelvind v i m/s:

`Teff = 13.12 + 0.6215*T - 13.956*v^0.16 + 0.48669*T*v^0.16`.

Beräkna endast för −40 ≤ T ≤ +10 och 1,3 ≤ v ≤ 35. Utanför området, vid saknat eller ogiltigt
indata utelämnas värdet. SMHI anger att formeln inte ska användas där; vi sätter därför inte ett
ersättningsvärde. Avrundning till 0,1 °C sker efter beräkningen. Båda indata kommer från samma
SMHI-prognosintervall. Fältet är **härlett ur modell/prognos**, med modellpunktens avstånd och
prognosens giltighetstid, aldrig en observation eller ett värmeindex. Metod: `smhi_wind_chill_v1`.

## Havsnivå

Officiella källor:

- [SMHI API-dokumentation](https://opendata.smhi.se/ocobs/api).
- [Parameter 6, inklusive stationslista och metadatalänk](https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/6.json).
- [SMHI:s beskrivning av höjdsystem och kvalitetskoder](https://www.smhi.se/data/hav-och-havsmiljo/havsvattenstand/).

Parameter **6** är momentana timvärden i **cm RH 2000**. Parameter 12 är RW och får inte användas
som ersättning. Nivån är inte relativt lokalt medelvattenstånd, byggnadens marknivå eller någon
översvämningsgräns. Dessa storheter räknas inte om till varandra.

Samla aktiva stationers `latest-day`-serier centralt var 30:e minut, endast för stationer inom
**30 km** från minst en kundadress. Närmaste station med giltigt värde högst **3 timmar** gammalt
väljs per fastighet. Avstånd är geografiskt avstånd mellan adress och station; gränsen är vårt
försiktiga presentationsval, ingen SMHI-rekommendation om representativitet. Den garanterar inte
samma vattenbassäng eller lokal nivå. Ingen station → `waterBody: null` och **—**.

Visa stationsnamn, avstånd, mättid, observation, SMHI, RH 2000 och kvalitetskod. Koder G/Y/O
bevaras, R/okänd kod och saknade/sentinelvärden publiceras inte. O är okontrollerat och Y misstänkt
eller aggregerat; dessa är inte kvalitetssäkrade observationer.

**Trend**, `hourly_difference_v1`: `nivå(t) − nivå(t−1 h)` i cm/h från samma stations timserie.
Detta är vår dokumenterade ändringsberäkning av SMHI:s observationer, ingen officiell varning
eller prognos. Exakt föregående timme krävs; saknas den visas **—**. Ingen interpolation eller
extrapolation. Aktuell nivå och trend sparas tillsammans så att de alltid avser samma mättid.

Vattenpanelen visar ingen numerisk översvämningsgräns i livevägen. Våganimationen är dekorativ.

### Sjöar och vattendrag – undersökt men inte anslutet

[Hydrologi-API:ets vattenstånd, parameter 3](https://opendata-download-hydroobs.smhi.se/api/version/1.0/parameter/3.json)
gav HTTP 200 och bara tio aktiva stationer 2026-11-14: Byrviksbanken, Fågeludden, Hjälmaren W,
Motala, Mälaren W, Ringsjödammen Övre, Sibro 2, Storsjön Jämtland, Vombsjön Övre och Vänern
(Vänersborg). Aktualiteten varierade från samma dygn till flera veckor. Det ger inte tillräcklig
täckning för en generell närmaste-vattendrag-funktion. Kopplingen är inte byggd; marknadsföringen
lovar bara havsstationer. En framtida inlandskoppling behöver också knyta fastigheten till rätt
sjö/vattendrag och verifiera varje stations referenssystem.

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
