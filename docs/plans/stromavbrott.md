# Strömavbrott och fjärrvärmeavbrott – implementationsplan

**Status:** Godkänd av produktägaren 2026-11-14. Genomförs **en fas i taget**.
**Underlag:** Källundersökning 2026-11-14 (avsnitt 4). Alla endpoints nedan svarade då utan nyckel,
inloggning eller cookies. De är **odokumenterade** och kan ändras – verifiera alltid innan du bygger.

---

## 0. Instruktioner till agenten som genomför en fas

1. Läs **hela** detta dokument innan du börjar, även faser du inte ska göra. Läs också
   [`docs/decisions/0003-riskindex.md`](../decisions/0003-riskindex.md) (språk- och överdrivsregler),
   [`docs/sources.md`](../sources.md) och `IMPLEMENTATION.md` §1, §3.3 och §12.
2. Gör **bara den fas** produktägaren bett om. Påbörja aldrig nästa fas på eget initiativ.
3. Kör `git status` först. Om någon annan har ocommittade ändringar i filer du behöver: stanna och fråga.
4. Migreringar är framåtriktade och checksummade (`packages/db/src/migrations.ts`). Ta **nästa lediga
   nummer** i `packages/db/migrations/`. Ändra aldrig en befintlig migrering.
5. Verifiera varje endpoint live innan du skriver adaptern, och spara riktiga svar som fixtures
   (`packages/integrations/test/fixtures/utility-outages/<operator>-<beskrivning>.<json|kml>`).
   Trimma fixtures till ett fåtal poster men behåll alla fält.
6. Kontakta aldrig nätbolag, skicka inga personuppgifter i anrop, logga inte rådata med adresser.
7. Driftsätt inte och pusha inte utan att produktägaren uttryckligen ber om det. Källan ska vara
   **avstängd som standard** (env-flagga) tills produktägaren slår på den.
8. Avsluta varje fas med att fylla i **Fasloggen** längst ner (avsnitt 13) och uppdatera
   `IMPLEMENTATION_PROGRESS.md`. Beskriv ärligt vad som inte är verifierat.
9. Om verkligheten avviker från planen (endpoint borta, fält betyder något annat): välj det
   försiktigaste beteendet (visa mindre, skicka färre SMS), dokumentera avvikelsen och fråga om beslutet
   påverkar kundlöftet.

---

## 1. Mål och kundlöfte

Kunder med fastigheter i F-Radar ska:

- se **planerade** avbrott (el, senare fjärrvärme/fjärrkyla) i dashboardens händelseflöde och på
  fastighetssidan, med datum, tid och nätbolagets text;
- se **oplanerade** avbrott som **röda** händelser och röd fastighetsstatus medan avbrottet pågår;
- se när strömmen är tillbaka;
- kunna få **SMS** – men **endast** när fastighetens adress faktiskt ligger inom det område nätbolaget
  publicerat som berört. Kunder vars fastigheter inte berörs får **ingenting**.

**Slutmål (efter sista fasen):** Alla stora och de flesta medelstora elnätsbolag bevakas (storstäderna
och majoriteten av elkunderna), fjärrvärme/fjärrkyla där bolagen publicerar det, ärlig täckningsvisning
per fastighet ("bevakas" / "bevakas inte ännu" / "ej bedömd"), och SMS endast vid exakt träff.

---

## 2. Regler som aldrig får brytas

### 2.1 Anti-spam – vem som får SMS
- SMS kräver **hög precision** (avsnitt 5.3): fastighetens punkt ligger **inom** avbrottets polygon,
  eller fastighetens gatuadress **med husnummer** står i nätbolagets adresslista.
- Postnummerområde, kommun, "i närheten", punkt-avbrott och kantträffar ger **aldrig** SMS.
- Fastigheter med osäker position (`geocode_precision` ≠ `building` och `position_source = 'geocoded'`)
  nedgraderas: de får dashboardhändelse men **inget SMS**. `manual_pin`/`manual_adjusted` räknas som
  bekräftad position.
- Samma avbrott ger högst **ett** start-SMS per mottagare och fastighetsgrupp. Ändrat antal berörda
  kunder ger aldrig nytt SMS.
- "Strömmen är tillbaka" skickas bara till mottagare som fick start-SMS för samma avbrott.
- Befintliga gränser i SMS-motorn gäller fullt ut (cooldown, dagliga gränser, tysta timmar, kostnadstak).
- Ingen bakåtfyllnad: avbrott som fanns innan regeln aktiverades ger inga SMS (befintlig regel i
  `eventEligible`).

### 2.2 Ärlighet (ADR 0003-principer)
- Våra egna texter är beskrivande: "Oplanerat strömavbrott registrerat av Vattenfall Eldistribution".
  Använd aldrig "kris", "fara" eller "akut" i texter vi genererar. Nätbolagets egen text visas ordagrant
  och märks som nätbolagets.
- Skriv aldrig att fastigheten *saknar* ström. Skriv att nätbolaget registrerat ett avbrott i området
  som omfattar fastighetens adress.
- **"Inga registrerade avbrott" får bara visas** om (a) fastigheten ligger inom ett bevakat nätbolags
  nätområde och (b) det nätbolagets flöde är aktuellt. Annars "Ej bedömd" eller "Nätet bevakas inte ännu".
- Saknat/okänt värde visas som "—", aldrig 0. Okänd starttid/sluttid gissas aldrig.
- Ett trasigt flöde får aldrig se ut som "inga avbrott".

### 2.3 Hämtning och juridik
- Hämta högst var 5:e minut per nätbolag (konfigurerbart, minimum 120 s), sekventiellt, timeout 30 s.
  Respektera `ETag`/`If-None-Match` och `max_age` där de finns (Ellevio).
- User-Agent: `FastighetsRadar-avbrottsbevakning/1.0`. Inga personuppgifter i anrop.
- Visa källa: "Källa: <nätbolag> – avbrottskarta" med länk till nätbolagets **publika kartsida**
  (inte API-adressen).
- Varje nätbolag ska kunna stängas av individuellt via env (avsnitt 9) utan kodändring – om ett bolag
  ber oss sluta.
- Riskpoängen (ADR 0003) påverkas **inte** av avbrott förrän produktägaren godkänt det (Fas 5).

---

## 3. Begrepp

| Begrepp | Betydelse |
|---|---|
| **Operatör** (`operatorId`) | Ett nätbolag i vår konfiguration, t.ex. `vattenfall`, `ellevio`, `digpro:vax`, `goteborg_energi` |
| **Plattform** | Teknisk familj som delar dataformat: `vattenfall`, `ellevio`, `digpro`, `trimble`, `servicealert`, `eon`, `custom:<namn>` |
| **Nyttighet** (`utility`) | `electricity`, `district_heating`, `district_cooling`, `gas` |
| **Typ** (`kind`) | `planned`, `unplanned`, `unknown` |
| **Läge** (`state`) | `upcoming` (planerat, ej startat), `ongoing`, `restored`, `withdrawn` (försvann före start), `unknown` |
| **Precision** | Hur säkert en träff gäller fastigheten, se 5.3 |
| **Nätområde** | Koncessionsområde där operatören äger nätet (`grid_concession_areas`) |

---

## 4. Verifierade källor (2026-11-14)

Katalog över alla svenska nätbolag med länk till störningssida:
`https://elsamverkan.se/umbraco/surface/OrganizationList/GetOrganizationList` (HTML, ~257 poster).

### 4.1 Vattenfall Eldistribution (~900 000 kunder) – plattform `vattenfall`
- Data: `GET https://arkmap.vattenfalleldistribution.se/incidents.json`
- Publik karta: `https://www.vattenfalleldistribution.se/stromavbrott/pagaende-stromavbrott/`
- Hela landet i ett svar (~560 kB med 159 avbrott).
```json
{"warnings":{"lastUpdate":"2026-11-14 13:22","warning":[{
  "id":"INCD-7860-A","status":7,"placenames":"INGARÖ",
  "affectedAreas":[{"affected":20,"areacode":13464,"muni":120}],
  "description":"Kommande planerat avbrott","affectedCustomers":20,
  "polygon":[59.27957,18.50593, 59.27982,18.50588, …],
  "freeText":"Strömförsörjningen till er anläggning kommer att påverkas av ett planerat arbete den 30-NOV-2026, mellan 09:00 och 14:00. …",
  "startTime":"2026-11-30 09:00","completionTime":""}]}}
```
- `polygon` är en **platt array i ordningen lat, lon** (omvänt mot GeoJSON). `areacode` = postnummer,
  `muni` = kommunkod utan inledande nolla (120 → 0120 Värmdö). Tider är svensk lokal tid.
- **Okänt:** statuskoder för oplanerade/pågående avbrott (bara `7` = kommande planerat observerat).
  Adaptern ska mappa kända koder, logga okända (`warn`, utan adressdata) och behandla okända som
  `kind: 'unknown'` (se 5.4). Fånga en fixture med oplanerat avbrott så fort ett sådant finns.

### 4.2 Digpro dpPower "outagemap2" – plattform `digpro`
Används av många små och medelstora nätbolag. Samma format överallt; skiljer sig bara i värd och kundkod.
- Kartsida: `https://<värd>/outagemap2/?cust=<kod>&app=fpp` (`fpdh` = fjärrvärmelager där det finns).
- Konfiguration: `GET https://<värd>/bios/rest/outagemap/config/<kod>`
- Avbrott (KML): `GET https://<värd>/bios/servlet/sys.outagemap.servlets.api.GetOutagesKML?app=fpp_<kod>`
  (äldre installationer: `/bios/servlet/app.operator.servlets.web.GetOutagesKML?` – läs exakt URL från
  kartsidans nätverksanrop eller config och spara den per operatör).
- Nätområde (KML): `GET https://<värd>/bios/site/concession.kml`
- Placemark (Falu Elnät):
```text
styleUrl=#inactive_outage  geometry=MultiGeometry(Polygon[, Point])
status=4 | type=1 | current_affected_customers=0 | previously_affected_customers=91 |
future_affected_customers=0 | occurred=2026-11-12 09:00 | reported=2026-11-09 11:14 |
planned_restored_time=2026-11-12 11:00 | planned_occurred_time=2026-11-12 09:00 |
restored=2026-11-12 10:24 | planned_not_started=false | planned_no_affected_customers=false |
outage_oid=486393585 | outage_subtype=1 | outage_id=41043 | note_external=Underhåll av nätstation
```
- Observerat: `type=1` planerat, `type=2` oplanerat (fel, t.ex. "träd på ledning"). Stilar:
  `#active_outage`, `#planned_outage`, `#inactive_outage`. KML-koordinater är standard **lon,lat**.
  KML:en innehåller även nyligen avslutade avbrott (`restored` satt) – använd det som explicit
  återställningssignal.
- **Okänt:** fullständig mappning av `status`. Härled läge i första hand från `styleUrl`, `restored`,
  `planned_not_started` och tider; logga okända kombinationer.

Bekräftade Digpro-operatörer (verifiera värd/kod live innan användning):

| operatorId | Nätbolag | Värd | cust |
|---|---|---|---|
| `digpro:vax` | Växjö Energi Elnät (VEAB) | `driftinformation.veab.se` | `vax` |
| `digpro:fev` | Falu Elnät | `webmap.fev.se` | `fev` |
| `digpro:hed` | Hedemora Energi | `webmap.hedemoraenergi.se` | `hed` |
| `digpro:hsd` | Halmstads Energi och Miljö Nät | `dpwebmap.hem.se` | `hsd` (`fpp,fpdh`) |
| `digpro:hem` | Härnösand Elnät (Hemab) | `dpwebmap.hemab.se` | `hem` |
| `digpro:bte` | Bergs Tingslags Elektriska | `dpweb.btea.se` | `bte` |
| `digpro:lme` | Lerum Energi | `lerumel.lerum.se` | `lme` |
| `digpro:lie` | Linde Energi | `webmap.lindeenergi.se` | `lie` |
| `digpro:shk` | Södra Hallands Kraft | `shkwebmap.sodrahallandskraft.se` | `shk` |
| `digpro:udd` | Uddevalla Energi Elnät | `nisweb.uddevallaenergi.se` | `udd` (`fpp,fpdh`) |
| `digpro:vbe` | Västerbergslagens Elnät | `status.vbenergi.se` | `vbe` |
| `digpro:lre` | Dala Energi Elnät | `dedpweb.dalaenergi.se` | `lre` (verifiera) |
| – | Partille Energi Nät, Umeå Energi Elnät | Digpro-signatur hittad, URL ej fångad | verifiera |

### 4.3 Göteborg Energi Nät (~270 000 kunder) – Digpro bakom egen proxy
- Alla anrop: `POST https://www.goteborgenergi.se/external-web/api/outages-map-element/<namn>`,
  `content-type: application/json`, body `{}`. Fungerar server-side utan cookies.
- `current-outages` → per nyttighet: `{id, name, kml, updated, items:[{type:"Unplanned"|"Planned", affectedCustomers, outageCount}]}`.
  Nyttighets-id: Elnät `36857905`, Gas `36857929`, Fjärrvärme `50935483`, Fjärrkyla `50935477`.
- KML: `GET https://www.goteborgenergi.se/GoteborgEnergi/Outages/FilteredOutagesKml.ashx?type=<id>&active=1`
  (pågående/publicerade) och `&active=0` (avslutade). **Samma fältschema som Digpro** (4.2), plus
  `component_cause` och `simplified_cause` ("Säkringsfel", "Byta kabelskåp").
- `upcoming-outages` → kommande planerade arbeten som **adresstext** (ingen geometri):
```json
{"type":"Fjarrvarme","name":"Fjärrvärme","items":[{"id":"193264667",
  "addresses":"Stora Nygatan 1, 3\r\nSlussgatan 1\r\nStampgatan 8\r\nDrottningtorget 10",
  "time":"2026-11-15 kl 11:00 till 2026-11-16 kl 02:00","area":"Stampen/Vallgraven",
  "information":"Inkoppling ny ledning\r\n(Tänk på att det kan ta upp till två timmar …)"}]}
```
- Tidsformat varierar: `"2026-11-16 kl 07:00 till kl 18:00"` (samma dag) och
  `"2026-11-15 kl 11:00 till 2026-11-16 kl 02:00"`.
- **Okänt:** om planerade **elavbrott** syns i förväg (listan innehöll bara fjärrvärme/fjärrkyla och
  el-KML:en var tom 2026-11-14). Verifiera när ett sådant finns; lova inget tills dess.
- Publik karta: `https://www.goteborgenergi.se/kundservice/avbrott/aktuella`

### 4.4 Ellevio (~930 000 kunder) – plattform `ellevio`
Bas: `https://avbrottskarta.ellevio.se/avbrottskartan/load.php?v=1.4.5&t=<typ>[&param]`
(`v` måste matcha kartans version – läs den från `t=base` eller sidans script om anrop börjar faila).
- `t=today` → `interrupts.list[]`: `{id, p, u, pc, mid, cid, ie, hasUpdated}` – en rad per
  (ärende, postnummerområde). `pc` är ett **internt postnummer-id**, `mid`/`cid` interna kommun-/läns-id,
  `u` = berörda anläggningar i området, `ie` troligen "is ended". Verifiera betydelserna.
- `t=forecast` → `forecast_interrupts.list[]`: `{id, c, pc, mid, cid, hasUpdated}` (planerade; 170 st).
- `t=ticket&ticketIDList=<id,id>` → detaljer:
```json
{"id":581055,"type":"interrupt","status":"electrical_work_ongoing",
 "customer_information":"Vi är på plats i området och arbetar med att hitta orsaken …",
 "customer_information_short":"Felsökning pågår","planned_start_time":null,
 "planned_end_time":"2026-11-14 12.30","outage_start_time":"2026-11-14 07.39","outage_end_time":null,
 "affected_site_count":23,"affected_site_total_count":605,"is_ended":0,
 "counties_and_municipalities_string":"Stockholms län, Lidingö"}
```
  Notera `HH.MM` med **punkt**. Planerade har `type:"planned_work"`.
- `t=postalCodes&codes=<id,id>` → `postal_code_shapes{<id>:{id, coord:{type:"Polygon", coordinates}}}`.
  **Koordinaterna är [lat, lon]** trots GeoJSON-liknande form – byt ordning.
- `t=concessionAreas` → `concession_area_shapes[]:{id, konc_nr, shape}` (också [lat, lon]).
- **Precision:** Ellevio publicerar **ingen avbrottsgeometri**, bara postnummerområden. Därför
  precision `postal_area` → aldrig SMS, blå/neutral i dashboard (5.3). Visa andelen
  ("23 av 605 anläggningar i postnummerområdet") så kunden förstår osäkerheten.
- Publik karta: `https://avbrottskarta.ellevio.se/`

### 4.5 E.ON Energidistribution (~1 000 000 kunder) – plattform `eon`
- Karta: `https://www.eon.se/el/stromavbrott/avbrottskarta` (iframe/script från `avbrott.eon.se`).
- Anrop: `avbrott.eon.se/conf/h04_timestamp.json`, `conf/h01_config.json`, `conf/h03_config.json`,
  `ka_<tidsstämpel>_h01/outstat.bin` (**binärt**), `static_geom/v4/01.json`,
  `map/v1/data/kommun_index.json`, `map/v1/sv_se.json`.
- Formatet i `outstat.bin` är okänt och måste avkodas från kartans JavaScript. Precision okänd.

### 4.6 Trimble-plattformen – `trimble`
Jämtkraft (`avbrottskarta.jamtkraft.se`), Sundsvall Elnät (`avbrottskarta.sundsvallelnat.se`),
Gävle Energi (`avbrottskartan.gavleenergi.se`).
- `GET /geoserver-api/GetApplicationData` → områden med räknare (`{cid, id, label, fc, fcc, pc, pcc, uc, ucc}`;
  troligen fel/planerade/kunder – verifiera), `GET /geoserver-api/content/outageTableData.json`
  (summering), `GET /geoserver-api/GetObjectsByTiles?zoom=10&tiles=<…>` (punkter/linjer/ytor per tile),
  `GET /geoserver-api/content/StaticObjects`.
- **Precision okänd** – troligen områdesnivå. Utred om ytor/polygoner per avbrott finns i
  `GetObjectsByTiles` (`areas`, `lines`, `features`) när ett avbrott pågår.

### 4.7 ServiceAlert (sms-service.dk) – `servicealert`
Karlstads El- och Stadsnät, Söderhamn Elnät, Oxelö Energi, Emmaboda Elnät (iframe
`se.sms-service.dk/iFrame/driftstatus-map?customerId=<uuid>` resp. `servicealert.se/iFrame/…`).
- Kartan anropar `se.sms-service.dk/api/WebMessage/GetDriftstatusWebMessagesMapModel` (troligen POST
  med `customerId`), `api/map/GetMapLayers?countryId=2&onlyForDriftStatus=true`.
- Kund-id: Karlstad `fa39c3a2-d576-40c3-bfa5-ae15f9117d90` (+ `c2378bb3-52ca-4fa0-94e4-f282bf8cbbaf`),
  Oxelö `30fd736a-94e0-45df-a2b0-23c0d166e18e`, Emmaboda `2fa2eb2b-9e54-4127-94f6-8deaa51be9c4`,
  Söderhamn `f3474119-d249-4f27-ae7b-6678cc0d13b7`. Precision okänd – utred.

### 4.8 Egna API:er
- **Mälarenergi Elnät:** `GET https://www.malarenergi.se/api/outages/?type=Ongoing&take=200`
  (utred andra `type`-värden, t.ex. planerade, och om geometri finns).
- **Tekniska verken Linköping Nät:** `GET https://avbrott.tekniskaverken.se/api/service-information/outage/list/?utility=electricity,districtheating,districtcooling,water,fiber,waste&brand=tekniskaverken`
  och `GET …/api/service-information/outage/shapes/` (polygoner).

### 4.9 Ej kartlagda
Kraftringen (kartan trasig 2026-11-14), Öresundskraft, Skellefteå Kraft, Jönköping Energi,
Luleå Energi, Mölndal, Borås, Nacka m.fl. Kör plattformsigenkänning (Fas 3) på Elsamverkans katalog.

---

## 5. Arkitektur

### 5.1 Översikt
```text
packages/integrations/src/utility-outages/
  operators.ts        konfiguration per operatör (id, namn, plattform, URL:er, nyttigheter, publik kartlänk)
  types.ts            NormalizedUtilityOutage, ConcessionArea
  time.ts             tolkning av svenska lokala tidsformat → ISO (Europe/Stockholm, sommartid-säker)
  geometry.ts         lat/lon-byte, Sverige-bbox-validering, KML-tolkning
  platforms/vattenfall.ts | digpro.ts | goteborg.ts | ellevio.ts | trimble.ts | servicealert.ts | eon.ts | …
  index.ts            fetchOperatorOutages(operator, ctx), fetchConcessionAreas(operator, ctx)
        │
apps/api/src/monitoring/jobs.ts      ett jobb per operatör: `utility_outages:<operatorId>`
        │  storeUtilityOutages() – egen lagring med debounce (5.4), sedan rematchEvents()
packages/db (source_events + utility_outages + property_event_matches + grid_concession_areas)
        │
apps/api/src/monitoring/snapshot.ts  ny sektion `utilityOutages` + fastighetsstatus + flöde
apps/api/src/notifications/*         ny kategori `power_outage` + påminnelse-trigger
apps/web                             panel på fastighetssidan, flöde, karta, SMS-regelformulär
```

### 5.2 Normaliserad typ (i `packages/integrations/src/utility-outages/types.ts`)
```ts
export interface NormalizedUtilityOutage {
  operatorId: string;
  utility: 'electricity' | 'district_heating' | 'district_cooling' | 'gas';
  externalId: string;               // `${operatorId}:${upstreamId}` – stabilt över tid
  kind: 'planned' | 'unplanned' | 'unknown';
  state: 'upcoming' | 'ongoing' | 'restored' | 'unknown';
  affectedCustomers: number | null;
  areaCustomerTotal: number | null; // t.ex. Ellevio affected_site_total_count
  reportedAt: string | null;        // ISO
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  estimatedRestore: string | null;
  restoredAt: string | null;
  precision: 'polygon' | 'point' | 'address_list' | 'postal_area' | 'area';
  geometry: GeoJsonGeometry | null; // WGS84 lon/lat, validerad inom Sverige
  addresses: Array<{ street: string; numbers: string[] | null }> | null; // address_list
  postalCodes: string[];            // riktiga 5-siffriga postnummer när kända
  municipalityCode: string | null;  // 4 siffror
  placeLabel: string | null;        // t.ex. "INGARÖ", "Stampen/Vallgraven"
  operatorText: string | null;      // ordagrann kundtext från nätbolaget
  cause: string | null;             // ordagrann orsak om publicerad
  sourceUrl: string;                // publik kartsida
  upstream: Record<string, unknown>;// minimala råfält för felsökning (inga adresser i loggar)
}
```
Adaptrar returnerar `AdapterResult<{ outages: NormalizedUtilityOutage[]; skipped: number; sourceUpdatedAt: string | null }>`
och kastar aldrig för förväntade fel (befintligt mönster i `packages/integrations/src/types.ts`).
Validera med zod/XML-tolkning; ogiltiga poster räknas i `skipped` och gör jobbet `partial`.

### 5.3 Precision och vad kunden ser (kärnan i kundlöftet)
Matchning görs per fastighet. Varje träff får en **matchmetod** och en **effektiv allvarlighet**.

| Matchmetod (`property_event_matches.match_method`) | Villkor | Precision |
|---|---|---|
| `outage_polygon` | Fastighetens punkt ligger inom avbrottets polygon (`ST_Intersects`, ingen buffert) | Hög |
| `outage_address` | Fastighetens gata + husnummer finns i adresslistan (normaliserat, 5.6) | Hög |
| `outage_street` | Gatan finns i listan utan husnummer | Medel |
| `outage_adjacent` | Utanför polygonen men inom 25 m från kanten | Låg |
| `outage_point` | Punkt-avbrott (ofta 1–få kunder) inom 30 m | Låg |
| `outage_postal_area` | Fastigheten ligger i ett berört postnummerområde (Ellevio) | Område |
| `outage_area` | Fastigheten ligger i ett berört driftområde (t.ex. Trimble) | Område |

Hög precision **nedgraderas till Medel** om fastighetens position är osäker (2.1).

**Hög precision:**

| Läge | Händelseflöde (titel) | Färg / `severity` | Fastighetsstatus | SMS (om regeln valt det) |
|---|---|---|---|---|
| Oplanerat, pågår | "Oplanerat strömavbrott – {nätbolag}" | **röd** / `critical` | `critical` | Ja, direkt. Räknas som `emergency` (får passera tysta timmar om regeln tillåter undantag) |
| Planerat, publicerat (kommande) | "Planerat strömavbrott {dd/mm hh:mm–hh:mm} – {nätbolag}" | **blå** / `monitor` | oförändrad | Ja, när det publiceras (bara om start > nu + 2 h) |
| Planerat, påminnelse | – (ingen ny flödesrad) | – | – | Ja, kl 18:00 kvällen före start (om valt; inte om publicerat < 24 h före start) |
| Planerat, pågår | "Planerat strömavbrott pågår – {nätbolag}" | **orange** / `warning` | `warning` | Nej (redan aviserat) |
| Planerat, ny tid (≥ 30 min ändring) | "Ändrad tid: planerat strömavbrott …" | blå / `monitor` | oförändrad | Ja, om start-SMS skickats och regeln har "ändringar" |
| Återställt | "Strömmen är tillbaka enligt {nätbolag}" | **grön** / `normal` | tillbaka | Ja, om start-SMS skickats och regeln har "återställt" |
| Planerat försvann före start | "Planerat avbrott visas inte längre hos {nätbolag}" | neutral | – | Ja, om start-SMS skickats och regeln har "ändringar" |
| Typ okänd, pågår | "Avbrott registrerat – {nätbolag}" | **orange** / `warning` | `warning` | Nej |

**Medel precision** (`outage_street`, nedgraderade): samma flödesrader och färger men texten tillägger
"– gatan nämns i nätbolagets lista" resp. "– fastighetens position är ungefärlig". Oplanerat ger
`warning` (orange), inte röd. **Inget SMS.**

**Låg precision** (`outage_adjacent`, `outage_point`): visas **endast** i fastighetens avbrottspanel
som "Avbrott i närheten (inte bekräftat att fastigheten berörs)". Ingen flödesrad, ingen statuspåverkan,
inget SMS.

**Områdesprecision** (`outage_postal_area`, `outage_area`): oplanerat → flödesrad
"Strömavbrott i fastighetens postnummerområde (23 av 605 anläggningar) – {nätbolag}", **blå** / `monitor`,
fastighetsstatus `monitor`. Planerat → syns bara i fastighetspanelen. **Inget SMS.**

Fastighetens slutliga status = högsta av officiella varningar och avbrott (`STATUS_RANK` i
`snapshot.ts`). Status-texten (`reason`) anger den högsta orsaken, t.ex.
"Oplanerat strömavbrott registrerat av Vattenfall Eldistribution". Avbrottskällans hälsa får **inte**
göra status `unknown` – den påverkar bara avbrottspanelen.

### 5.4 Livscykel, debounce och versionering
- **Lagring:** varje avbrott blir en rad i `source_events` (`source_id = 'utility_outages'`,
  `data_class = 'UTILITY_OUTAGE'`, `category = 'Power'` eller `'Heating'`) plus en 1:1-rad i
  `utility_outages` med typade fält (6.1).
- **Explicit avslut:** om flödet säger att avbrottet är återställt (`restored` satt, `is_ended`, stil
  `#inactive_outage`) → `state = 'restored'`, `source_events.status = 'ended'`,
  `ended_reason = 'restored'` direkt.
- **Försvinnande:** ett avbrott som saknas i ett *lyckat, komplett* svar räknas upp
  (`utility_outages.missing_polls`). Först vid **2 missade hämtningar i rad** avslutas det
  (`ended_reason = 'missing_from_feed'`; för `upcoming` → `state = 'withdrawn'`). Återkommer det före
  det nollställs räknaren. Ett misslyckat eller `partial` svar ändrar aldrig `missing_polls`.
- **Tomt svar** (0 avbrott, giltigt format) är normalt och betyder "inga avbrott".
- **Version (`version_hash`)** beräknas **bara** av: `state`, `kind`, `plannedStart`/`plannedEnd`
  avrundat till 15 min, `estimatedRestore` avrundat till 30 min, och `utility`. Antal kunder, geometri
  och text ändrar inte versionen (de uppdateras ändå i lagringen). Det förhindrar att flödet fylls med
  "Uppdaterad" var 5:e minut.
- **Övergång upcoming → ongoing:** när `plannedStart <= nu` och flödet inte säger annat, eller när
  flödet markerar det som pågående.
- **Rematch:** efter lagring körs `rematchEvents` (befintlig). Geometrin kan växa under ett avbrott –
  nya fastigheter som hamnar inom polygonen får en `new`-träff och därmed eget flöde/SMS.

### 5.5 Täckning ("bevakas"/"bevakas inte ännu")
- Matchning av avbrott är **rent geografisk** mot alla operatörers avbrott – den beror inte på
  nätområden. Nätområden behövs bara för att få säga "Inga registrerade avbrott".
- Ny tabell `grid_concession_areas` fylls från operatörernas egna nätområden (Digpro `concession.kml`,
  Ellevio `t=concessionAreas`) och – om en nationell, licensmässigt användbar datamängd finns
  (Energimarknadsinspektionens nätkoncessioner för område; utreds i Fas 1) – från den.
- Panelens täckningslägen:
  - `monitored` – inom ett nätområde vars operatör är aktiverad och vars jobb är aktuellt;
  - `stale` – inom ett bevakat nätområde men jobbet är inaktuellt → "Ej bedömd";
  - `not_monitored` – inom ett känt nätområde vars operatör inte är implementerad → "Nätet bevakas inte ännu";
  - `unknown` – inget nätområde känt → "Nätbolaget är okänt. Avbrott visas om de publiceras för adressen."

### 5.6 Adressmatchning (adresslistor, Fas 4)
- Fastigheten behöver strukturerad adress: lägg till `properties.street` och `properties.housenumber`
  (fylls från Geoapify-förslaget vid skapande/ändring – `AddressSuggestion` har redan `street` och
  `housenumber`). Bakåtfyll befintliga fastigheter genom konservativ tolkning av `geocode_label`/`address`;
  lämna `NULL` om osäkert.
- Normalisering: gemener, Unicode NFC, trimma, slå ihop blanksteg, ta bort "gatan"/"vägen"-varianter
  **inte** (exakt gatunamn krävs), husnummer som sträng med bokstav ("12B"). Tolka
  `"Stora Nygatan 1, 3"` → gata "stora nygatan", nummer ["1","3"]; `"Richtersgatan"` → nummer `null`
  (→ `outage_street`). Intervall ("1-7") tolkas bara om formatet bekräftats i riktiga data.
- Kräv dessutom samma kommun/ort (operatörens område) så att lika gatunamn i andra orter aldrig matchar.

---

## 6. Datamodell (migrering, nästa lediga nummer)

### 6.1 SQL (riktlinje – anpassa till befintliga konventioner)
```sql
INSERT INTO source_catalog (id, attribution)
VALUES ('utility_outages', 'Källa: respektive nätbolags avbrottskarta') ON CONFLICT (id) DO NOTHING;

-- Postgres standardnamn på inline-checkar (samma mönster som 0005). Verifiera med \d source_events.
ALTER TABLE source_events DROP CONSTRAINT source_events_data_class_check;
ALTER TABLE source_events ADD CONSTRAINT source_events_data_class_check
  CHECK (data_class IN ('OFFICIAL_WARNING','PUBLIC_EVENT','UTILITY_OUTAGE'));
ALTER TABLE source_events DROP CONSTRAINT source_events_category_check;
ALTER TABLE source_events ADD CONSTRAINT source_events_category_check
  CHECK (category IN ('Crisis','Traffic','Water','Air','Weather','Info','Power','Heating'));
-- monitoring_changes.data_class/severity saknar check-constraints (0003) – ingen ändring behövs.

CREATE TABLE utility_outages (
  event_id            uuid PRIMARY KEY REFERENCES source_events(id) ON DELETE CASCADE,
  operator_id         text NOT NULL,
  utility             text NOT NULL CHECK (utility IN ('electricity','district_heating','district_cooling','gas')),
  kind                text NOT NULL CHECK (kind IN ('planned','unplanned','unknown')),
  state               text NOT NULL CHECK (state IN ('upcoming','ongoing','restored','withdrawn','unknown')),
  precision           text NOT NULL CHECK (precision IN ('polygon','point','address_list','postal_area','area')),
  affected_customers  integer CHECK (affected_customers IS NULL OR affected_customers >= 0),
  area_customer_total integer,
  reported_at         timestamptz,
  planned_start       timestamptz,
  planned_end         timestamptz,
  actual_start        timestamptz,
  estimated_restore   timestamptz,
  restored_at         timestamptz,
  addresses           jsonb,
  postal_codes        text[] NOT NULL DEFAULT '{}',
  municipality_code   text,
  missing_polls       integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_utility_outages_operator_state ON utility_outages (operator_id, state);
CREATE INDEX idx_utility_outages_planned_start ON utility_outages (planned_start) WHERE state = 'upcoming';

CREATE TABLE grid_concession_areas (
  id           bigserial PRIMARY KEY,
  operator_id  text NOT NULL,
  utility      text NOT NULL DEFAULT 'electricity',
  source       text NOT NULL,        -- 'operator_feed' | 'national_dataset'
  external_ref text,                 -- t.ex. Ellevio konc_nr
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_grid_concession_areas_geom ON grid_concession_areas USING GIST (geom);

ALTER TABLE property_event_matches DROP CONSTRAINT property_event_matches_match_method_check;
ALTER TABLE property_event_matches ADD CONSTRAINT property_event_matches_match_method_check
  CHECK (match_method IN ('polygon_intersection','within_radius','county','municipality',
    'outage_polygon','outage_address','outage_street','outage_adjacent','outage_point',
    'outage_postal_area','outage_area'));
ALTER TABLE property_event_matches ADD COLUMN effective_severity text
  CHECK (effective_severity IS NULL OR effective_severity IN ('info','monitor','warning','critical','unknown'));
```
`properties.street`/`properties.housenumber` läggs till i **Fas 4** (eller tidigare om det behövs).

### 6.2 Kod som måste följa med
- `packages/domain/src/common.ts` – lägg `'utility_outages'` i `SOURCE_IDS`.
- `packages/domain/src/monitoring.ts` – `'UTILITY_OUTAGE'` i `DATA_CLASSES`.
- `packages/domain/src/entities.ts` – `'Power'`, `'Heating'` i `EventCategorySchema`; ny
  `UtilityOutageSchema` och `PropertyUtilityStatusSchema` i `PropertySnapshot` (6.3).
- `packages/integrations/src/sources/manifest.ts` – ny post (avsnitt 9).
- `packages/integrations/src/registry.ts` – `utility_outages: 'interface_only'` tills Fas 1 är klar,
  sedan `'implemented'` med kommentar (fixtures + livetest-datum).
- `packages/db/src/monitoring.ts` – `rematchEvents` (gren för `utility_outages`, effektiv allvarlighet,
  inga `monitoring_changes` för låg precision), lagringsfunktion med debounce, läsfrågor för snapshot,
  `RETENTION` (avslutade avbrott sparas 30 dagar för historik).
- `apps/api/src/monitoring/status.ts` – hälsa **per operatör** (jobb `utility_outages:*`), exponerad
  som underlista i `/v1/sources/status`.

### 6.3 Snapshot-kontrakt (domän)
```ts
PropertyUtilityStatus = {
  utility: 'electricity' | 'district_heating' | …,
  operator: { id: string; name: string; mapUrl: string } | null,
  coverage: 'monitored' | 'stale' | 'not_monitored' | 'unknown',
  updatedAt: string | null,            // operatörens senaste lyckade hämtning
  current: UtilityOutageView[],        // pågående med hög/medel/område-precision
  upcoming: UtilityOutageView[],       // planerade, sorterade på start
  recentlyRestored: UtilityOutageView[], // senaste 24 h
  nearby: UtilityOutageView[],         // låg precision
}
UtilityOutageView = { id, kind, state, matchMethod, precisionLabel, severity, affectedCustomers,
  areaCustomerTotal, plannedStart, plannedEnd, actualStart, estimatedRestore, restoredAt,
  operatorText, cause, placeLabel, sourceUrl, geometry? }
```

---

## 7. Notifieringar (SMS)

### 7.1 Kategori
`packages/domain/src/notifications.ts`:
```ts
{ id: "power_outage", source: "utility_outages", label: "Strömavbrott (nätbolag)",
  explanation: "SMS skickas bara när fastighetens adresspunkt ligger inom området nätbolaget publicerat som berört. Postnummer- och områdesträffar visas bara i dashboarden.",
  enabled: true }
```
Villkor (lägg till i `NotificationConditionSchema`):
```ts
z.object({
  category: z.literal("power_outage"),
  utilities: z.array(z.enum(["electricity","district_heating","district_cooling"])).min(1),
  unplanned: z.boolean(),        // oplanerat pågår
  planned: z.boolean(),          // planerat publicerat
  plannedReminder: z.boolean(),  // kl 18 kvällen före
  restored: z.boolean(),         // tillbaka (bara efter start-SMS)
  changes: z.boolean(),          // ny tid / försvann före start (bara efter start-SMS)
}).strict()
```
Standard i UI: el, oplanerat ✔, planerat ✔, påminnelse ✔, återställt ✔, ändringar ✔.
`district_heating`/`district_cooling` är valbara först från Fas 4 (dölj eller inaktivera innan).

### 7.2 Behörighet (`apps/api/src/notifications/engine.ts` → `eventEligible`)
Gren för `power_outage`, utöver befintliga generella kontroller (aktiveringstid, färskhet, version):
- `e.source_id === 'utility_outages'` och `e.data_class === 'UTILITY_OUTAGE'`;
- `match_method ∈ {'outage_polygon','outage_address'}` **och** fastighetens position bekräftad
  (lägg till `geocode_precision` och `position_source` i `EventCandidate`-frågan i `service.ts`);
- nyttigheten finns i `c.utilities`;
- `unplanned`: `kind = 'unplanned'`, `state = 'ongoing'`, `change_type = 'new'`;
- `planned`: `kind = 'planned'`, `state = 'upcoming'`, `change_type = 'new'`, `planned_start > nu + 2 h`;
- `restored`/`changes`: kräver att en tidigare rad i `notification_outbox` för samma avbrott och regel
  har status som räknas som skickad/simulerad (dedup-nyckel, 7.4);
- `kind = 'unknown'` ger aldrig SMS.
- Färskhet: `last_seen_at` inom 20 min (befintlig standard) – avbrottsjobben går var 5:e minut.

### 7.3 Påminnelse
Ny trigger i `apps/api/src/notifications/service.ts` efter mönstret `forecastTriggers`:
`outageReminderTriggers(tx, rule, now)` – väljer `utility_outages` med `state = 'upcoming'`,
`planned_start` mellan nästa dygns 00:00 och 23:59 (Europe/Stockholm), endast när lokal tid är
**18:00–21:00** (missas fönstret skickas ingen sen påminnelse), med hög-precisions-träff på regelns
fastigheter, och där avbrottet publicerades ≥ 24 h före start. `emergency = false` (tysta timmar gäller).
Påminnelsen skickas även om regeln inte valt `planned` (då är det kundens enda planerat-SMS).

### 7.4 Dedup-nycklar (`notification_outbox.dedup_key`, unik)
- start: `uo:{externalId}:start[:{propertyId} om ej grupperat]`
- planerat publicerat: `uo:{externalId}:planned`
- påminnelse: `uo:{externalId}:reminder`
- ändring: `uo:{externalId}:change:v{version}`
- återställt: `uo:{externalId}:restored`

### 7.5 SMS-texter (följ `smsText`-formatet, max en SMS-del där det går)
- Oplanerat: `Oplanerat strömavbrott registrerat av Vattenfall Eldistribution som omfattar adressen. Rapporterat 14:05, beräknat klart 17:00`
- Planerat: `Planerat strömavbrott 30/11 kl 09–14 enligt Vattenfall Eldistribution`
- Påminnelse: `Påminnelse: planerat strömavbrott i morgon kl 09–14 enligt Vattenfall Eldistribution`
- Återställt: `Strömmen är tillbaka enligt Vattenfall Eldistribution (avbrott från 14:05)`
`smsText` lägger till fastighetsnamn, tid, källa och länk. Saknas sluttid: utelämna den, gissa aldrig.

### 7.6 Massavbrott (storm)
Vid många samtidiga avbrott gäller befintliga gränser (dagliga gränser, minut-hink, kostnadstak).
Gruppering per regel (`groupProperties`) ska slå ihop flera fastigheter i samma avbrott till ett SMS.
Skriv ett test med 50 avbrott × 200 fastigheter som visar att gränserna håller och att inga
områdesträffar ger SMS.

---

## 8. Dashboard och UI (svenska, befintliga design-tokens)

- **Fastighetssidan:** ny panel `apps/web/components/properties/UtilityOutagePanel.tsx` (titel "Elnät",
  från Fas 4 "El och fjärrvärme"), monteras i `PropertyDetail.tsx`. Lägen: laddar · ej bedömd ·
  bevakas inte ännu · nätbolag okänt · inga registrerade avbrott (bara när `coverage = monitored`) ·
  pågående (röd/orange) · kommande lista (blå) · nyligen återställt (grön, 24 h) · i närheten (grå).
  Visa per avbrott: nätbolag, typ, precisionstext ("Fastighetens adresspunkt ligger inom
  avbrottsområdet" / "i postnummerområdet – inte säkert att fastigheten berörs"), berörda kunder,
  start, beräknat klart, nätbolagets text i citat, "Källa: … – uppdaterad hh:mm" med länk.
  View-model i `apps/web/lib/view-models/detail.ts`.
- **Kartor:** rita avbrottspolygoner (bara avbrott som matchar organisationens fastigheter) i
  `LocalEventsMap.tsx` och som valbart lager "Strömavbrott" i `PortfolioMap.tsx`. Inga dekorativa
  cirklar – bara riktig geometri. Postnummerområden ritas streckade med etikett "Postnummerområde".
- **Händelseflödet** (`AlertFeed.tsx` via `buildFeed` i `snapshot.ts`): rader kommer från
  `monitoring_changes` med `effective_severity`. Säkerställ att `CHANGE_SV`-prefixet ("Ny:",
  "Uppdaterad:") inte ger dubbla eller missvisande titlar – sätt `headline` per läge enligt 5.3 och
  använd en egen titelbyggare för `utility_outages`.
- **Fastighetslista/status:** röd/orange status med orsakstext enligt 5.3.
- **SMS-regler:** formulär för kategorin i `apps/web/components/notifications/SmsManagement.tsx`
  (+ `lib/view-models/rules.ts`) med kryssrutor enligt 7.1 och förklaringstexten om precision.
- **Live:** jobben publicerar `sources: ['utility_outages']` och berörda `propertyIds` på bussen så att
  SSE uppdaterar dashboarden (befintligt mönster).
- **Ny route behövs inte** om allt ryms i snapshot/portfölj. Om en egen route läggs till
  (t.ex. `/v1/properties/:id/outages`) måste den även in i allowlistan i
  `apps/web/app/api/app/[...path]/route.ts`.
- `/demo` och landningssidan ändras inte i denna plan.

---

## 9. Konfiguration, manifest och dokumentation

- `packages/config/src/env.ts` (+ `.env.example`):
  - `SOURCE_UTILITY_OUTAGES_ENABLED` – bool, **default false**;
  - `UTILITY_OUTAGE_OPERATORS` – kommaseparerad lista över aktiverade `operatorId`, default = alla
    implementerade; tom = inga;
  - `UTILITY_OUTAGE_POLL_SECONDS` – default 300, minimum 120.
- Manifestpost i `packages/integrations/src/sources/manifest.ts`:
  `authority: 'Respektive elnätsbolag'`, `label: 'Nätbolagens avbrottskartor'`, `access: 'public'`,
  `commercialReuseReviewed: false`, `attributionText: 'Källa: respektive nätbolags avbrottskarta'`,
  `dataKind: 'event'`, `geographicPrecision: 'mixed'`, `coverageNote` som förklarar att flödena är
  nätbolagens publika kartdata utan dokumenterat API och att precisionen varierar per bolag,
  `updatePolicy: 'Var 5:e minut per nätbolag'`, `retentionPolicy: 'Aktiva + 30 dagar efter avslut'`,
  `enableFlag: 'SOURCE_UTILITY_OUTAGES_ENABLED'`.
- `docs/sources.md`: nytt avsnitt med endpoints, fält, precision, kända okända och täckning per operatör.
- **ADR** (nästa lediga nummer, t.ex. `docs/decisions/0006-stromavbrott.md`): precisionsnivåer,
  färg-/statusmatris (5.3), SMS-regler (2.1, 7), att fastighetsstatus nu = högsta av officiell varning
  och bekräftat avbrott, och att riskindexet inte påverkas förrän Fas 5.
- `IMPLEMENTATION_PROGRESS.md`: kort sektion per fas.

---

## 10. Testkrav (gäller varje fas för det som fasen rör)

- **Adaptrar (fixtures, inget nätverk):** tolkning till normaliserad typ; koordinatordning (test som
  failar om lat/lon byts – kontrollera mot Sverige-bbox); tidsformat inkl. `HH.MM`, `kl`-format och
  sommartidsövergång (en tid som `2026-10-25 02:30` ska ge definierat resultat eller `null`, aldrig en
  gissning); okänd status → `unknown`; tomt svar → 0 avbrott `ok`; trasigt svar → `invalid_payload`.
- **Databas (riktig PostGIS, `tests/integration/real-db.test.ts`, körs i podden enligt README):**
  inom/utanför/kant (24 m vs 26 m) för polygon; punkt 29 m vs 31 m; postnummerområde; nedgradering vid
  osäker position; debounce (1 miss behåller, 2 missar avslutar, återkomst nollställer); explicit
  `restored`; att antal kunder-ändring **inte** ger ny `monitoring_changes`-rad; planerat → pågår →
  återställt ger exakt förväntade rader.
- **Notifieringar (`apps/api/test/notifications.test.ts`):** hela matrisen i 5.3/7.2; ingen
  bakåtfyllnad; återställt bara efter start-SMS; påminnelse kl 18 kvällen före, inte efter 21:00 om
  missad (ingen sen påminnelse mitt i natten), inte vid kort varsel; tysta timmar och nödundantag;
  gruppering; stormtestet (7.6); **anti-spam-test**: fastighet 200 m från polygonen och fastighet i
  samma postnummerområde får 0 SMS.
- **Snapshot/API (`apps/api/test/monitoring.test.ts`):** statusprioritet (röd SMHI-varning vs
  avbrott), täckningslägen, "Inga registrerade avbrott" endast när `monitored`.
- **Webb (`apps/web/test/*`):** view-model-tester för alla panellägen; DOM-test för panelen och
  SMS-formuläret.
- **Live (`tests/live/utility-outages.live.test.ts`, körs med `npm run test:live`):** varje aktiverad
  operatörs endpoint svarar, tolkas utan fel och ger koordinater inom Sverige.
- **Kvalitetsgrindar före fas klar:** `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`,
  databassviten och relevanta livetester – alla gröna. Notera exakta testantal i fasloggen.
- **Manuell verifiering i webbläsaren:** skapa en testfastighet (testorganisation) med punkt **inuti**
  ett aktuellt planerat avbrott (Vattenfall hade 159 planerade 2026-11-14) och en **utanför**. Visa att
  den ena får blå flödesrad, panel och simulerat SMS, och att den andra inte får något. Ta skärmbilder.

---

## 11. Faser

Varje fas ska lämna systemet i ett fungerande, testat skick med källan avstängd som standard.

### Fas 1 – Grund + exakta elkällor (Vattenfall, Digpro-bolagen, Göteborg Energi)

**Mål:** Hela kedjan från hämtning till dashboard och SMS fungerar för elavbrott med polygonprecision.

**Steg**
1. Förutsättningar: `git status` rent för berörda filer; kontrollera migreringsnummer; verifiera live
   Vattenfall-, Digpro- (minst FEV, VEAB) och Göteborg-endpoints; spara fixtures (planerat, oplanerat
   om något finns, avslutat, tomt svar).
2. Domän och config: `SOURCE_IDS`, `DATA_CLASSES`, kategorier, snapshot-schema (6.2–6.3), env-flaggor (9).
3. Migrering enligt 6.1 (utan `properties.street/housenumber`).
4. `packages/integrations/src/utility-outages/`: `types.ts`, `time.ts`, `geometry.ts`, `operators.ts`
   (Vattenfall, alla bekräftade Digpro-operatörer i 4.2 som svarar live, Göteborg Energi el),
   plattformsadaptrar `vattenfall.ts`, `digpro.ts` (generisk, parametriserad), `goteborg.ts` (Digpro-KML
   via proxy + `current-outages`). Exportera från `packages/integrations/src/index.ts`.
5. Nätområden: hämta Digpro `concession.kml` per operatör. Utred om en nationell datamängd för
   nätkoncessioner finns och får användas; om ja, importera med veckojobb; om nej, dokumentera och låt
   Vattenfall/Göteborg-fastigheter utan känt nätområde få `coverage: 'unknown'`. Veckojobb
   `utility_concessions:<operatorId>`.
6. Jobb i `apps/api/src/monitoring/jobs.ts`: ett per aktiverad operatör, `intervalSeconds` från env,
   `timeoutMs` 60 000, egen `storeUtilityOutages` med debounce och versionsregler (5.4), därefter
   rematch och bussmeddelande.
7. Matchning i `rematchEvents`: metoderna `outage_polygon`, `outage_adjacent`, `outage_point`;
   nedgradering vid osäker position; `effective_severity`; inga `monitoring_changes` för låg precision.
8. Status per operatör i `status.ts` och `/v1/sources/status`.
9. Snapshot: `utilityOutages`-sektion, fastighetsstatus och orsakstext, flödestitlar (5.3, 8).
10. SMS: kategori, villkor, behörighet, påminnelse, dedup, texter (7). Fortfarande simulerat läge
    (befintlig spärr – ändra inte SMS-spärren).
11. UI: panel, kartlager, flöde, SMS-formulär (8).
12. Manifest, registry, ADR, `docs/sources.md`, `IMPLEMENTATION_PROGRESS.md`.
13. Tester och manuell verifiering enligt 10.

**Klart när:** alla punkter i 10 är gröna för fasens operatörer; manuell verifiering med skärmbilder
visar blå planerad händelse + simulerat SMS för fastigheten inuti och ingenting för fastigheten utanför;
fasloggen ifylld.

**Inte i Fas 1:** Ellevio, E.ON, Trimble, ServiceAlert, fjärrvärme, adresslistor, riskindex.

### Fas 2 – Ellevio, Tekniska verken och Mälarenergi

**Mål:** Stockholmsområdet (Ellevio) syns ärligt med områdesprecision; Linköping och Västerås läggs till.

**Steg**
1. Verifiera live och spara fixtures för Ellevio `today`, `forecast`, `ticket`, `postalCodes`,
   `concessionAreas`. Fastställ betydelsen av `p`, `u`, `ie`, `c` med riktiga data (jämför mot
   `ticket`-detaljer) och dokumentera.
2. `platforms/ellevio.ts`: ett avbrott per ärende (`ticket`) med `precision: 'postal_area'`,
   geometri = union av berörda postnummerpolygoner (lat/lon bytt), `postalCodes` (riktiga nummer om de
   kan härledas, annars tom lista), `affectedCustomers`, `areaCustomerTotal`. Cacha postnummerpolygoner
   (de ändras sällan) – hämta bara nya id:n.
3. Matchning `outage_postal_area`; flöde och status enligt 5.3 (blå, aldrig SMS).
4. Ellevio-nätområden in i `grid_concession_areas`.
5. Tekniska verken: utred `list` + `shapes`, implementera `custom:tekniskaverken` för el (fjärrvärme
   väntar till Fas 4). Polygon → hög precision.
6. Mälarenergi: utred `type`-värden och geometri, implementera med den precision datan ger.
7. Tester, dokumentation, faslogg.

**Klart när:** en testfastighet i ett berört Ellevio-postnummerområde får blå flödesrad med andelstext
och **inget** SMS; Tekniska verken/Mälarenergi klarar 10.

### Fas 3 – E.ON, Trimble, ServiceAlert och fler Digpro-bolag

**Mål:** Störst möjliga eltäckning med befintlig arkitektur.

**Steg**
1. **E.ON:** avkoda `outstat.bin` utifrån kartans JavaScript (läs, kör inte okänd kod server-side).
   Dokumentera formatet i `docs/sources.md`. Om formatet inte går att tolka säkert: dokumentera och
   hoppa över – gissa aldrig fält.
2. **Trimble** (Jämtkraft, Sundsvall, Gävle): generisk adapter; utred geometri per avbrott vid ett
   pågående avbrott; annars `outage_area` med driftområdets yta.
3. **ServiceAlert** (Karlstad, Söderhamn, Oxelö, Emmaboda): generisk adapter per `customerId`.
4. **Plattformsigenkänning:** skript i `scripts/` som läser Elsamverkans katalog, hämtar varje
   störningssida (en gång, artigt) och letar efter signaturer (`outagemap2`, `geoserver-api`,
   `sms-service.dk`/`servicealert.se`). Lägg till verifierade nya operatörer i `operators.ts`.
5. Tester, dokumentation, faslogg med uppdaterad täckningslista.

### Fas 4 – Fjärrvärme och fjärrkyla

**Mål:** Planerade och pågående värme-/kylavbrott där bolagen publicerar dem.

**Steg**
1. Migrering: `properties.street`, `properties.housenumber`; fyll vid skapande/ändring från Geoapify;
   konservativ bakåtfyllnad (5.6).
2. Göteborg Energi: `upcoming-outages` (adresslistor, `kl`-tidsformat) och KML-typerna för
   fjärrvärme/fjärrkyla. Adressmatchning `outage_address`/`outage_street` (5.6).
3. Tekniska verken `districtheating`/`districtcooling`; Digpro `fpdh` (Halmstad, Uddevalla) – verifiera
   format.
4. Kategori `Heating` i flöde/panel ("El och fjärrvärme"), SMS-villkorets `utilities` aktiveras för
   fjärrvärme/fjärrkyla. Texter: "Planerat fjärrvärmeavbrott …"; visa nätbolagets text ordagrant
   (t.ex. "Tänk på att det kan ta upp till två timmar …").
5. Tester (särskilt adressnormalisering och att samma gatunamn i annan ort inte matchar), faslogg.

### Fas 5 – Resterande nätbolag, driftövervakning och riskindex

**Steg**
1. Kartlägg och implementera kvarvarande stora/medelstora bolag (Kraftringen, Öresundskraft,
   Skellefteå Kraft, Jönköping Energi, Luleå Energi m.fl.) i den ordning kundernas fastigheter kräver
   (fråga databasen vilka fastigheter som har `coverage = unknown/not_monitored`, grupperat på kommun).
2. Driftövervakning: tydlig signal när en operatörs flöde ändrat format (jobbstatus `error` med
   `invalid_payload` i X timmar) i `/v1/sources/status` och loggar, så att adaptern kan lagas snabbt.
3. **Riskindex** – endast efter produktägarens godkännande: förslag till ny faktor "El" i ADR-tillägg
   (t.ex. oplanerat med hög precision → Förhöjd; planerat → Låg), implementera i
   `packages/domain/src/risk-index.ts` med tester. Gör inget här utan uttryckligt OK.
4. Slutlig täckningsrapport i `docs/sources.md`.

---

## 12. Kända okända (håll listan aktuell)

| Fråga | Påverkar | Status |
|---|---|---|
| Vattenfall statuskoder för oplanerat/pågående | Fas 1 | **Löst 2026-11-14** ur kartans egen kod: 1–4 pågående fel, 6 pågående planerat, 7 kommande planerat |
| Digpro fullständig `status`-mappning | Fas 1 | Löst via fält i stället för `status`/`styleUrl` (`#active_outage` kan ha passerat `restored`); planerat > 24 h efter planerat slut utan `restored` → `unknown` |
| Göteborg: syns planerade elavbrott i förväg? | Fas 1/4 | Okänt |
| Nationell nätkoncessionsdata (Ei) – finns, licens? | Fas 2 | Ej utrett i Fas 1. Digpro `concession.kml` finns för 5 bolag; Vattenfall/Göteborg-fastigheter visas som "Nätbolaget är okänt" tills nätområden finns |
| Ellevio fältbetydelser `p`, `u`, `ie`, `c` | Fas 2 | Ej verifierat |
| E.ON `outstat.bin`-format | Fas 3 | Ej utrett |
| Trimble/ServiceAlert precision | Fas 3 | Ej utrett |
| Partille, Umeå exakta Digpro-URL:er | Fas 3 | Ej fångade (Dala Energi verifierad och med i Fas 1) |

---

## 13. Faslogg (fylls i av agenten)

| Fas | Datum | Commit | Operatörer live-verifierade | Tester (antal gröna) | Avvikelser / öppna frågor |
|---|---|---|---|---|---|
| 1 | 2026-11-14 | ej committad (gren `claude/stromavbrott-fas1`) | Vattenfall, Göteborg Energi, 12 Digpro-bolag (14/14 livetest gröna) | 280 enhets-/DOM-tester gröna (53 nya); lint, typecheck, build gröna | PostGIS-sviten skriven men **ej körd** (podens testdatabas användes av parallell agent). Manuell webbläsarverifiering ej gjord (kräver API + databas). Göteborg: planerade elavbrott i förväg ej observerade. |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
