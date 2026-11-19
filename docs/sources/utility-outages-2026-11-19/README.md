# Nationellt underlag, 2026-11-19

Insamlat från egen worktree `codex/avbrott-hela-landet`, bas `e9945d5`.
Inga produktionsskrivningar eller nya aktiveringar. `pod-probes.json` innehåller enbart
publika URL:er, HTTP-resultat och profiltitlar, aldrig meddelandetexter eller kundadresser.
Riktiga, beskurna och kontaktmaskerade JSON/KML-svar finns under integrationernas fixtures.

## Kundmått och begränsningar

- El: [Ei tekniska uppgifter lokalnät](https://ei.se/om-oss/statistik-och-oppna-data/tekniska-uppgifter---elnat),
  2025, kolumn DS, totalt antal abonnemang i uttagspunkt. Bara redovisningsenheter med
  rapporterat 2025-värde; äldre uppköpta enheter utan värde räknas inte som noll.
  142 enheter, **5 612 871 abonnemang**. Namnmatchning mot befintliga `eiNames`:
  38 implementerade nät; 29 hade lyckat jobb, nio hade aldrig lyckats enligt SELECT 2026-11-19.
  **3 859 845 / 5 612 871 = 68,7677 %**. Alla 38 tillsammans: 73,2844 %.
  Detta är leverantörstäckning, inte andel kunder med polygonprecision eller SMS.
  Jobbkontrollen är en daterad baslinje, inte löfte om att alla flöden alltid är färska.
- Värme: [Ei levererad värme per prisområde](https://ei.se/om-oss/statistik-och-oppna-data/tekniska-uppgifter---fjarrvarme),
  2025, summan av FVD42011, FVD42111, FVD42061, FVD42161 och FVD42211
  (P, BF, CV, EL, GB), årets slut. **351 520 kundrelationer**, summerat per bolag/nät.
  Kundrelationer kan återkomma i olika nät. En nätdel får inte tillgodoräknas hela bolagets kunder.
  [Ei:s tabellförklaring](https://ei.se/download/18.212631aa18bcc1823056ee0/1730267423541/Tabellf%C3%B6rklaringar-%C3%A5rsrapporter-fj%C3%A4rrv%C3%A4rme.pdf)
  definierar de fem kundslagen. Nationell fungerande procent återstår att verifiera per nätdel;
  enbart aktiverat eljobb bevisar inte bolagets värmetäckning.
- [Energiföretagens leveranser 1996–2025](https://www.energiforetagen.se/statistik/fjarrvarmestatistik/fjarrvarmeleveranser/)
  är också hämtade; GWh används inte som om det vore kundandel.
- VA: [Svenskt Vattens medlemslista](https://www.svensktvatten.se/natverk-och-medlemskap/medlem-och-partner/medlemslista/)
  ger organisationskoppling, inte ett komplett öppet kundregister.
  SCB TAB628, 2025, kön 1+2, BE0101U2: alla 290 kommuner, **10 605 520 invånare**.
  `municipalities.json` är prioriteringsunderlag, **inte anslutna VA-kunder**.
  Kommungräns bevisar inte kommunal VA-anslutning för en enskild fastighet.
  Befintlig VA-täckning är 0 % (ingen VA-adapter), kommande procent ska märkas som befolkningsproxy.
- Gas: [Ei naturgas](https://ei.se/om-oss/statistik-och-oppna-data/tekniska-uppgifter---naturgas),
  2025, AB/NTN131, endast kategori Distribution. Stockholm stadsgas och naturgas får inte
  antas vara samma denominator. Befintlig täckning är 0 % (ingen gas aktiverad i operatörerna).

Råfilerna kan hämtas igen från länkarna nedan; `statistics-sha256.json` identifierar exakt underlag:

- [El XLSX](https://ei.se/download/18.5c4d7af51a12f7b655290cd/1793113050689/S%C3%A4rskild-rapport-tekniska-data-lokaln%C3%A4t.xlsx)
- [Värmekunder XLSX](https://ei.se/download/18.60bdaf30184b920988153f6/1791963602209/Levererad-v%C3%A4rme-per-prisomr%C3%A5de-tekniska-uppgifter-fj%C3%A4rrv%C3%A4rme.xlsx)
- [Naturgas XLSX](https://ei.se/download/18.6ef4c28b1993705049093a7/1792050856984/S%C3%A4rskild-rapport-tekniska-uppgifter-naturgas.xlsx)
- [SCB hela TAB628, population](https://statistikdatabasen.scb.se/api/v2/tables/TAB628/data?lang=sv&outputFormat=json-stat2&valuecodes%5BRegion%5D=*&valuecodes%5BKon%5D=1%2B2&valuecodes%5BContentsCode%5D=BE0101U2&valuecodes%5BTid%5D=top%281%29)

## Prioritering

`electricity.json`, `heating.json` och `municipalities.json` är sorterade nationellt,
oberoende av testportföljen. Saknade elnät börjar med Öresundskraft 104 127,
Kraftringen 96 063, Umeå 68 210, Skellefteå 67 110, Jönköping 55 535,
Telge 55 099, Nätkraft Borås 44 245 och Gotland 42 925.
Värmens största kundantal är Linköping 14 932 (befintlig källa), Mälarenergi 14 703,
Göteborg 14 205 (befintlig), Vattenfall 13 847, Öresundskraft 13 411 och Solör 11 410.
Stockholm Exergi 11 112 är alltså inte störst i **kundantal**, trots planens formulering;
det har en verifierad Digpro-källa och prioriteras bland anslutningsbara källor.

## Trasiga befintliga källor: prov från f-radar

| Operatör | Resultat | Bedömning |
|---|---|---|
| Falu Elnät `fev` | HTTP 500, explicit blockeringssida | WAF-blockering, inte verifierat att just land är kriteriet |
| Hedemora `hed` | curl 60 | saknad mellanliggande CA; Windows verifierar full kedja |
| Linde `lie` | curl 60 | saknad mellanliggande CA; Windows verifierar full kedja |
| Halmstad `hsd` | curl 28, 30 s | timeout; svensk utgång ännu inte provad |
| Härnösand `hem` | curl 28, 30 s | dito |
| Bergs Tingslags Elektriska `bte` | curl 28, 30 s | dito; **inte Borlänge**, som är `bee` och fungerar |
| Luleå `lul` | curl 28, 30 s | dito |
| Nacka `nac` | curl 28, 30 s | dito |
| Jämtkraft | curl 28, 30 s | dito |

Planens bolagsnamn för `hsd`, `hem` och `bte` är fel. Koden har rätt namn.
Inget nytt TLS-prov med installerade certifikat har gjorts på podden: det skulle kräva
en otillåten produktionsändring. Certifikatkontrollen har aldrig stängts av.

## Verifierade nya flödeskandidater

| Källa | Plattform / URL | Svar från podden | Format, precision, tider | Rekommendation |
|---|---|---|---|---|
| Stockholm Exergi | Digpro `avbrott.stockholmexergi.com`, `fpdh_fov` | ja, HTTP 200 | KML, polygon/punkt, Digpro typ/tider/kundantal | återanvänd Digpro; separat flagga |
| Göteborg VA | ServiceAlert, kund `fa77564a-b727-49a0-ac51-5c748b1d17a5` | ja, HTTP 200 | JSON, VA-profil; ritad yta och adresspunkter; fritext; publicering/utgångstid | gemensam water; ingen gissad avbrottstid |
| SVOA | `https://www.stockholmvattenochavfall.se/driftinfo/Search?skip=0&query=&useCurrentLocation=false&latitude=undefined&longitude=undefined` | ja, HTTP 200 | JSON, 10 av 18 poster; sidindelat; adresser/koordinater och lokala datum | hämta alla sidor; filtrera bort projekt och avfall |
| Göteborg Energi gas | befintlig KML-handler, type `36857929` | ja, HTTP 200 | giltig **tom** KML | stödet kan byggas; ingen aktiv gaspost verifierad |
| ServiceAlert befintliga 11 | samma endpoints som operators.ts | ja, samtliga HTTP 200 | profiler nedan, vissa aktuella VA-poster | gemensam adapter; inte exakt polygonprecision |

Alla exakta URL:er och observerade profiltitlar finns i `pod-probes.json`.
VA-profiler hos Söderhamn (Vatten), Oxelö (Vatten och Avlopp), Emmaboda (VA),
Eskilstuna (Vatten), Ljusdal (Vatten och avlopp), Ulricehamn (Vatten & Avlopp).
Aktuella VA-meddelanden observerade hos Eskilstuna, Ulricehamn och Göteborg.
Avlopp skiljs inte tillförlitligt från vatten: välj gemensam `water`, etikett **Vatten och avlopp**.
Fritextens `criticalStatus` är inte i sig en kokningsrekommendation eller säkert oplanerat avbrott.

## Kandidater som behöver fortsatt undersökning

Alla åtta största saknade elnätsbolagens sidor i katalogen svarar HTTP 200 från podden.
Det bevisar **inte** fungerande avbrottsflöde. Exakt flöde undersöks i Fas 2.
Kraftringens Digpro-fingeravtryck avser värme, inte el.
Umeå länkar till `driftinfo.umeaenergi.se`, Skellefteå har en Angular-app,
Telge en Blazor-app. Jönköping och Sollentuna saknar användbar URL i Elsamverkans katalog.
Katalogens felaktiga dubbla URL-scheman har normaliserats i kandidatkatalogen.

VA SYD: den först prövade publika sidan tog timeout från podden; ännu inget verifierat API.
Uppsala Vatten har publika textnotiser; geometri/adressformat ännu inte verifierat.
Övriga stora värme- och VA-bolag återstår att utreda i respektive fas.
Gasnätet Stockholm: prövad sida tog timeout; Weums prövade URL gav 404 – detta är inte bevis
för att bolagen saknar publikt flöde. Inga adaptrar får byggas på dessa prov.

## Telekom – endast kartläggning

Telia och Telenors publika driftsidor svarar HTTP 200 från podden; klientappar,
inget tillräckligt verifierat områdesflöde. Först prövade Tele2-/Tre-URL:er gav 404 och
är inte verifierade endpoints. ServiceAlert har stadsnät/fiber/bredbandsprofiler hos flera bolag.
[PTS](https://www.pts.se/internet-och-telefoni/storningar-och-avbrott/) hänvisar till operatörerna;
ingen allmänt tillgänglig samlad API-åtkomst verifierad. Navet finns, men öppet uttag/avtal ej klarlagt.
Rekommendation: avvakta Fas 7 och kräva leverantörsval vid en framtida införing.
Produktägaren har uttryckligen valt **ingen Fas 7-implementation** i detta uppdrag.

## Fas 2: anslutna bakom avstängda flaggor

| Operatör | 2025 abonnemang | Plattform / faktisk publicerad URL | Från podden |
|---|---:|---|---|
| Öresundskraft | 104 127 | Trimble `https://driftinformation.oresundskraft.se/OutageMap/geoserver-api/` – GetApplicationData, StaticObjects, härledda stationsrutor | ja; 17 normaliserade avbrott, 0 skipped |
| Kraftringen Nät | 96 063 | Digpro-KML `https://stavbrottskartan.blob.core.windows.net/xml/fpp_lnd_outages.kml` | ja; 11 avbrott, 0 skipped |
| Umeå Energi Elnät | 68 210 | publicerad JSON `https://uewebstorage.blob.core.windows.net/disturbance-data-prod/disturbances.json` | ja; 88 elposter, 0 skipped; endast återställda elposter vid provet |
| Skellefteå Kraft Elnät | 67 110 | JSON `https://driftinfo3-api.skekraft.se/api/disturbances` | ja; 64 poster, 0 skipped |

Normalisering av de fulla poddsvaren: `phase2-pod-parsing.json`. Realistiska fixtures sparade.
Öresundskraft ger driftområdesprecision, aldrig SMS. Kraftringen/Umeå/Skellefteå ger polygoner
eller punkter; punkt ger fortsatt inget SMS. Umeås enum och lokala datum verifierades i kartkoden:
domän 0 el/2 värme/3 kyla, läge 0 åtgärdat/1 pågående/2 planerat, typ 0 planerat/1 fel.
Dess breda backend-API används inte; bara blobben som den publika kartan faktiskt hämtar.
Skellefteås `total` är historikarkivet, `count` det returnerade urvalet; ofullständigt urval blir
partial, inte tomt lyckat svar. Skellefteås övriga statuskoder och framtida planerade poster
har inte observerats: de blir konservativt unknown tills nytt verifierat underlag finns.
Umeå/Skellefteå ger inget "troligen återställt" vid försvinnande eftersom de själva publicerar avslut.
Okänd återställningstid ersätts inte med vår inläsningstid.

Potentiell leverantörstäckning med dessa fyra aktiverade och fungerande:
**4 195 355 / 5 612 871 = 74,7453 %**, +5,9775 procentenheter.
**Produktions­täckningen är oförändrad**; inga flaggor har ändrats där.
Ei-placeholder-id:n för nya bolag löses även vid läsning; ingen omskrivning av
produktionsdata eller väntan på veckovis Ei-import behövs för täckningsvisningen.

Fortsatt öppet (Fas 2 är därför delvis):

- Jönköpings befintliga JSON provat på nytt från podden, HTTP 200: bara kategori/rubrik/HTML-text
  och tider, inga koordinater eller strukturerad adresslista. Ingen adapter byggd mot gissad geografi.
- Telge: publik Blazor-app; inget tillräckligt verifierat geometriflöde ännu.
- Borås och C4: driftsidor svarar; inget säkert flöde/precisionskontrakt identifierat ännu.
- Gotland: ArcGIS-punkt- och polygonlager svarar från podden och fixtures finns, men kundantalet är
  0 i samtliga poster vid provet, även ett pågående driftavbrott; tids-/områdesbetydelse behöver
  verifieras bättre innan det kopplas in. Vi har inte behandlat dessa nollor som bevis för berörda kunder.
- Övriga saknade elnät är inte färdiginventerade. Rangordningen i `electricity.json` kvarstår;
  arbetet har inte styrts av testportföljen.

### Fas 4: verifierade värmekällor

- Stockholm Exergi: Digpro `fpdh_fov`, podd HTTP 200, fulla svaret 19 poster/0 skipped.
  Ingen publicerad koncessionskarta vid `/bios/site/concession.kml` (404); inga påhittade nätområden.
- Vattenfall Värme: officiell sida länkar `https://heatoutagemap.vattenfall.se/NisOutageMap/`.
  GetApplicationData, StaticObjects och GetObjectsByTiles svarar 200 från podden.
  Scope `h`, åtta avbrott/0 skipped. Stationskoppling ger driftområdesprecision, aldrig SMS.
  Bara värmelagret är verifierat; ingen separat kyladapter antas från texter som nämner kyla.
- Solör Bioenergi: officiell driftinformationssida bäddar in ServiceAlert med kund-id
  `8db0da40-30d0-46f1-9edf-3ce22a771f48,eea230aa-0ed3-4d19-8681-d46b1f32c4d7`.
  Podd 200, två värmemeddelanden/0 skipped. Endast exakt observerade regionala profiltitlar mappas;
  VA Solna/Järfälla/Danderyd räknas inte som värme. Okänd avbrottstyp och starttid förblir okända.
- Umeå: samma redan verifierade blob, domän 2 värme/3 kyla; fulla svaret 34 poster/0 skipped.
- Mälarenergi: scope h har två meddelanden men StaticObjects har endast elområden (`p`).
  Att låna elnätets geometri skulle ge felaktig precision; värmeadaptern byggs därför inte.
- Öresundskrafts verifierade Trimble-flöde innehåller endast scope p (el). Den publika sidan visar
  värmetabeller, men ännu ingen verifierad koppling till kundernas avbrottsområden.
- Övriga värmebolag återstår att verifiera. Norrenergi-sidan kunde inte läsas med webbsökverktyget;
  det är inte bevis för att den saknar användbart flöde.

Fullparse-metadata: `phase4-pod-parsing.json`. Fixtures är riktiga poddsvar med kontaktuppgifter borttagna.

### Fas 5: vatten

SVOA: officiell `/driftinfo` använder `/driftinfo/Search`, sidor om 10 poster. Båda sidor lästes
från podden, HTTP 200: 18 poster, två vattenavstängningar (uttryckligen avslutade), 16 ovidkommande
bygg-/avfallsmeddelanden. Polygoner i `affectedAreaCoordinates`, latitude/longitude som strängar,
områdes-id grupperar ringar. Båda vattenposterna normaliserar utan skipped. Ny adapter läser alla
sidor och avvisar ändrat totalantal, upprepade id:n och ofullständiga listor. `expectedEndDate` blir
aldrig faktisk återställningstid. Datum utan klockslag gissas inte. Publicerade adresslistor finns,
men används ännu inte för matchning utanför polygonerna: ingen säker ortavgränsning verifierad.

Tekniska verken: `outage/list/?utility=water&brand=tekniskaverken` och shapes-POST med endast publika
ärende-id:n svarar 200 från podden. En Scheduled/planned och en Active/unplanned, båda Water,
publicerade polygoner, två normaliserade/0 skipped. Vattenlagret kräver egen opt-in.

Göteborg VA: ServiceAlert-svaret saknar publicerad yta i de granskade posterna; adresskoordinater
ensamma räcker inte för att rita ett område. Ingen ny aktiv Göteborg-VA-adapter byggd.
VA SYD första poddprov gav timeout; Uppsala har publika textmeddelanden, men inga verifierade
maskinläsbara områden i denna fas. Dessa stora organisationer återstår, inte avskrivna.

Kokning: ingen aktiv kokningsrekommendation observerades i de verifierade flödena. Strikta
rubrikregler stöds för SVOA och ServiceAlert, med syntetiska klassificeringsfall på riktiga ytor.
Allmänna råd i löptext utlöser inte en kokningsvarning. Produktionsbeteendet för ett verkligt sådant
meddelande är därför inte liveverifierat. Krisinformation publicerar redan kokningsnyheter
(t.ex. Hallstahammar, nyhetssidan 2026-11-19); vattenbesparingsmeddelanden tas inte in dubbelt.

### Fas 6: gas

Göteborg Energis aktuella och avslutade gas-KML samt upcoming-POST har verifierats från podden (200).
Samtliga var tomma; aktiv gaspost och faktisk återställning är inte liveverifierade. Gemensam Digpro-
normalisering återanvänds, inklusive separat gasflagga och SMS-kategorins avstängda spärr.
PostGIS provar gaspolygonens exakta träff, kategorin Heating och borttagning utan antagen återställning.

Gasnätet Stockholm är numera Driva Gasnät enligt den egna kundservicesidan
`https://www.drivagasnat.se/kundservice`. Gamla arbetssidan gav timeout från podden; den officiellt
länkade nya sidan `https://www.drivagasnat.se/arbeten` och startsidan svarar 200. Arbetstabellen anger
veckonummer/TBD och gator, inte säkra avbrottstider eller geografiska avbrottsområden. Ledningsarbete
är inte automatiskt ett leveransavbrott: ingen adapter byggd.
Weums startsida svarar 200 från podden; dess felanmälningslänk går till kontaktinformation,
`https://www.weum.se/kundservice/kontakta-oss`. Ingen publik maskinläsbar avbrottskarta identifierad.
Inga bolag kontaktade och inget konto skapat.
VA SYD omprov med officiell länk (gemener) gav åter timeout, inte belägg för att flöde saknas.

### Fas 8: helhet och drift

Täckningsrapport/källhälsa omfattar alla fem implementerade nyttigheter. Kommunbaserad VA-bedömning
begränsas till verifierade huvudmän: SVOA Stockholm/Huddinge, Tekniska verken Linköping. Detta är
bevakning av kommunens information, inte bekräftelse på enskild VA-anslutning. Källa:
- https://www.stockholmvattenochavfall.se/villa-och-radhus/vatten-och-avlopp/ordlista-for-vatten-och-avlopp/
- https://tekniskaverken.se/privat/vatten-avlopp
Inga värme-/gasområden uppfinns från elkoncessioner eller kommunnamn. Dessa förblir Ej bedömd.
Partialsvar visas som ofullständiga och behöver åtgärd direkt; fullgod täckning kräver senaste status ok.

Umeås publika blob skickar ETag, verifierat med HEAD från podden (200). GET-hämtningar skickar
If-None-Match när ETag finns och återanvänder kroppen vid 304; oombedd 304 blir fel, aldrig tomt svar.
Processcachen är begränsad. SVOA HEAD gav 404 trots fungerande GET; ingen HEAD-förfrågan används i
adaptern. SVOA kontrollerar första sidan på nytt efter paginering för att avvisa flyttande listor.

Kommande avstängningar visas endast när tidslinjeflaggan är på, vatten/värme/kyla är planerat,
matchningen hög/medel, start inom 48 timmar, explicit slut efter start och källan sedd senaste 20 min.
Okänd sluttid blir ingen påhittad stapel. Leverantörens text och länk följer med till dator/mobil.
Riskfaktorns namn och omfattning är fortfarande El och värme enligt ägarbeslut.

### Kompletterande slutgranskning

Den nationella operatörskatalogen från Elsamverkan svarade 200 från podden. Av de saknade näten
kunde 81 kandidatsidor matchas entydigt i katalogen (en heuristisk sökväg, inte ny täckning).
Sekventiell genomsökning i kundordning: 66 sidor svarade, 15 kunde inte läsas lokalt.
23 namn gav inte entydig katalogmatchning; bland dem finns redan separat undersökta eller tillagda
bolag. `national-discovery.json` och `directory-unmapped.json` bevarar resultatet. Tom plattformslista
betyder att denna begränsade HTML-sökning inte hittade en adapter, inte att bolaget saknar ett flöde.
Enda nya Digpro-fingeravtrycket var Härryda (`instwebb.harrydaenergi.se`, hra). Både KML och
koncession gav timeout från podden; därför byggs ingen adapter. Svensk utgång är inte provad där.

Mälarenergi kunde däremot kompletteras efter fördjupad verifiering. Värmescope h anger 77 områdes-id:n
som matchar StaticObjects exakt, trots att geometrins kontext är p. Den publika klienten laddar
gemensam StaticObjects, och kartpunkter för värme är uttryckligen `_nt: h`, `t: po` med aktuellt
avbrotts-id. Synkroniserade app/static/tiles från podden gav två el- och två värmeavbrott, 0 skipped.
Ny flagga SOURCE_UTILITY_MALAR_HEAT_ENABLED=false. Samma operatörsjobb hämtar båda lager, ingen
extra parallell poller; elens id:n bevaras, värmens id:n har eget nyttighetsnamn och stationer filtreras
per scope även vid id-kollision. Precision förblir områdesnivå, aldrig SMS. Tidigare anteckning om
saknade värmeområden är ersatt av denna verifierade id-koppling; inga elkoncessioner blir värmenät.

Tidslinjens gemensamma rubrik anger nu leverantörer när avstängningar visas, så dessa inte
felaktigt tillskrivs SMHI. Varje rad har sin egen publika källänk.

Slutlig nationell mätning: `current-electricity-coverage.json` använder en ny SELECT med enabled,
senaste fullständiga ok och högst 20 min ålder. Samma elbaslinje bekräftades: 3 859 845/5 612 871
(68,7677 %). Inget har ändrats i produktion.
Med fyra nya elbolag tillkommer 335 510 abonnemang i leverantörernas kundbas. Ny parser gör dock
Oxelös El-profil korrekt partial: ett aktuellt meddelande saknar ritad yta, bekräftat med nytt poddprov.
Därför är den konservativa potentialen **4 188 932/5 612 871 = 74,6308 %**, inte den tidigare
övre gränsen 74,7453 %. Skillnaden är Oxelös 6 423 abonnemang. Vattenflaggan var av i detta
kompatibilitetsprov. Detta är leverantörstäckning, aldrig andel exakt polygon-/SMS-bevakade adresser.
Värmens fulla nationella andel är inte verifierad. En säker särredovisad del är Göteborg 14 205
av totalt 351 520 kundrelationer (4,0410 %); med Exergis enskilt redovisade Stockholmsnät blir den
potentiella nedre gränsen 25 317 (7,2022 %). Andra nät tillgodoräknas inte som hela bolag utan verifierad
omfattning. VA:s tre verifierade kommuner har 1 282 639 invånare (12,0941 % av SCB-totalen),
vilket är befolkningsproxy och inte kundandel. Göteborg gas har 7 005 av Ei:s 75 278 redovisade
abonnemang (9,3055 %), men jämförbarheten med hela landets stadsgas är ännu inte verifierad.
`coverage-summary.json` bevarar beräkningarna och dessa begränsningar.

Med samtliga nya nyttigheter på i samma ServiceAlert-jobb ger EEM:s koordinatbaserade VA-meddelande
också partial för hela operatören. Det försiktiga gemensamma hälsomåttet tar då inte heller med
EEM:s 46 931 elabonnemang. Allt-på-potentialen i dessa fångade svar blir **73,7947 %**, medan
74,6308 % gäller elutbyggnad med vatten av. Oberoende hälsa per nyttighetslager i ett gemensamt jobb
är en kvarstående förbättring; nu kan fel i ett lager sänka bevakningsräkningen för de andra.
`expanded-servicealert-parse.json` visar exakt vilka svar som blev partial. Produktion är oförändrad.
