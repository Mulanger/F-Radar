# Fler avbrott – vatten, fjärrvärme, gas, bredband och mer – implementationsplan

**Status:** Utkast 2026-11-18, skrivet på produktägarens begäran. **Inte påbörjat.** Genomförs senare,
en fas i taget, på produktägarens uttryckliga begäran.
**Bygger på:** [`stromavbrott.md`](stromavbrott.md) – elavbrotten (Fas 1–5, live sedan 2026-11-14). Allt
som står där om regler, precision, livscykel och ärlighet gäller även här om inte annat sägs.
**Underlag:** Inga nya källor är verifierade ännu. Källorna i avsnitt 4 är **kandidater** som Fas 0 ska
undersöka. Bygg aldrig en adapter mot en källa som inte svarat live och sparats som fixture.

---

## 0. Instruktioner till agenten som genomför en fas

1. Läs **hela** detta dokument och hela `stromavbrott.md` innan du börjar. Läs också
   [`docs/decisions/0003-riskindex.md`](../decisions/0003-riskindex.md), [`docs/sources.md`](../sources.md)
   och `IMPLEMENTATION.md` §1, §3.3 och §12.
2. Gör **bara den fas** produktägaren bett om. Påbörja aldrig nästa fas på eget initiativ.
3. Kör `git status` först. Har någon annan ocommittade ändringar i filer du behöver: stanna och fråga.
4. Migreringar är framåtriktade och checksummade. Ta **nästa lediga nummer** i `packages/db/migrations/`.
   Ändra aldrig en befintlig migrering.
5. Verifiera varje källa live innan du skriver adaptern och spara riktiga svar som fixtures
   (`packages/integrations/test/fixtures/utility-outages/<operator>-<beskrivning>.<json|kml|xml>`).
   Trimma till ett fåtal poster men behåll alla fält. Ta bort personuppgifter (namn, telefonnummer).
6. Kontakta aldrig bolag eller kommuner. Skicka inga personuppgifter i anrop. Logga aldrig rådata med
   adresser.
7. Driftsätt och pusha inte utan uttrycklig begäran. Varje ny nyttighet och varje ny operatör ska vara
   **avstängd som standard** (env-flagga) tills produktägaren slår på den.
8. Podden står i Frankrike: vissa svenska kommunsajter blockerar utländska IP-adresser eller har
   ofullständiga TLS-kedjor (se `stromavbrott.md` faslogg). Testa alltid hämtningen **från podden**
   (`node scripts/instapods.mjs exec -- curl …`), inte bara lokalt.
9. Avsluta varje fas med att fylla i **Fasloggen** (avsnitt 10) och uppdatera
   `docs/implementation-progress.md`. Skriv ärligt vad som inte är verifierat.
10. Om verkligheten avviker från planen: välj det försiktigaste beteendet (visa mindre, skicka färre
    SMS), dokumentera avvikelsen och fråga produktägaren om den påverkar kundlöftet.

---

## 1. Mål och kundlöfte

Fastighetsägare behöver veta när något som fastigheten är beroende av slutar fungera eller ska stängas av:
el (finns), värme, vatten, avlopp, gas och kommunikation. Vi ska ge dem samma sak som för el:

- **planerade** avstängningar i god tid (händelseflöde, fastighetssida och "Kommande förhållanden");
- **oplanerade** avbrott medan de pågår, med kartan över det berörda området;
- besked när det är åtgärdat – men bara om leverantören själv säger det (se `stromavbrott.md` 5.4);
- **SMS endast vid exakt träff** (fastighetens punkt inom området eller adressen i leverantörens lista);
- ärlig täckning: "Bevakas", "Bevakas inte ännu" eller "Ej bedömd" per nyttighet och fastighet.

**Smart, inte mycket:** hellre fem väl matchade källor där kunderna har fastigheter än femtio som ger
brus. Varje ny källa ska antingen ge exakta områden/adresser eller tydligt märkas som områdesnivå.

---

## 2. Regler (utöver `stromavbrott.md` §2)

### 2.1 Gemensamt
- Samma pipeline som el: `operators.ts` → plattformsadapter → `utility_outages` + `source_events` →
  matchning → flöde, fastighetssida, karta, kvittering och SMS. **Bygg inte en parallell pipeline.**
- Leverantörens egen text visas ordagrant och märks som leverantörens. Våra texter är beskrivande.
- Skriv aldrig att fastigheten *saknar* vatten, värme eller internet. Skriv att leverantören registrerat
  ett avbrott i ett område som omfattar fastighetens adress.
- Ett trasigt flöde får aldrig se ut som "inga avbrott". Okänd tid gissas aldrig.
- Kvittering (`feedNeedsAck` i `packages/domain/src/feed-acknowledgement.ts`) gäller i dag alla
  `utility_outages`-rader med `monitor` eller högre. Varje fas ska uttryckligen bestämma om den nya
  nyttigheten ska kräva kvittering (förslag i avsnitt 3).

### 2.2 Vatten och avlopp
- **Kokningsrekommendation** (kokningsrekommendation, "koka vattnet") är en hälsoinformation från
  kommunen. Den visas som röd händelse när fastigheten ligger inom området – även på områdesnivå,
  eftersom kommunen själv avgränsar det. Texten är kommunens, ordagrant. SMS bara vid exakt träff,
  som för el.
- Vattenläcka/avstängning: samma tabell som el (`stromavbrott.md` 5.3), med "vatten" i stället för "ström".
- Bevattningsförbud och uppmaningar att spara vatten är **information**, aldrig röda, aldrig SMS.
  (Krisinformation publicerar redan en del, t.ex. "Risk för vattenbrist" – dubblera inte.)

### 2.3 Bredband, fiber och mobilnät
- Telekom publiceras nästan alltid per område, postnummer eller "delar av ort". Behandla det som
  **områdesprecision**: blå informationsrad, ingen status, **inget SMS**, ingen kvittering, tills
  produktägaren beslutat annat.
- En fastighet kan ha flera operatörer (fiber från stadsnät, tjänst från Telia/Bahnhof …). Vi vet inte
  vilken fastigheten använder. Säg därför "{operatör} har registrerat en störning i området", aldrig att
  fastighetens uppkoppling påverkas.
- "Inga registrerade störningar" får **aldrig** visas för telekom – täckningen kan inte bli fullständig.

### 2.4 Hämtning
- Högst var 5:e minut per källa (minimum 120 s), sekventiellt, timeout 30 s, ETag där det finns.
  Kommunala sidor som uppdateras sällan: var 15:e minut räcker.
- User-Agent `FastighetsRadar-avbrottsbevakning/1.0`. Inga cookies, ingen inloggning, inga nycklar som
  kräver avtal. Kräver en källa något av det: hoppa över den och notera i avsnitt 9.
- Visa källa med länk till leverantörens **publika** driftstörningssida.

---

## 3. Vilka avbrott vi kan täcka

| Nyttighet (`utility`) | Varför fastighetsägare bryr sig | Vanliga publicerare | Trolig precision | Prioritet | Kvittering |
|---|---|---|---|---|---|
| `district_heating` (finns) | Kallt i lägenheter, varmvatten, klagomål | Energibolag (Stockholm Exergi, Norrenergi, Söderenergi, E.ON, Vattenfall Värme …) | Polygon, adresslista, ibland bara text | **Hög** – Stockholm saknas helt i dag | Ja (som el) |
| `water` (ny) | Ingen vattenleverans, tryckfall, läcka i gatan, kokningsrekommendation | Kommunernas VA-organisationer (Stockholm Vatten och Avfall, VA SYD, Kretslopp och vatten …), ofta via ServiceAlert | Adresslista, polygon, punkt + radie | **Hög** | Ja; kokningsrekommendation alltid |
| `sewage` (ny, kan slås ihop med `water`, se 5.1) | Avloppsstopp, spolning, översvämning i källare | Samma VA-organisationer | Adresslista, gata | Medel | Ja vid exakt träff |
| `gas` (finns i typen, ingen källa) | Spisar, pannor i äldre fastigheter | Göteborg Energi (gas), Gasnätet Stockholm, Weum Gas (Skåne) | Polygon (Göteborg: samma Digpro-KML som el) | Medel | Ja |
| `district_cooling` (finns, 1 källa) | Kontor, serverhallar, butiker | Energibolag (Stockholm Exergi, Göteborg Energi, Norrenergi) | Polygon, text | Låg–medel | Ja |
| `broadband` (ny) | Hyresgäster utan internet, larm och passersystem | Stadsnät och kommunikationsoperatörer (Open Universe, Zitius, IP-Only, Telia, stadsnät) | Område, postnummer, ort | Medel | Nej (2.3) |
| `mobile` (ny) | Larm, hissnödtelefoner, passersystem på mobilnät | Telia, Tele2, Telenor, Tre | Område, ort | Låg | Nej |

**Utanför denna plan** (kan bli egna planer senare): störningar i sophämtning, kommunala
schaktarbeten och ledningsarbeten i gatan (trafikanordningsplaner), hissar och fastighetens egna
system. De är inte avbrott i en leverans och har andra källor.

---

## 4. Kandidatkällor (overifierade – Fas 0 verifierar)

### 4.1 Snabba vinster i befintlig kod
1. **ServiceAlert (sms-service.dk)** – `platforms/servicealert.ts`. Plattformen används av många
   kommunala bolag, och just för **vattenavstängningar**. Adaptern hämtar redan alla meddelanden per
   konfigurerad kund men slänger profiler som inte börjar med "Elnät", "Fjärrvärme" eller "Fjärrkyla"
   (`serviceAlertProfile`, rad ~45). Fas 0: lista alla profiltitlar som förekommer hos våra kunder
   (Karlstad, Mölndal, Oxelö, Söderhamn, Ljusdal, Ulricehamn, EEM …) och vilka fler kommuner som har
   ServiceAlert-sidor. Varje VA-profil blir `water`/`sewage` med samma geometri (punkt + radie eller
   polygon) som el.
2. **Göteborg Energi gas** – `platforms/goteborg.ts`. Svaret innehåller redan typen `Gas` och en KML-länk
   (`FilteredOutagesKml.ashx?type=36857929`) med samma Digpro-fält som el. Operatören är konfigurerad
   utan `gas` i `utilities` (`operators.ts`). Lägg till och verifiera.
3. **Digpro** – samma tillverkare har VA- och fjärrvärmeprodukter. Kontrollera om Digpro-kunderna
   (`digpro:*`) har fler `app=fpp_*`-applikationer än el (t.ex. vatten/värme) i sina outagemap-sidor.

### 4.2 Fjärrvärme och fjärrkyla
- **Stockholm Exergi** (Stockholm, störst i landet) – driftstörningssida/karta. Högsta prioritet:
  fem av våra nio fastigheter ligger i Stockholm.
- Norrenergi (Solna/Sundbyberg), Söderenergi/Telge, E.ON Värme, Vattenfall Värme (Uppsala),
  Mälarenergi värme, Öresundskraft, Kraftringen (värme), Skellefteå Kraft (värme), Jämtkraft (värme),
  Uddevalla Energi (finns redan via Digpro för el – kontrollera värme).
- Katalog att utgå från: Energiföretagen Sveriges lista över fjärrvärmeföretag.

### 4.3 Vatten och avlopp
- **Stockholm Vatten och Avfall** (Stockholm) – "Driftstörningar"-karta. Högst prioritet.
- Kommunernas VA-huvudmän där våra fastigheter ligger: Stockholm, Skellefteå, Östersund (Östersunds
  kommun/Vatten), Uddevalla. Därefter de största: VA SYD (Malmö/Lund), Kretslopp och vatten (Göteborg),
  Uppsala Vatten, Norrvatten-kommunerna, SVOA, Nacka vatten och avfall, Roslagsvatten.
- Katalog: Svenskt Vattens medlemslista (VA-organisation per kommun). **En kommun = en VA-huvudman**,
  så täckning kan avgöras per kommun (se 5.4) – enklare än el.
- Kokningsrekommendationer: kommunens egen sida, ibland Krisinformation. Kontrollera om
  Krisinformationsflödet redan fångar dem innan en egen källa byggs.

### 4.4 Gas
- Göteborg Energi (4.1), Gasnätet Stockholm, Weum Gas/E.ON (Skåne).

### 4.5 Bredband, fiber och mobil
- Kommunikationsoperatörer och stadsnät: Open Universe, Zitius, IP-Only, Telia (Öppen fiber),
  Bahnhof, kommunala stadsnät. Många har "driftinformation" per ort/postnummer.
- Mobil: Telia, Tele2, Telenor, Tre har störningskartor. Ofta tunga klientappar – kartlägg API bakom.
- Utred om PTS eller någon branschaktör samlar störningar (troligen inte – kontrollera ändå).

### 4.6 Metod för kartläggning (samma som el)
1. Hitta leverantörens publika störningssida.
2. Öppna den i webbläsaren, läs nätverkstrafiken och leta efter JSON/KML/XML bakom kartan.
3. **Fingeravtryck plattformen** – samma tillverkare = en adapter för många bolag (som Digpro, Trimble,
   ServiceAlert för el). Utöka `scripts/discover-outage-platforms.mjs` med VA-/värme-/telekomkataloger.
4. Notera: format, geometrityp, fält för typ (planerat/oplanerat), tider, antal berörda, adresser,
   uppdateringstakt, om det fungerar från podden.

---

## 5. Arkitektur

### 5.1 Nyttigheter och kategorier
- Utöka `UTILITY_KINDS` (`packages/domain/src/utility-outages.ts`) med `water`, `sewage`, `broadband`,
  `mobile`. Fas 0 avgör om `sewage` ska vara egen eller ingå i `water` (beror på om källorna skiljer dem
  åt – gör de inte det: en gemensam `water` med etiketten "Vatten och avlopp").
- `EventCategorySchema` har `Water` för hydrologi (vattenstånd, flöde). Blanda inte ihop: lägg till
  `WaterSupply` och `Telecom` (och använd befintliga `Power`/`Heating`; gas → `Heating` eller egen `Gas`,
  beslut i Fas 1).
- Migrering: utöka CHECK-villkoret på `utility_outages.utility` och eventuella enum-kopior i SQL.
- UI-etiketter och ikoner per nyttighet: `KIND_SV` i `apps/web/lib/view-models/utility-outages.ts`,
  `UTILITY_LABEL` i `packages/db/src/monitoring.ts` (`outageItemOf`), ikoner i `EVENT_MAP_ICONS`
  (`water` finns, lägg till t.ex. `wifi`/`signal`, `flame`/`gas`).
- Rubriker: `outageHeadline` och `utilityNoun` måste kunna säga "vattenavbrott", "planerad
  vattenavstängning", "fjärrvärmeavbrott", "störning i bredbandsnätet" – utan att påstå att fastigheten
  berörs.

### 5.2 Precision och matchning
- Återanvänd matchmetoderna i `stromavbrott.md` 5.3 oförändrade (`outage_polygon`, `outage_address`,
  `outage_street`, `outage_adjacent`, `outage_point`, `outage_postal_area`, `outage_area`).
- VA publicerar ofta **adresslistor** eller "Kungsgatan 1–15". Adressmatchningen från el (Fas 4,
  `stromavbrott.md` 5.6) används. Intervall ("1–15", "jämna nummer") tolkas bara när formatet setts i
  riktiga data och har tester.
- Telekom: matcha bara på område/postnummer/ort; alltid områdesprecision (2.3).

### 5.3 Livscykel
- Samma som el (`stromavbrott.md` 5.4): debounce, `missing_polls`, `PLATFORMS_REPORTING_RESTORED`,
  `restored_inferred`, version utan kundantal. Lägg varje ny plattform i rätt grupp: rapporterar den
  själv "åtgärdat" eller tar den bara bort ärendet?

### 5.4 Täckning per nyttighet
| Nyttighet | Hur vi vet vem som levererar | "Bevakas" kräver |
|---|---|---|
| El | Ei:s nätkoncessioner (finns) | operatören aktiv och aktuell |
| Fjärrvärme/fjärrkyla | Ingen nationell karta. Bolagets nätområde om publicerat, annars kommun | operatörens område täcker fastigheten |
| Vatten/avlopp | Kommunen (en VA-huvudman per kommun) | kommunens VA-källa aktiv och aktuell |
| Gas | Bolagets nätområde (få bolag) | dito |
| Bredband/mobil | Går inte att veta | visas aldrig som "bevakas" (2.3) |

Riskfaktorn "El och värme" (`packages/domain/src/risk-index.ts`) blir "Försörjning" (el, värme, vatten,
gas) – **beslut av produktägaren** i Fas 1. Telekom påverkar aldrig riskindex.

### 5.5 Det som redan fungerar automatiskt
När en ny nyttighet går genom `utility_outages` får den utan extra kod: rader i händelseflödet och på
fastighetssidan, kvittering (2.1), kartan i flödet och på fastighetssidan (polygoner), grå karta för
avslutade och bevakningsstatusen i riskfaktorn "El och värme". Kontrollera ändå varje del med tester – rubriker,
etiketter och färger är elspecifika på flera ställen.

### 5.6 "Kommande förhållanden"
Planerade avstängningar (vatten, fjärrvärme) som börjar inom 48 h passar i tidslinjen i
"Kommande förhållanden" (stapel från start till slut). Lägg dem som egen typ med egen chip
("Avstängningar") – men bara vid hög/medel precision. Beslut av produktägaren i den fas där det blir
aktuellt.

---

## 6. SMS

- Nya kategorier i notifieringsmotorn: `water_outage` (inkl. kokningsrekommendation), `heating_outage`
  (finns delvis via `power_outage`? kontrollera), `gas_outage`. Telekom får ingen SMS-kategori i denna plan.
- Samma behörighet som el: bara exakt träff (`outage_polygon`, `outage_address`), bara bekräftad
  position, ingen bakåtfyllnad, ett start-SMS per avbrott och mottagare, "åtgärdat" bara till dem som
  fick start-SMS och bara om leverantören själv rapporterar det.
- Kokningsrekommendation: får passera tysta timmar om regeln tillåter undantag (som oplanerat elavbrott).
- SMS-texter max en del. Exempel: "Stockholm Vatten och Avfall har registrerat en vattenavstängning som
  omfattar Exempelgatan 3, idag 09:00–14:00." – aldrig "ni saknar vatten".
- SMS är simulerat i dag (`SMS_MODE`). Ändra inte det.

---

## 7. Faser

Varje fas: avstängd som standard, fixtures från riktiga svar, tester, faslogg. Ordningen följer var
kundernas fastigheter ligger (live 2026-11-18: Stockholm ×5, Skellefteå, Östersund, Uddevalla) och
värde per arbete.

### Fas 0 – Kartläggning (ingen produktionskod)
1. Läs-endast-fråga mot podden: vilka kommuner och postnummer har fastigheterna? Prioritera källor efter det.
2. ServiceAlert: lista alla profiltitlar hos konfigurerade kunder och hitta fler kommuner med
   ServiceAlert-sidor (vatten!). Spara exempel.
3. Göteborg Energi gas-KML: verifiera från podden.
4. Stockholm Exergi, Stockholm Vatten och Avfall, VA i Skellefteå, Östersund och Uddevalla: hitta
   flödet bakom kartan enligt 4.6.
5. Fingeravtryck: vilka VA-/värmeplattformar används av många bolag? Utöka
   `scripts/discover-outage-platforms.mjs`.
6. Telekom: kartlägg 3–4 stora operatörer, bara för att avgöra om det är värt en fas.
7. **Leverans:** en tabell i detta dokument (avsnitt 4) med varje källa: URL, format, geometri,
   typ/tider/antal, fungerar från podden (ja/nej), plattform, rekommendation. Plus beslutsfrågor till
   produktägaren (5.1 kategorier, 5.4 riskfaktor, 5.6 kommande, 2.3 telekom).

### Fas 1 – Grund + snabba vinster
- Nya nyttigheter och kategorier (5.1), migrering, etiketter, ikoner, rubriker, täckningsmodell (5.4).
- ServiceAlert: mappa VA-profiler (och fler värmeprofiler) i `serviceAlertProfile`.
- Göteborg Energi: aktivera `gas`.
- Tester: rubriker och texter för varje nyttighet, att telekom aldrig ger SMS eller "Inga störningar",
  att kvittering följer avsnitt 3.

### Fas 2 – Fjärrvärme där kunderna finns
- Stockholm Exergi först, sedan de källor Fas 0 rekommenderat (Norrenergi, Söderenergi, Skellefteå Kraft,
  Jämtkraft, Uddevalla …). Fjärrkyla från samma bolag i samma fas.

### Fas 3 – Vatten och avlopp
- Stockholm Vatten och Avfall, sedan VA-huvudmännen i kundernas kommuner, sedan plattformar med många
  kommuner. Adressmatchning för adresslistor. Kokningsrekommendationer (2.2).
- SMS-kategori `water_outage` (6), avstängd tills produktägaren slår på den.

### Fas 4 – Gas
- Göteborg Energi (från Fas 1) plus Gasnätet Stockholm och Weum Gas om Fas 0 hittat användbara flöden.

### Fas 5 – Bredband och mobil (beslutsgrind)
- Görs bara om produktägaren efter Fas 0 bestämt att det är värt det. Informationsrader på områdesnivå
  (2.3), inga SMS, ingen kvittering, ingen "Inga störningar".

### Fas 6 – Drift och helhet
- Hälsa per källa och nyttighet i statusvyn (samma "attention"-flagga som el), täckningsrapport per
  fastighet och nyttighet, riskfaktorn "Försörjning" (efter beslut), "Kommande förhållanden" (5.6).

---

## 8. Testkrav (varje fas, för det fasen rör)
- Adaptrar: fixtures från riktiga svar, ogiltiga poster räknas i `skipped`, tomt svar = inga avbrott,
  trasigt svar ≠ inga avbrott, svensk tid och sommartid.
- Matchning: polygon, adresslista, intervall (bara bekräftade format), områdesnivå.
- Texter: varje nyttighet och läge (planerat, pågår, åtgärdat, försvunnet) – inga överdrifter, aldrig
  "saknar vatten/värme/internet".
- SMS: bara exakt träff; telekom aldrig; kokningsrekommendation enligt 2.2.
- Webb: flödesrad, fastighetssida, karta (polygon), kvittering per avsnitt 3.
- Kör hela sviten (`npx vitest run`), typer och lint. PostGIS-tester i podden via
  `scripts/run-real-db-tests.mjs` (delad testdatabas – inte samtidigt som en annan agent).

---

## 9. Kända okända (håll listan aktuell)
- Vilka VA-organisationer publicerar maskinläsbara störningar alls, och hur stor andel använder
  ServiceAlert eller annan delad plattform.
- Om Stockholm Exergi och Stockholm Vatten och Avfall har ett flöde bakom kartan som fungerar från podden.
- Om leverantörerna skiljer på vatten och avlopp (avgör 5.1).
- Om kokningsrekommendationer redan når oss via Krisinformation.
- Om telekomoperatörernas kartor går att läsa utan inloggning och utan tunga klientappar.
- Om någon källa kräver avtal eller nyckel (då hoppar vi över den – kontakta inte bolaget).

---

## 10. Faslogg (fylls i av agenten)

| Fas | Datum | Commit | Vad som gjordes | Inte verifierat / avvikelser |
|---|---|---|---|---|
| – | – | – | – | – |
