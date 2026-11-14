# Slutrapport – startsidans datapunkter

Uppföljning: denna rapport är uppdaterad för sammanslagningen på `codex/landing-parity-live`. Aktuella test- och migrationsresultat finns i [verifieringsrapporten](db-migration-verification.md).

Datum: 2026-11-14. Gren: `codex/landing-parity-live`, med livebas `e46b1bf` och sammanslagning av `771532e`.
”Levereras i skarpt läge” nedan avser den implementerade livevägen efter ordinarie migration och
release, inte ett påstående om att den befintliga driften redan har uppdaterats.

Startsidan är märkt som illustration med exempelvärden. Den får inte användas som en aktuell
mätbild. Havsexemplet följer liveversionens RW-system; luftexempel bygger på fångade API-svar 2026-11-14. Stationsavstånd är
beräknade från illustrationsadressens koordinat. `/demo` använder fortsatt sina tidigare fixturer.

| Datapunkt på startsidan | Utfall | Vad livevägen faktiskt visar / vad som ändrats |
|---|---|---|
| Adress, position och namn | Levereras i skarpt läge | Sparade kundadresser och bekräftad position; ingen påhittad fastighetsregisterinformation. |
| Portföljens antal fastigheter och kartpunkter | Levereras i skarpt läge | Antal sparade adresser. Startsidan är en märkt portföljillustration. |
| Fastighetens varningsstatus | Levereras i skarpt läge | Högsta officiella varning; annars ingen aktiv varning endast med aktuella varningskällor, annars Ej bedömd. Vattenobservation och vanlig trafik sätter inte hög varningsstatus i heroillustrationen. |
| Temperatur nu | Levereras i skarpt läge | SMHI-modellens aktuella prognosintervall, °C; märkt modell, inte observation. |
| ”Känns som” | Levereras i skarpt läge | Härledd SMHI-kyleffekt från samma temperatur/vindintervall; endast −40…+10 °C och 1,3…35 m/s. Annars utelämnat/Ej bedömd. Illustrationsvärdet rättat till −2,9 °C för 3,9 °C och 14,2 m/s. |
| Nederbörd kommande 24 h | Levereras i skarpt läge | Summa av SMHI:s prognosintervall med dokumenterad överlappshantering; saknat intervall ger inget tal. |
| Nederbörd per timme och prognostopp | Levereras i skarpt läge | SMHI-prognosens timintervall och deras topp; inga radarobservationer utlovas. |
| Vindhastighet | Levereras i skarpt läge | SMHI punktprognos, m/s, modell. |
| Vindbyar | Levereras i skarpt läge | SMHI punktprognos, m/s, modell. |
| Vindriktning | Levereras i skarpt läge | SMHI punktprognos, riktning/väderstreck, modell. |
| Luftfuktighet | Levereras i skarpt läge | SMHI punktprognos, %, modell. Ingen byggnadskondensrisk utlovas. |
| Prognosdiagram: temperatur, nederbörd och vind samt min/max/medel | Levereras i skarpt läge | Samma tidsserier från SMHI. Temperatur/vind min/max/medel och nederbördsintervall finns i livevyn. |
| SMHI-varning: nivå, text, giltighetstid och område | Levereras i skarpt läge | Oförändrad officiell varning, geografisk polygonmatchning. Startsidan visar uttryckligen en illustration. |
| VMA: myndighetstext och kommun/län | Levereras i skarpt läge | Kommun/länmatchning. ”0,8 km” ersatt av **Nacka kommun**. |
| Trafikhändelse: källa, tid och avstånd | Levereras i skarpt läge | Trafikverkets offentliga händelse med geometri och avstånd till närmaste punkt på linjen. |
| Larmradie | Levereras i skarpt läge | **2 km** för trafik, korrigerat på båda platserna på startsidan; VMA omfattas av kommun/län. |
| Färjestörningar för vägfärjor | Levereras i skarpt läge | Trafikverket Situation levererar färjestörningar med geometri inom samma 2 km. Ordinarie färjeturer sorteras bort; ingen störning härleds ur en tidtabell. |
| Inställd färja vid Nacka Strand (SL) | Blockerad och borttagen från startsidan | Ersatt av väghändelse. Separat `SOURCE_SL_DEVIATIONS_ENABLED` är av och `SL_DEVIATIONS_API_KEY` är tom. Dokumentationen visar att aktuella SL-endpoints är nyckelfria, så variabeln är endast den begärda lokala spärren. Kräver beslut om denna spärr och ett live-test av den aktiverade adaptern innan registry får ändras från interface_only. |
| Havsnivå | Levereras i skarpt läge | Livekopplingen: SMHI OCObs parameter **14**, **cm RW** relativt medelvattenstånd, närmaste station inom **15 km**. Station, avstånd och mättid visas; annars **—**. Se ADR 0004. |
| Vattennivåtrend | Levereras i skarpt läge | Liveversionens timtrend ur observation_history, med täckningskrav och ±2 cm dödband enligt ADR 0004. |
| Generell aktuell sjö-/vattendragsnivå | Borttagen från startsidans löfte | Startsidan lovar havsvattenstånd. Liveversionens befintliga hydrologikoppling för flöde, referenser och historik behålls enligt ADR 0004; inget generellt inlandsvattenstånd utlovas. |
| Översvämningsgräns +60 cm | Borttagen från startsidan, livepanelen och `/demo` | En stationsnivå ger ingen numerisk gräns för byggnaden. |
| ”Aktuell nivå mot översvämningsgräns” | Borttagen från startsidan | Ersatt av stationsnivå relativt medelvattenstånd (RW) och liveversionens timtrend. |
| ”Avstånd till gränsvärdet” | Borttagen från startsidan | Inget numeriskt gränsvärde härleds ur stationens nivå. |
| Karterad översvämningszon och scenario | Levereras i skarpt läge | MCF:s statiska scenarier, neutralt märkta. Sökrutor i steg **15/100/250/500/1 000 m**, inte exakt byggnadsavstånd. Träff i ±15 m-ruta beskrivs som sådan. Ingen träff betyder inte ingen risk. |
| Grundvatten jämfört med årstiden | Levereras i skarpt läge | Regional **modell**, SGU HYPE 4×4 km, percentiler och modelldatum; skild från uppmätt grundvatten. |
| Uppmätt grundvatten | Levereras i skarpt läge | Närmaste SGU-station inom **10 km**, observation högst **31 dagar** gammal, **m under stationens markyta**, station/avstånd/mätdatum. Annars **—**, regional modell visas separat där den finns. |
| Källarrisk | Borttagen från startsidan och livepanelen | Saknar byggnads-/källarunderlag och metod. Demoillustrationen behålls. |
| Luftkvalitet ”26 Bra” | Borttagen från startsidan | Ersatt av preliminära, namngivna stationshalter. Ingen 0–100-skala används i livevägen. |
| PM2,5 | Levereras i skarpt läge | Preliminär stationsobservation, µg/m³, station/avstånd/tid/upplösning. Närmaste rapporterande station inom 25 km, högst 6 h gammalt. |
| NO₂ | Levereras i skarpt läge | Samma redovisningskrav som PM2,5; råvärden får ha olika stationer och är då märkta separat. |
| Luftindex | Levereras i skarpt läge vid tillräckligt underlag | Härlett **EEA-baserat stationsindex 1–6**. Endast samma station/timme och rätt minimiämnen; annars **—** och råvärden. Historik sparas i 7 dagar. Saknade ämnen listas; inget byggnadsindex och ingen luckfyllning. |
| Väderobservationsexempel | Levereras i skarpt läge | Närmaste SMHI MetObs inom 50 km, högst 3 h gammalt, med stationsnamn, avstånd och mättid. |
| Dataklass och källa | Levereras i skarpt läge | Observation (inklusive uttryckligen härledda stationsvärden), modell/prognos, statiskt scenario och regional statistik hålls isär. SGU HYPE rättad till MODEL även i kontrakt och lagring. |
| Kommunstatistik | Levereras i skarpt läge | SCB folkmängd, befolkningstäthet och landareal för kommunen. ”Bebyggelse” struket; byggnadsdata utlovas inte. |
| SMS-exempel, mottagarantal och regler | Förhandsvisning; leverans fortsatt blockerad | Befintlig simulator och regelvy är kvar. ”Inom 1 min” borttaget från illustrationen, ingen leveranstid utlovas. SMS-leverans, telefonverifiering, inloggning och licensflaggor har inte ändrats. |

## API-verifiering med riktiga anrop

Alla anrop nedan var läsande. Inga nycklar finns i fixturer eller rapport.

| API | Resultat 2026-11-14 |
|---|---|
| SMHI SNOW1gv1 | Befintligt adapter-smoketest godkänt; officiella docs kontrollerade enligt källförteckningen. Kyleffektens officiella formelbild och giltighetsområde lästa. |
| SMHI IBWW varningar och länspolygoner | Befintliga adapter-smoketest godkända. |
| SMHI MetObs | Befintligt adapter-smoketest för lufttemperatur godkänt. |
| Krisinformation v3 news + VMA | Adapteranrop godkänt; testet accepterar att aktiva VMA kan saknas. |
| Trafikverket Situation | Väghändelser och vägfärjegeometri godkända med befintlig nyckel. Riktiga fixturer innehåller både störningar och ordinarie färjetrafik. |
| Trafikverket FerryRoute/FerryAnnouncement 1.2 | Båda gav HTTP 200 med befintlig nyckel. Route/Announcement och kopplingen via DeviationId undersökta; störningstext tas från Situation. |
| Luft: SMHI 52°North | Fenomenlista och alla fem ämnen PM2,5/PM10/NO₂/O₃/SO₂ gav riktiga svar. Nytt adapter-smoketest verifierar dessutom gemensam station/timme och index. |
| SGU HYPE | Befintligt adapter-smoketest för område och regional nivå godkänt. |
| SGU observerat grundvatten | Stationer, nivåer, queryables och nytt adapter-smoketest nära Vaxholm_1 godkända. Sorteringsavvikelsen reproducerad och hanterad med lokal sortering. |
| SMHI oceanografi | Grenens alternativa koppling har tagits bort. Den befintliga liveadaptern använder parameter 14, cm RW; dess fixture- och liveprov finns i oceanography.test.ts och providers.live.test.ts. |
| SMHI hydrologi | Katalog och parameter 3 gav HTTP 200; tio aktiva stationer, otillräcklig generell täckning. Ingen produktadapter påstås fungera. |
| MCF WFS | Befintligt adapter-smoketest för Fyrisån och Stockholm godkänt. |
| SCB PxWebApi v2 | Befintligt adapter-smoketest godkänt. |
| SL Deviations och SL Transport sites | Båda dokumenterade nyckelfria endpoints gav HTTP 200. **Ingen aktiverad, lokalt nyckelspärrad adapter har live-testats**; interface_only och avstängd flagga kvarstår. |

Liveproven i tabellen ovan är historisk evidens från ursprungsgrenarnas arbete, inte resultat från
sammanslagningen. Aktuella omkörningar och eventuella undantag redovisas i
[verifieringsrapporten](db-migration-verification.md). SL aktiveras inte av något liveprov.

## Kontroller och drift

- Hela Vitest-sviten med lokal databas: **328/328**, 40 testfiler, inga överhoppade tester.
- Separata verkliga PostgreSQL/PostGIS-integrationer: **23/23**.
- Uppföljande liveprov med befintliga nycklar och publik kontaktväg: **31/31 godkända**, inga överhoppade.
- Typkontroll i alla sex paket/appar, lint samt webb- och API-bygge: godkända.
- Migration **0008_environment_station_history.sql** har provats efter liveversionens 0001–0007
  i en ny tom databas: **8 applicerade**, sedan **0**, med godkända kontrollsummor.
  Migrationerna 0001–0007 är oförändrade mot livebasen.
- Indexets 7-dygnshistorik behöver originalprecision, enhet och metadata. Den gemensamma
  35-dygnshistoriken behålls enligt liveversionen. Se [ADR 0007](decisions/0007-luftkvalitetsindex.md).
- Startsidan har granskats i både desktop- och mobilmarkup, inklusive MOBILE_FEATURE_ITEMS.
  Liveversionens mobilstruktur och CSS-klasser bevaras; gränslinjen saknas också i demot.
- SL är avstängt som standard och kvar som interface_only. SMS, inloggning och licensflaggor är oförändrade.
- Efter ägarens godkännande tillåter deployskriptet även `codex/landing-parity-live`, bevarar
  runtime-miljön och återställer automatiskt vid misslyckad hälsokontroll. Se [driftsättningsunderlaget](landing-parity-deployment.md).
- Föregående `e46b1bf` publicerades enligt chatten ”Add Fastighetshistorik-vy” med det separata
  `.deploy/publish-mobile-web.mjs`: enbart webb, API och runtime-miljö oförändrade, API ready och
  startsida HTTP 200. Återställningskopian var `/home/instapod/web-prev-mobile3a-e46b1bf`.
  Det verifierar inte en release av det nu sammanslagna API:t eller migration 0008.
- Efter ägarens godkännande lästes befintlig token från huvudkatalogens `.env`. Poddens miljö
  och alla sju befintliga migrationskontrollsummor är verifierade. Huvudkatalogens arbetsfiler är orörda.
- Kyleffekt och grundvattenstationer: [ADR 0006](decisions/0006-stationer-och-kyleffekt.md).
  Luftindex: [ADR 0007](decisions/0007-luftkvalitetsindex.md).
  Havsvattenstånd, hydrologi och nowcast: [ADR 0004](decisions/0004-nowcast-och-vattendata.md).
  Fastighetshistorik: [ADR 0005](decisions/0005-historik.md).
