# Skalning – FastighetsRadar för portföljer med 200–1000 fastigheter – implementationsplan

**Status:** Granskning klar 2026-11-22. Ingen fas påbörjad. Ingen produktionskod ändrad i granskningen.
**Underlag:** Kodläsning av `apps/web`, `apps/api`, `packages/db` och `packages/domain` på
`deploy/live-stromavbrott` (`a421f3e`), mätning med en uppskalad demoportfölj (avsnitt 2.1), ett test i
webbläsaren på `localhost:3000/demo/overview` (2.2) och skrivskyddade mätningar i produktion på podden
`f-radar` (2.3).
**Hänger ihop med:** [`fler-avbrott.md`](fler-avbrott.md) (kunder med hundratals adresser över hela
landet) och [`stromavbrott.md`](stromavbrott.md) (SMS-regler för avbrott).

---

## 0. Instruktioner till agenten som genomför en fas

1. Läs **hela** detta dokument innan du börjar, särskilt fynden (avsnitt 4) som fasen hänvisar till.
2. Gör **bara den fas** produktägaren bett om. Påbörja aldrig nästa fas på eget initiativ.
3. Kör `git status` först. Har någon annan ocommittade ändringar i filer du behöver: stanna och fråga.
4. Migreringar är framåtriktade och checksummade. Ta **nästa lediga nummer** i
   `packages/db/migrations/` (just nu `0023`). Ändra aldrig en befintlig migrering.
5. Det finns ingen lokal API/databas (Docker saknas). Verifiera UI i demoläget på `localhost:3000/demo`
   med testportföljen från Fas 0. Backendändringar verifieras med enhetstester mot rena funktioner
   och, där det går, med SQL som körs i testerna i `packages/db/test`.
   Produktionen på podden får **läsas** för mätning: `node scripts/pod-sql.mjs "SELECT …"` (bara
   SELECT, skrivskyddad transaktion), `node scripts/instapods.mjs logs <rader> app` och `exec` för
   `psql` i en `BEGIN READ ONLY`-transaktion. Hämta bara aggregat (antal, byte, tider) – aldrig namn,
   adresser eller telefonnummer – och skriv aldrig till produktionsdatabasen.
6. UI-ändringar ska **visas på localhost:3000 och godkännas** av produktägaren före commit och push.
7. Läs relevant guide i `node_modules/next/dist/docs/` innan du ändrar Next.js-kod
   (se `apps/web/AGENTS.md` – Next 16 skiljer sig från tidigare versioner).
8. Mät före och efter med mätskriptet från Fas 0 och skriv siffrorna i Fasloggen (avsnitt 8).
9. Ändra aldrig hur varningar, status eller risk **bedöms**. Skalningen får bara ändra hur mycket som
   hämtas, hur det grupperas och hur det visas. Ingen händelse får försvinna ur vyn utan en synlig
   "Visa alla"/"N till".
10. SMS-utskicket är i testläge (`mode: "simulated"`). Allt i Fas 5 ska vara klart innan riktiga SMS
    slås på för en kund med fler än ett femtiotal fastigheter.
11. Avsluta varje fas med att fylla i Fasloggen och uppdatera `docs/implementation-progress.md`.
    Skriv ärligt vad som inte är verifierat.

---

## 1. Sammanfattning

Appen är byggd för portföljer på 5–50 fastigheter och fungerar bra där. Vid 200+ fastigheter går
den sönder på tre sätt:

1. **Svårt att hitta rätt fastighet.** Snabbväxlaren är en lista utan scroll och sök (verifierat: 200
   rader ger en meny som är ~16 000 px hög). Sökfältet i sidhuvudet gör ingenting.
2. **Larmflödet klarar inte en länsvarning.** En SMHI-varning över ett län som träffar 300 fastigheter
   fyller hela händelseflödet (60 rader per fastighet), trycker bort alla andra händelser, och
   måste kvitteras 300 gånger – efter 60 klick svarar API:t "För många ändringar".
3. **Allt laddas på en gång, ofta.** Hela portföljen (~19 KB per fastighet, ~10 MB vid 500) hämtas,
   valideras och skickas till webbläsaren vid varje sidladdning, varje fastighetsbyte och varje
   live-uppdatering – och live-uppdateringar kommer ungefär var 30:e sekund medan prognosjobbet
   arbetar sig igenom alla fastigheter i plattformen.

Därtill, uppmätt på podden: API:t har bara **192 MB heap** och en krasch startar om hela appen för
alla kunder. Ett portföljanrop vid 500 fastigheter kräver uppskattningsvis minst ~40 MB, och alla
öppna flikar ber om det samtidigt. Bakgrundsjobben körs **ett i taget i en enda kö** – redan i dag har
SMS-jobbet fått vänta 284 s bakom luftkvalitetsjobbet, och fler fastigheter gör kön längre.

SMS-motorn tappar meddelanden permanent vid stora händelser (minuttak och dagstak markerar dem som
"spärrade" i stället för att skjuta upp), det finns ingen massimport, och taket är hårdkodat till 500
fastigheter per organisation – 1000 går inte i dag.

---

## 2. Mätning

### 2.1 Uppskalad demoportfölj (Node, utvecklardator)

Demoportföljen (8 fastigheter) klonades till N fastigheter med nya id:n och spridda positioner. Varje
händelse i flödet kopierades till alla kloner (som en länsvarning). Skriptet låg utanför repot.

| N | Portfölj-JSON | per fastighet | `PortfolioSchema.safeParse` | `buildOverviewVM` | rader i flödet |
|---:|---:|---:|---:|---:|---:|
| 10 | 198 KB | 19,8 KB | 4 ms | 4 ms | 16 |
| 50 | 969 KB | 19,4 KB | 15 ms | 17 ms | 76 |
| 200 | 3,9 MB | 19,3 KB | 41 ms | 59 ms | 300 |
| 500 | 9,6 MB | 19,3 KB | 99 ms | 142 ms | 750 |
| 1000 | 19,3 MB | 19,3 KB | 200 ms | 279 ms | 1500 |

Per fastighet (KB): `forecast` 6,4 · `metrics` 3,7 · `alertRules` 2,2 · `events` 1,2 · `warnings` 1,0 ·
`flood` 0,7. Det mesta behövs bara på fastighetssidan, inte i listor och på översikten.

`buildOverviewVM` körs utan memoisering vid **varje** rendering, t.ex. vid varje tangenttryckning i
fastighetssöken. På en mobil är det typiskt 3–5 gånger långsammare än siffrorna ovan.

### 2.2 Webbläsaren

- `/demo/overview` med 8 fastigheter ger 369 KB HTML; portföljen bäddas in i sidan.
- Snabbväxla öppnad och raderna klonade till 200 i DOM:en: menyn blev 15 946 px hög,
  `overflow-y: visible`, `max-height: none`. Sidan blev 16 026 px lång.

### 2.3 Produktion (podden `f-radar`, skrivskyddat, 2026-11-22)

Produktionen är liten: **3 organisationer, 13 fastigheter, största organisationen 11**. Siffrorna
nedan är därför uppmätta per fastighet och uppräknade linjärt – verkligheten blir sämre där koden
är kvadratisk (S-15).

**Podden:** 2 GB RAM, 2 kärnor. Processövervakaren (`/home/instapod/app/index.js`) startar API:t med
`--max-old-space-size=192` och webben med `384`. Dör en av dem avslutas båda och systemd startar om
hela appen.

**`/v1/portfolio` (API-loggen, 6,9 h, 19 anrop, ≤ 11 fastigheter):** median 118 ms, p90 292 ms, max
298 ms.

**Portföljens SQL för största organisationen (11 fastigheter, `BEGIN READ ONLY`):**

| Fråga i `loadOrgMonitoring` | Rader | Data | Tid | Uppräknat till 500 |
|---|---:|---:|---:|---|
| Prognoser (`series`) | 11 | 437 KB | 2 ms | ~20 MB in i API:t per anrop |
| Händelser (en rad per träff, med text) | 30 | 19 KB | 3 ms | ~1 400 rader |
| Kontext | 44 | 18 KB | 0,3 ms | ~0,8 MB |
| Närmaste station (KNN per fastighet × 14 parametrar) | 132 | 31 KB | 26 ms | ~1,2 s |
| Stationshistorik 73 h | 3 462 | 258 KB | 23 ms | växer med antal stationer, filtreras sedan per fastighet i JS |
| Luftkvalitetshistorik | 282 | 101 KB | 1,4 ms | ~13 000 rader, ~4,6 MB |

**Volymer per fastighet:** prognosserie 36 700 tecken JSON (3,9 KB komprimerad i databasen), 5,8
händelseträffar, 4 kontextrader. Trafikverket ger **2,3 ändringar per fastighet och dygn** (909 på 30
dagar för 13 fastigheter) → ~1 150 per dygn och ~35 000 rader (30 dagars lagring) för en kund med 500
fastigheter. En Krisinformation-händelse träffade alla 13 fastigheter.

**Minne (syntetiskt, lokalt, nedre gräns):** prognosrader + portföljobjekt + svarssträng för ett anrop
≈ 21 MB vid 200, **42 MB vid 500** och **78 MB vid 1000** fastigheter. Stationshistorik,
luftkvalitet, pg-buffertar och zod-validering i webben kommer ovanpå.

**Bakgrundsjobben (API-loggen, 6,9 h, 4 067 körningar):** schemaläggaren var upptagen 393 s per
timme (11 %), varav luftkvalitet 170 s/h (en körning tar 200–225 s) och avbrottskällorna 176 s/h.
`sms_notifications` ska gå var 30:e s: median 30 s, p90 33 s, **max 284 s**. `smhi_warnings` ska gå var
5:e min: max 468 s. Jobb som skickar "allt har ändrats" till alla flikar: nowcast 11,4/h, prognos
3,9/h, observationer 3,9/h, luftkvalitet 0,9/h – ~20 per timme redan i dag.

### 2.4 Uppmätt mot testdatabasen på podden (Fas 0, 2026-11-22)

`node scripts/run-portfolio-scale.mjs 200 500 1000`: syntetiska organisationer i
`fastighetsradar_test` (volymer enligt 2.3), riktig PostgreSQL/PostGIS, riktig API-kod
(`buildApp` + `MonitoringService`), en barnprocess per mätning med produktionens heapgräns 192 MB, och
sökning efter minsta gräns (64/96/128/192/256/384 MB) som klarar mätningen.

| Fastigheter | Svar | Tid, 1 anrop | Tid, 3 samtidiga (median) | Heaptopp, 1 anrop | Vid 192 MB, 1 anrop | Vid 192 MB, 3 samtidiga | Minsta heap, 1 / 3 anrop |
|---:|---:|---:|---:|---:|---|---|---|
| 200 | 5,7 MB | 0,71 s | 1,9 s | 91–106 MB | klarar | klarar (topp 139–171 MB) | 64 / 128 MB |
| 500 | 14,3 MB | 1,6 s | – | 142–160 MB | klarar | **minnesbrist (OOM)** | 128 / 256 MB |
| 1000 | 28,6 MB | 3,3 s | – | 187–195 MB | klarar precis | **minnesbrist (OOM)** | 192 / 384 MB |

- Svaret är **~28 KB per fastighet** i live-API:t, inte 19 KB som demoportföljen – S-10:s siffror i
  webbläsaren blir alltså ~45 % större.
- Barnprocessen startade med 24 MB heap. Det riktiga API:t bär också schemaläggaren, SMS-motorn och
  cacher, så marginalerna i produktion är **mindre** än i tabellen.
- Tiderna är uppmätta medan produktionen körde på samma två kärnor (belastning ~2,5 under mätningen).
- Fastighetskontext (SGU/MCF/SCB) seedades inte; i produktion var den 1,6 KB per fastighet.

### 2.5 Inte verifierat

- Exakt grundförbrukning (heap) i det riktiga API:t i produktion – loggas från och med Fas 0
  (`portfolio built … heapUsedMb`).
- Webbserverns (384 MB) minnesbehov när den validerar och renderar ett svar på 14–29 MB.

---

## 3. Hårda gränser i dag

| Gräns | Var | Värde |
|---|---|---|
| Fastigheter per organisation | [`customer.ts:29`](../../apps/api/src/routes/customer.ts) `MAX_PROPERTIES_PER_ORG` | 500 |
| Fastigheter i en SMS-regel | [`notifications.ts:151`](../../packages/domain/src/notifications.ts) | 500 |
| Rader i händelseflödet | [`service.ts:118`](../../apps/api/src/monitoring/service.ts) | 60 (per fastighet och händelse) |
| Kvitteringar per användare | [`feed-acknowledgements.ts:37`](../../apps/api/src/routes/feed-acknowledgements.ts) | 60 direkt, sedan 1/s |
| SMS per minut (hela plattformen) | [`env.ts:137`](../../packages/config/src/env.ts) | 10 |
| SMS per organisation och dygn | [`env.ts:145`](../../packages/config/src/env.ts) | 20 |
| Adressförslag (Geoapify) per användare | [`customer.ts:103`](../../apps/api/src/routes/customer.ts) | 30 direkt, sedan 1 per 2 s |
| Prissidan | `lib/pricing/plans.ts` | Business "upp till 50", Enterprise "50+ (anpassat)" |
| Heap för API:t / webben | `/home/instapod/app/index.js` på podden | 192 MB / 384 MB (podden har 2 GB, 2 kärnor) |
| Bakgrundsjobb samtidigt | [`scheduler.ts:64`](../../apps/api/src/monitoring/scheduler.ts) | 1 (alla jobb i en kö) |
| Nowcast-punkter per körning | `runNowcast` i `jobs.ts`, 4 åt gången + 1 s paus, tidsgräns 180 s | ~500 olika km-rutor |

---

## 4. Fynd

Prioritet: **P1** = användare med 200+ fastigheter kan inte göra sitt jobb eller får fel bild,
**P2** = märkbart långsamt eller omständligt, **P3** = städning eller plattformsrisk på sikt.
Fasen anger var fyndet åtgärdas.

### 4.1 Navigering och sök

**S-01 Snabbväxla och fastighetsväljaren har ingen scroll, sök eller tangentbordsnavigering** · P1 · Fas 1
- **Var:** [`Header.tsx:54`](../../apps/web/components/shell/Header.tsx), [`PropertySwitcher.tsx`](../../apps/web/components/properties/PropertySwitcher.tsx), [`PropertyList.tsx:24`](../../apps/web/components/properties/PropertyList.tsx), [`Popover.tsx`](../../apps/web/components/ui/Popover.tsx).
- **Vid 200+:** Menyn renderar alla fastigheter i en panel utan höjdgräns (verifierat 16 000 px vid
  200). Användaren måste scrolla hela sidan för att hitta en fastighet; panelen hamnar utanför
  skärmen. Ingen sökning, inga piltangenter (`role="listbox"` utan `aria-activedescendant`). Varje rad
  räknar `nowcastVM` vid varje rendering.
- **Åtgärd:** En gemensam komponent `PropertyPicker` som båda menyerna använder: sökfält överst med
  fokus vid öppning (namn, adress, område, kommun; `toLocaleLowerCase('sv-SE')`), intern scroll
  (`max-height: min(60vh, 480px)`), piltangenter/Enter/Esc, aktuell fastighet markerad och scrollad
  in i vy, sortering status → namn, och högst 100 renderade träffar med raden "Visar 100 av 312 –
  skriv för att söka". Senast besökta fastigheter (localStorage i try/catch) överst när sökfältet är
  tomt.

**S-02 Sökfältet i sidhuvudet gör ingenting** · P1 · Fas 1
- **Var:** [`Header.tsx:37`](../../apps/web/components/shell/Header.tsx) – `<input>` utan `value`/`onChange`; `⌘K` visas men är inte kopplat.
- **Vid 200+:** Det naturliga sättet att hitta en fastighet bland hundratals finns visuellt men är dött.
- **Åtgärd:** Gör det till en kommandopalett (`⌘K`/`Ctrl+K` och klick) som använder `PropertyPicker`
  (S-01). Första versionen söker fastigheter. Larm kan läggas till senare men texten ska då säga
  "Sök fastigheter" tills larm är sökbara.

**S-03 Vymodellerna byggs om vid varje rendering** · P1 · Fas 1
- **Var:** [`PropertyIndex.tsx`](../../apps/web/components/properties/PropertyIndex.tsx), [`PortfolioOverview.tsx:29`](../../apps/web/components/dashboard/PortfolioOverview.tsx), [`MobileAlerts.tsx`](../../apps/web/components/mobile/MobileAlerts.tsx), [`PropertyDetail.tsx`](../../apps/web/components/properties/PropertyDetail.tsx) (`buildDetailVM` sorterar alla fastigheter), [`dashboard-state.tsx:142`](../../apps/web/lib/state/dashboard-state.tsx).
- **Vid 200+:** `buildOverviewVM` tar 59 ms vid 200 och 142 ms vid 500 (dator). I fastighetslistan körs
  den vid varje tangenttryckning → märkbar fördröjning när man skriver, särskilt på mobil.
  `useMemo` i `PropertyIndex` hjälper inte eftersom `vm.rows` är ett nytt objekt varje gång, och
  `isSmsOn`/`isRuleOn` i kontexten skapas på nytt vid varje rendering.
- **Åtgärd:** Stabila callbacks (`useCallback`) och memoiserat kontextvärde i `DashboardStateProvider`;
  `useMemo` runt `buildOverviewVM`/`buildDetailVM` med `portfolio`, `group`, `ready` och SMS-/regel-
  överstyrningarna som beroenden; `useDeferredValue` för söksträngen i fastighetslistan.

### 4.2 Larm, händelseflöde och kvittering

**S-04 En länsvarning fyller hela händelseflödet** · P1 · Fas 2
- **Var:** [`listRecentChangesForOrg`](../../packages/db/src/monitoring.ts) (rad ~760), [`service.ts:118`](../../apps/api/src/monitoring/service.ts), `groupFeedRows` i [`overview.ts`](../../apps/web/lib/view-models/overview.ts).
- **Vid 200+:** Flödet begränsas till 60 **rader**, och varje träffad fastighet är en egen rad (SQL:en
  slår bara ihop trafikens versioner per fastighet, aldrig samma händelse över flera fastigheter).
  Grupperingen till ett kort sker först i webbläsaren, efter gränsen. En varning över 300 fastigheter
  tar alla 60 platser:
  gruppkortet visar "60 berörda fastigheter" i stället för 300, och alla andra händelser (VMA,
  avbrott, trafik) försvinner ur flödet.
- **Åtgärd:** Begränsa per **händelse och revision** i stället för per rad: välj de 60 senaste
  händelserna, hämta sedan alla fastighetsrader för just dem. Skicka antal berörda och fastighets-id:n
  per grupp. Behåll en rad per fastighet där kvittering kräver det (S-05).

**S-05 Kvittering en fastighet i taget, med spärr efter 60** · P1 · Fas 2
- **Var:** [`FeedAck.tsx`](../../apps/web/components/dashboard/FeedAck.tsx), [`FeedRows.tsx`](../../apps/web/components/dashboard/FeedRows.tsx), [`feed-acknowledgements.ts:37`](../../apps/api/src/routes/feed-acknowledgements.ts) och `:94`, `acknowledgeFeedChange` i `packages/db/src/monitoring.ts`.
- **Vid 200+:** En varning över 300 fastigheter kräver 300 klick på "Kvittera". Hastighetsgränsen
  (60 direkt, sedan 1 per sekund och användare) ger "För många ändringar. Försök senare." efter 60.
  Kvittering av en vanlig gul vindvarning blir i praktiken omöjlig.
- **Åtgärd:** "Kvittera alla (300)" på gruppkortet och på händelsesidan (S-09). Nytt endpoint
  `POST /v1/feed/acknowledgements/batch` med `changeIds` (max 1000) i **en** transaktion; historiken
  behåller en rad per fastighet (krävs för rapporten). Hastighetsgränsen räknar anrop, inte rader.
  "Ångra" för hela gruppen. Lägg till rutten i BFF-allowlistan.

**S-06 Larmräknaren räknar fastigheter, inte larm** · P2 · Fas 2
- **Var:** [`dashboard-state.tsx:68`](../../apps/web/lib/state/dashboard-state.tsx) och `:134`, sidomenyns badge.
- **Vid 200+:** En gul varning över 300 fastigheter ger badgen "300"; två varningar över samma
  fastigheter ger "600". Siffran säger inget om hur många saker som behöver åtgärdas.
- **Åtgärd:** Räkna olästa **händelser** (grupperade som i flödet). Visa antal fastigheter i
  larmsidans rubrik ("2 varningar · 612 fastigheter"). Lästmarkeringen per fastighet kan vara kvar i
  databasen.

**S-07 Aktiva larm hämtas utan gräns** · P2 · Fas 2
- **Var:** [`listActiveAlarmChangesForOrg`](../../packages/db/src/monitoring.ts) (rad ~829), `buildActiveAlarmFeed` i [`snapshot.ts:623`](../../apps/api/src/monitoring/snapshot.ts).
- **Vid 200+:** Ingen `LIMIT`, två `LATERAL`-underfrågor mot `monitoring_changes` per träff. En
  länsvarning = 300 rader med två underfrågor vardera, varje gång portföljen hämtas.
- **Åtgärd:** Gruppera per händelse i SQL och returnera fastighets-id:n som array. Index
  `monitoring_changes (organization_id, event_id, property_id, created_at DESC, id DESC)`.

**S-08 Kvitteringsrapporten (PDF) klarar inte stora urval** · P2 · Fas 2
- **Var:** [`AcknowledgementHistory.tsx:101`](../../apps/web/components/acknowledgements/AcknowledgementHistory.tsx), [`pdf.ts`](../../apps/web/lib/acknowledgements/pdf.ts), sidstorleken `ACKNOWLEDGEMENT_PAGE_SIZE = 30` i `packages/domain`.
- **Vid 200+:** Nedladdningen hämtar alla sidor à 30 rader i följd, utan tak: en månad med några
  länsvarningar över 300 fastigheter är tusentals kvitteringar och ~100 anrop innan PDF:en ens börjar
  byggas. pdfmake bygger hela dokumentet i huvudtråden (fliken fryser); "Fullständig rapport" tar med
  hela varningstexten per rad (samma text 300 gånger). Fastighetsfiltret är en `<select>` med alla
  fastigheter utan sök.
- **Åtgärd:** Gruppera rapporten per händelse ("Kvitterad för 300 fastigheter av Anna, 08:14", med
  fastighetslistan som bilaga/kort tabell) så varningstexten skrivs en gång. Hämta exportdata via ett
  eget endpoint med större sidor (eller hela urvalet med tak och tydligt meddelande). Lägg till CSV.
  Bygg PDF:en i en Web Worker. Sökbart fastighetsfilter (`PropertyPicker`).

**S-09 Grupperade larm saknar en egen sida** · P2 · Fas 2
- **Var:** Saknas. Grupperade SMS länkar till första fastigheten ([`service.ts:566`](../../apps/api/src/notifications/service.ts) `message()`).
- **Vid 200+:** "Hamnvägen 1 + 299 fastigheter" i SMS:et leder till Hamnvägen 1. Mottagaren ser inte
  vilka de andra 299 är eller kan kvittera dem.
- **Åtgärd:** Händelsesida `/larm/<händelse>` (live och demo) med varningstext en gång, karta med
  berörda fastigheter, sökbar lista, "Kvittera alla". Grupperade SMS länkar dit via en kort nyckel som
  `/p/<key>` (S-14 gäller även den länken).

### 4.3 Dataflöde och prestanda

**S-10 Hela portföljen laddas vid varje sidladdning och uppdatering** · P1 · Fas 3
- **Var:** [`(dashboard)/layout.tsx`](../../apps/web/app/(dashboard)/layout.tsx), [`lib/data/portfolio.ts`](../../apps/web/lib/data/portfolio.ts), [`MonitoringService.portfolio`](../../apps/api/src/monitoring/service.ts) (rad 113), [`notificationSnapshots`](../../apps/api/src/notifications/snapshots.ts).
- **Vid 200+:** ~19 KB per fastighet → 3,9 MB vid 200, 9,6 MB vid 500, 19 MB vid 1000. Valideras med zod
  på servern (99 ms vid 500), skickas sedan in i sidan som RSC-data till webbläsaren. Prognosserier,
  mätvärden och en kopia av varje SMS-regel per fastighet följer med fast de bara används på
  fastighetssidan. I API:t läses hela prognosserien (40 KB per fastighet, uppmätt) in för varje
  fastighet vid varje anrop – ~20 MB vid 500 – fast listan bara visar nuvarande timme och 24 h-regn.
  Median 118 ms för 11 fastigheter i produktion; närmaste-station-frågan ensam räknas upp till ~1,2 s
  vid 500.
- **Åtgärd:** Dela kontraktet i två:
  1. **Portföljlista** (`/v1/portfolio` i ny version): per fastighet bara id, namn, adress, område,
     kommun, position, status, risk, 4–5 nyckelvärden (temp, regn 24 h, byvind, luftfuktighet),
     värsta varning (nivå + typ + händelse-id), antal larm, SMS på/av, nowcast-märke. Mål: under
     1 KB per fastighet. SMS-regler skickas en gång på portföljnivå, inte kopierade per fastighet.
  2. **Fastighetsdetalj** via befintligt `/v1/properties/:id/snapshot`, hämtat av fastighetssidan
     (server) när den öppnas.
  Uppdatera `PortfolioSchema` och båda demo/live. Demoläget ska använda samma uppdelning så att det
  går att verifiera lokalt.

**S-11 Fastighetssidan hämtar hela portföljen för att sätta sidtiteln** · P1 · Fas 3
- **Var:** [`properties/[propertyId]/page.tsx`](../../apps/web/app/(dashboard)/properties/[propertyId]/page.tsx) – `findProperty` → `loadLivePortfolio()` i både `generateMetadata` och sidan.
- **Vid 200+:** Varje byte av fastighet (pilarna, snabbväxlaren) gör en serverbegäran som bygger
  hela portföljen i API:t (9 SQL-frågor + snapshot för alla fastigheter) bara för att validera id:t
  och sätta `<title>`.
- **Åtgärd:** Validera och hämta titel med `GET /v1/properties/:id` (eller snapshot-endpointet från
  S-10). Behåll `cache()` så att metadata och sida delar anropet.

**S-12 Live-uppdateringar laddar om hela portföljen i alla flikar** · P1 · Fas 3
- **Var:** [`scheduler.ts:124`](../../apps/api/src/monitoring/scheduler.ts), `runForecasts` i [`jobs.ts:258`](../../apps/api/src/monitoring/jobs.ts) (`changed: { all: true }`, 40 fastigheter per körning, ny körning efter 30 s när det finns mer), [`LiveStatus.tsx`](../../apps/web/components/shell/LiveStatus.tsx) (`router.refresh()`, minst 15 s mellan).
- **Vid 200+:** Redan i dag skickas "allt har ändrats" till alla organisationer ~20 gånger i timmen
  (uppmätt: nowcast 11,4, prognos 3,9, observationer 3,9, luftkvalitet 0,9). Prognosjobbet går igenom
  **alla fastigheter i plattformen** i omgångar om 40, så med 1000 fastigheter blir prognosen ensam
  ~25 signaler per timme. Varje **synlig** flik gör då `router.refresh()` (dolda flikar väntar) → hela
  portföljen byggs och skickas igen (~10 MB vid 500 fastigheter). En skärm i en driftcentral som står
  framme hela dagen laddar alltså om hela portföljen ett par gånger i minuten. Alla flikar får
  signalen samtidigt, så anropen kommer samtidigt – se S-33. En stor kund gör det tyngre för alla.
- **Åtgärd:**
  - Prognos och andra per-fastighetsjobb publicerar organisation + fastighets-id:n, inte `'all'`.
  - Centrala källor (observationer, luft) slås ihop till högst en `'all'`-signal per 5 minuter.
  - Klienten hämtar bara ändrade rader (`GET /v1/portfolio?ids=…`) och lappar in dem i stället för
    `router.refresh()` när färre än t.ex. 50 fastigheter ändrats.
  - `ETag` på portföljlistan så att en uppdatering utan ändringar blir `304`.
- **Gjort 2026-11-22 (Fas 3 steg 2)**, med avvikelser (egna endpoints, ingen `ETag`) – se Fas 3, "Genomfört steg 2".

**S-13 Kartan zoomar ut vid varje live-uppdatering** · P1 · Fas 1
- **Var:** [`PortfolioMap.tsx:47–72`](../../apps/web/components/maps/PortfolioMap.tsx), `mapList` i [`PortfolioOverview.tsx:31`](../../apps/web/components/dashboard/PortfolioOverview.tsx).
- **Vid 200+:** `mapList` memoiseras på `portfolio`, som är ett nytt objekt efter varje
  `router.refresh()`. Effekten tar då bort alla markörer, ritar om dem och kör `fitBounds` – användaren
  som zoomat in på Göteborg hamnar på hela Sverige igen. Med S-12 händer det ofta. (Från koden; inte
  reproducerat eftersom demoläget inte uppdateras live.)
- **Åtgärd:** `fitBounds` bara vid första laddning och när gruppen byts. Uppdatera markörer per id
  (lägg till/ta bort/ändra färg) i stället för att rensa allt.

**S-14 SMS-länken laddar hela portföljen två gånger** · P1 · Fas 3
- **Var:** [`(dashboard)/p/[key]/page.tsx`](../../apps/web/app/(dashboard)/p/[key]/page.tsx).
- **Vid 200+:** Sidan ligger under dashboard-layouten som hämtar hela portföljen, och omdirigerar
  sedan till `/properties/:id` som hämtar den igen. Det är ögonblicket då någon fått ett larm-SMS och
  öppnar länken på mobilen.
- **Åtgärd:** Flytta kortlänken ut ur `(dashboard)` (route handler som slår upp nyckeln och
  omdirigerar). Efter S-10/S-11 laddar målsidan bara listan och en fastighet.

**S-15 API:t letar linjärt per fastighet** · P2 · Fas 3
- **Var:** `buildPropertySnapshot` i [`snapshot.ts:410`](../../apps/api/src/monitoring/snapshot.ts) (`data.forecasts.find`, `data.events.filter`, `data.observations.filter`, `data.contexts.filter`, `data.history.filter` per station, `data.airHistory.filter`), `buildUpcoming` (`forecasts.find` tre gånger per fastighet), [`notificationSnapshots`](../../apps/api/src/notifications/snapshots.ts) (`paused.some`, `rules.filter` + `propertyIds.includes`), `eventTriggers` i `notifications/service.ts` (`props.find` per rad).
- **Vid 200+:** Varje fastighet söker igenom hela organisationens rader. 500 fastigheter × tusentals
  observations- och historikrader = tiotals miljoner jämförelser per portföljanrop, i en process som
  också kör alla bakgrundsjobb.
- **Åtgärd:** Indexera en gång till `Map` per `property_id` (och per station för historik) innan
  loopen. Ren refaktorering – samma utdata, testas med befintliga snapshot-tester.
- **Gjort 2026-11-22 (Fas 3 steg 3).** Gav mindre än väntat (JS-bygget 1 080 → 930 ms vid 500); den
  egentliga kostnaden var nederbördssummeringen – se Fas 3, "Genomfört steg 3".

**S-16 SQL-frågorna för portföljen växer med antal träffar, inte antal händelser** · P2 · Fas 3
- **Var:** [`loadOrgMonitoring`](../../packages/db/src/monitoring.ts) (rad 687), `listRecentChangesForOrg` (rad 760).
- **Vid 200+:**
  - Händelsefrågan returnerar en rad per (fastighet, händelse) med hela `description` (upp till 20 000
    tecken). En varning över 300 fastigheter = samma text 300 gånger från databasen och i JSON:en.
  - Närmaste station räknas med `CROSS JOIN LATERAL … ORDER BY location <-> … LIMIT 1` per fastighet
    och parameter vid varje anrop: 26 ms för 11 fastigheter i produktion → ~1,2 s vid 500.
  - Luftkvalitetshistoriken joinas per fastighet inom 25 km: 25 rader per fastighet → ~13 000 vid 500.
  - Flödesfrågan gör `DISTINCT ON` över organisationens alla ändringar. Lagringen är 30 dagar, men med
    2,3 trafikändringar per fastighet och dygn är det ~35 000 rader vid 500 fastigheter.
- **Åtgärd:** Hämta händelser en gång (`DISTINCT` på händelse) och matchningar separat; skicka
  varningstexten en gång per händelse i kontraktet. Spara närmaste station per fastighet och parameter
  i en tabell som jobben uppdaterar när fastigheten flyttas. Hämta bara de prognossteg listan behöver
  (nuvarande timme + 24 h-summor) i portföljlistan; hela serien bara i fastighetsdetaljen. Kortare
  tidsgräns (t.ex. 7 dagar) på flödesfrågan. Kör `EXPLAIN (ANALYZE, BUFFERS)` på testdatabasen med en
  syntetisk organisation på 500 fastigheter och spara planerna i Fasloggen.
- **Gjort 2026-11-22 (Fas 3 steg 3), med avvikelser:** listan laddar bara det den läser (5 av 14
  stationsparametrar, ingen regnhistorik, prognossteg för drygt 2 dygn) och JIT är avstängt – det tog
  närmaste station från 289 till 38 ms utan en ny tabell. Händelsetexten skickas fortfarande per
  fastighet och flödet har ingen kortare tidsgräns (11 ms vid 500). Se Fas 3, "Genomfört steg 3".

**S-33 API:t har 192 MB minne, och en krasch tar ner hela appen** · P1 · Fas 3
- **Var:** Processövervakaren på podden (`/home/instapod/app/index.js`, kommer från
  `scripts/deploy-pod.mjs`): `--max-old-space-size=192` för API:t, `384` för webben; om ett barn dör
  avslutas båda och systemd startar om. API-processen kör också schemaläggaren och SMS-motorn.
- **Vid 200+ (uppmätt i Fas 0, avsnitt 2.4):** Ett portföljanrop har en heaptopp på 142–160 MB vid
  500 och 187–195 MB vid 1000 fastigheter. **Tre samtidiga anrop ger minnesbrist vid 192 MB redan vid
  500 fastigheter** (kräver 256 MB; vid 1000 krävs 384 MB). Alla öppna flikar får live-signalen
  samtidigt (S-12) och ber om portföljen inom samma sekunder. API:t dör → webben och API:t startas om
  för **alla** kunder, och pågående jobb (SMS-utvärdering, hämtningar) avbryts.
- **Snabb lindring innan Fas 3:** höj API:ts heap till 512 MB i processövervakaren (podden har ~1,2–1,5
  GB ledigt). Det tar bort kraschen vid 500 men inte de långa svarstiderna eller datamängden.
  **Gjort 2026-11-22** (`API_MAX_OLD_SPACE_MB` i `deploy/pod/index.js`; mätskriptet mäter nu mot 512 MB),
  gäller från nästa driftsättning.
- **Åtgärd:** Fas 3:s lättare kontrakt (S-10, S-16) är huvudåtgärden. Dessutom: högst ett
  portföljbygge åt gången per organisation (samtidiga anrop väntar på och delar samma resultat),
  slumpad fördröjning (0–5 s) på klientens refresh efter en signal, och logga `heapUsed` per
  portföljanrop. Höj heapen bara efter mätning – podden har 2 GB för webb, API och PostgreSQL. Överväg
  att köra schemaläggaren i en egen process så att ett tungt anrop inte stoppar larmjobben.
- **Gjort 2026-11-22 (Fas 3 steg 2–3):** slumpad fördröjning i klienten (steg 2); organisationens del
  av listan byggs högst en gång åt gången och delas av samtidiga anrop (steg 3). Tre samtidiga anrop
  klarar sig nu med 128 MB heap vid 500 och 192 MB vid 1000 fastigheter (krävde 256 och 384 MB).

**S-17 `/v1/portfolio/summary` bygger hela portföljen för att räkna** · P3 · Fas 3
- **Var:** [`routes/monitoring.ts:40`](../../apps/api/src/routes/monitoring.ts).
- **Åtgärd:** Räkna från portföljlistan (S-10) eller med en egen `count`-fråga.
- **Gjort 2026-11-22 (Fas 3 steg 3):** räknar från organisationens lista (`organizationList`), utan
  fullständiga snapshots och utan användarens flöde.

### 4.4 Listor, karta och grupper

**S-18 Kartan saknar klustring** · P2 · Fas 4
- **Var:** [`PortfolioMap.tsx`](../../apps/web/components/maps/PortfolioMap.tsx), [`MobilePortfolioMap.tsx`](../../apps/web/components/mobile/MobilePortfolioMap.tsx), [`leaflet-utils.ts`](../../apps/web/components/maps/leaflet-utils.ts).
- **Vid 200+:** 500 `divIcon`-markörer med tooltip-HTML och `keyboard: true` (500 tabbstopp). I en stad
  ligger nålarna ovanpå varandra; det går inte att se vilka som har varning.
- **Åtgärd:** Klustring (t.ex. `leaflet.markercluster` eller `supercluster`, version låst) där klustret
  får färgen från sin **värsta** status och visar antal. Klick zoomar in eller listar fastigheterna.
  Tangentbordsåtkomst via listan bredvid i stället för en tabbstopp per nål.

**S-19 Fastighetstabellen saknar kolumnsortering, filter och virtualisering** · P2 · Fas 4
- **Var:** [`PropertyIndex.tsx`](../../apps/web/components/properties/PropertyIndex.tsx), [`PropertyStatusTable.tsx`](../../apps/web/components/dashboard/PropertyStatusTable.tsx), mobilkorten i `PropertyIndex`.
- **Vid 200+:** Sök och statusfilter finns, men bara sortering efter risk eller namn. 500 tabellrader
  à ~25 element; på mobil 500 kort med animerad SVG-mätare. Rubriken scrollar bort.
- **Åtgärd:** Sortering per kolumn (status, risk, namn, område, varning, larm), filter på
  kommun/område och grupp (S-20), fast rubrikrad, `content-visibility: auto` som första steg och
  fönsterrendering (eller sidor om 100) om det inte räcker. Animera bara mätare som syns.

**S-20 Inga grupper i liveläget** · P2 · Fas 4
- **Var:** [`apps/api/src/portfolio.ts:23`](../../apps/api/src/portfolio.ts) (`segment: 'all'`) och `:72` (`segments: []`), grupp-flikarna i [`PortfolioOverview.tsx`](../../apps/web/components/dashboard/PortfolioOverview.tsx) och `overview.ts:281`.
- **Vid 200+:** Demon har grupper ("Innerstad", "Förort & Kust"); livekunder har bara "Alla". En
  förvaltare med 500 fastigheter tänker i områden, bolag eller förvaltare.
- **Åtgärd:** Fastighetsgrupper som organisationen själv skapar (migrering: `property_groups` +
  koppling, en fastighet kan ligga i flera). Gruppval i översikt, lista, karta, larmflöde,
  kvitteringshistorik och som omfattning i SMS-regler ("alla i grupp X, även nya"). Sätts i
  fastighetsdialogen och vid import (S-28).

**S-21 "Kommande förhållanden" visar en rad per fastighet** · P2 · Fas 4
- **Var:** `upcomingView` i [`upcoming.ts:261`](../../apps/web/lib/view-models/upcoming.ts), [`UpcomingParts.tsx`](../../apps/web/components/upcoming/UpcomingParts.tsx).
- **Vid 200+:** En frostnatt eller blåsig dag ger en tidslinje för varje fastighet – 500 rader i
  panelen.
- **Åtgärd:** Gruppera per förhållande och tid ("Frost natt mot tisdag – 412 fastigheter") med
  expanderbar, sökbar lista. Visa enskilda rader bara när få fastigheter berörs.

**S-22 Vädrets KPI-listor och täckningslistan har inget tak** · P3 · Fas 1
- **Var:** `wxItems` i [`overview.ts`](../../apps/web/lib/view-models/overview.ts) och [`WeatherKpiPills.tsx`](../../apps/web/components/dashboard/WeatherKpiPills.tsx); [`UtilityCoverage.tsx`](../../apps/web/components/dashboard/UtilityCoverage.tsx) (alla fastigheter med lucka eller ungefärlig position).
- **Vid 200+:** Listorna kan bli hundratals rader i en popover respektive i bevakningskortet.
- **Åtgärd:** Visa de 10 värsta och "Visa alla N" (som öppnar fastighetslistan filtrerad).

### 4.5 SMS vid stora händelser

SMS-utskicket är i testläge. Fynden nedan gör att **riktiga** SMS skulle tappas eller bli fel vid
just de händelser tjänsten finns till för.

**S-23 Minuttaket spärrar meddelanden för alltid i stället för att skjuta upp dem** · P1 · Fas 5
- **Var:** `enqueue` i [`notifications/service.ts:719–721`](../../apps/api/src/notifications/service.ts), `SMS_MAX_MESSAGES_PER_MINUTE` = 10 för hela plattformen.
- **Vid 200+:** Vid en länsvarning med flera kunder får de första 10 meddelandena gå, resten får
  status `suppressed_limit`. `last_change_id` har redan flyttats fram och `dedup_key` är upptagen, så
  de försöker aldrig igen. Det gäller även VMA.
- **Åtgärd:** Minuttaket ska **köa** (`queued` med `next_attempt_at` i nästa lediga minut), aldrig
  spärra. Sortera kön så att VMA och röda varningar går först.
- **Gjort 2026-11-23 (Fas 5 steg 1):** minuttaket gäller när utkorgen SKICKAR; över det väntar meddelandet
  till nästa minut. Kön sorteras på `priority` (migrering 0023) och sedan ålder.

**S-24 Dagstaken stoppar VMA och tar fel meddelanden först** · P1 · Fas 5
- **Var:** `SMS_DAILY_LIMIT_PER_ORG` = 20, `dailyRecipientLimit` 5, `dailyPropertyLimit` 3 (`service.ts:711–716`); `evaluateOrganization` (rad 578) går regel för regel i skapandeordning.
- **Vid 200+:** Med `groupProperties: false` blir en länsvarning 300 meddelanden per mottagare; de första
  20 går och resten spärras. Ordningen styrs av regelordning och ändrings-id, inte allvar – trafik
  eller en gul varning tidigare på dagen kan förbruka kvoten så att en VMA spärras. Bara tysta
  timmar har ett undantag för nödlägen, inte taken.
- **Åtgärd:** VMA och röda varningar undantas från organisations- och fastighetstaken (men inte från
  ett eget, högre nödtak). Bearbeta utlösare i allvarsordning. Varna i regelredigeraren när en regel
  med `groupProperties: false` omfattar fler än t.ex. 10 fastigheter ("En länsvarning kan bli 300
  SMS – samla i ett SMS?"). Koppla taken till prisnivån i stället för en env-konstant.
- **Gjort 2026-11-23 (Fas 5 steg 2)** utom taken per prisnivå (datamodellen har inga prisnivåer ännu): VMA
  och röda varningar går förbi organisationens, mottagarens och fastighetens dagstak men har ett eget
  nödtak (`SMS_EMERGENCY_DAILY_LIMIT_PER_ORG`, 100); VMA-regler utvärderas först och utlösare i
  allvarsordning; regelredigeraren varnar när en regel utan samling omfattar fler än 10 fastigheter.

**S-25 En fastighet över sitt dagstak tystar hela det samlade SMS:et** · P1 · Fas 5
- **Var:** `t.properties.some((p) => count(\`property:${p.id}\`) >= r.config.dailyPropertyLimit)` på [`service.ts:714`](../../apps/api/src/notifications/service.ts).
- **Vid 200+:** Om en av 300 fastigheter redan fått tre SMS i dag spärras meddelandet för alla 300.
- **Åtgärd:** Ta bort de fastigheter som nått taket ur gruppen och skicka för resten; spärra bara om
  ingen fastighet återstår. Visa i aktivitetsloggen vilka som togs bort.
- **Gjort 2026-11-23 (Fas 5 steg 3):** meddelandet byggs om utan dem, och aktivitetsloggen säger hur många
  och vilka ("5 fastigheter hade redan fått 3 SMS i dag och togs bort ur meddelandet: …").

**S-26 Stora utskick riskerar att aldrig bli klara** · P2 · Fas 5
- **Var:** `evaluateOrganization` (en transaktion för hela organisationen), `enqueue` (~10 frågor per
  meddelande plus en `INSERT … ON CONFLICT` per fastighet i gruppen, i följd), `processOutbox(25)` per
  körning var 30:e sekund, jobbets `timeoutMs: 120000` ([`jobs.ts:436`](../../apps/api/src/monitoring/jobs.ts)).
- **Vid 200+:** Ett samlat SMS över 300 fastigheter = 300 upserts i `notification_daily_usage`. Hundratals
  utlösare × mottagare i samma transaktion kan slå i tidsgränsen → allt rullas tillbaka och görs om
  nästa körning. Utskicket begränsas till 50 per minut oavsett tak. `notification_global_usage` och
  `notification_rate_buckets` är en het rad för alla kunder.
- **Åtgärd:** Batcha användningsräknarna (`unnest`), en transaktion per regel, och låt
  `processOutbox` tömma kön inom en tidsbudget i stället för fast 25. Lasttest med en syntetisk
  organisation (Fas 0) innan riktiga SMS.
- **Gjort 2026-11-23 (Fas 5 steg 4):** dagsräknarna i en sats (`unnest`), en transaktion per regel (det
  globala SMS-låset hålls per regel i stället för per organisation), `processOutbox` tömmer kön inom
  20 s eller tills minuttakten är nådd. Lasttest mot riktig PostgreSQL med 300 fastigheter (se Fas 5).

**S-34 Alla bakgrundsjobb körs i en enda kö – larm väntar bakom tunga hämtningar** · P1 · Fas 5
- **Var:** `MonitoringScheduler.tick` i [`scheduler.ts:64`](../../apps/api/src/monitoring/scheduler.ts) kör varje förfallet jobb med `await` i tur och ordning; ett nytt varv startar 10 s efter att det förra är klart.
- **Uppmätt i dag (13 fastigheter):** Kön är upptagen 11 % av tiden. Luftkvalitetsjobbet tar 200–225 s
  per körning och under den tiden står allt annat still: `sms_notifications` (ska gå var 30:e s) har
  väntat **284 s** och `smhi_warnings` (var 5:e min) **468 s**.
- **Vid 200+:** Jobben per fastighet växer med antal fastigheter i hela plattformen. Nowcast tar ~2 s
  per fastighet och timme i dag (27 s/h för 13) → ~2 100 s/h vid 1000, och prognosen ~25 körningar per
  timme. Kön blir upptagen större delen av timmen, och SMS-utvärdering och varningshämtning hamnar
  minuter efter. SMS-reglerna kräver att ändringen är högst 30 minuter gammal och att händelsen setts
  de senaste 20 minuterna – med lång kö riskerar larm att aldrig skickas.
- **Åtgärd:** Egen loop (eller egen timer) för larmkritiska jobb – `sms_notifications`,
  `smhi_warnings`, `krisinformation`, avbrottskällorna – som aldrig väntar på tunga jobb. Tunga jobb
  (luftkvalitet, nowcast, prognos, SGU, MCF) får en tidsbudget per varv och fortsätter nästa varv
  (`moreWork`). Logga kölängd/väntetid för larmjobben och larma i `/health` när SMS-jobbet väntat mer
  än 60 s.
- **Gjort 2026-11-22 (Fas 5 steg 0):** tre köer i `scheduler.ts`, var och en med ett jobb åt gången: `sms`
  (bara `sms_notifications`, eftersom de ~50 avbrottskällorna som förfaller samtidigt tar 25–60 s per varv
  enligt `integration_runs`), `alerts` (SMHI-varningar, Krisinformation, Trafikverket och avbrottskällorna,
  alltså allt en SMS-regel kan utlösas av) och `background` (resten). `collector run` loggar `lane` och
  `waitedMs` (databasens klocka); ett SMS-jobb som är mer än 60 s sent eller ett larmjobb mer än 120 s sent
  loggar `alert job delayed` och gör `/health/ready` till `degraded` (fortfarande HTTP 200, de första 5
  minuterna efter start alltid `ok` så att driftsättningens hälsokontroll inte fälls av driftstoppet).
  **Kvar:** tidsbudget per varv för tunga jobb. Luftkvalitet hämtar ett fåtal stora dataset och kan inte
  delas per fastighet; nowcast delas upp i S-35 (Fas 7). De försenar nu bara andra bakgrundsjobb.

**S-27 SMS-regelns fastighetsval och aktivitetslogg skalar inte** · P2 · Fas 1 (lista) och Fas 4 (grupper)
- **Var:** [`SmsManagement.tsx:724`](../../apps/web/components/notifications/SmsManagement.tsx) (kryssrutor, `maxHeight: 180`), [`SmsManagement.tsx:1278`](../../apps/web/components/notifications/SmsManagement.tsx) (`propertyNames.join(", ")`).
- **Vid 200+:** Listan scrollar, men utan sök, "Markera alla/inga" eller filter på område – att välja 150
  av 500 är många klick. I aktivitetsloggen blir ett samlat SMS en rad med 300 fastighetsnamn.
- **Åtgärd:** Fas 1: sökfält, "Markera alla som syns/Avmarkera", antal valda, och "Hamnvägen 1, Kajen 4
  och 298 till" med expandering i loggen. Fas 4: välj grupp (S-20) som omfattning.

### 4.6 Stora kunder in

**S-28 Ingen massimport** · P1 · Fas 6
- **Var:** Saknas. Fastigheter läggs till en i taget i [`PropertyEditorDialog.tsx`](../../apps/web/components/properties/PropertyEditorDialog.tsx) med adressförslag (30 direkt, sedan 1 per 2 s).
- **Vid 200+:** 500 fastigheter för hand är inte realistiskt; det är det första en stor kund möter.
- **Åtgärd:** Import av CSV/Excel (namn, adress, ev. koordinater, grupp). Validering och förhandsvisning,
  geokodning i en bakgrundskö som respekterar Geoapifys gränser, och en granskningslista för
  osäkra positioner (precision `street`/`approximate`) där kunden kan sätta nålen. Ingen SMS-regel
  slås på automatiskt för importerade fastigheter.

**S-29 Varje sparad fastighet räknar om matchningar för hela plattformen** · P2 · Fas 6
- **Var:** `propertyChanged` i [`monitoring/service.ts:170`](../../apps/api/src/monitoring/service.ts) → `rematchEvents(this.db)` och `rematchUtilityOutages(this.db)` (rad 180) utan organisationsfilter, plus täckningsrapport för hela organisationen och `requestJobRun(PER_PROPERTY_JOBS)`.
- **Vid 200+:** Import av 500 fastigheter = 500 omräkningar av alla matchningar för alla kunder.
- **Åtgärd:** Matcha om bara den ändrade fastigheten (eller organisationen); debounce så att en import
  gör det en gång i slutet.

**S-30 Taket är 500 fastigheter** · P2 · Fas 6
- **Var:** [`customer.ts:29`](../../apps/api/src/routes/customer.ts), [`notifications.ts:151`](../../packages/domain/src/notifications.ts).
- **Vid 1000:** Går inte. SMS-regler med "valda fastigheter" kan inte heller omfatta fler än 500.
- **Åtgärd:** Tak per organisation (kolumn i `organization_settings`, standard enligt prisnivå). Höj
  först efter Fas 3, när en portfölj på 1000 inte längre är ~19 MB per sidladdning.

### 4.7 Plattform och bakgrundsjobb

**S-31 Prognos hämtas per fastighet** · P3 · Fas 7
- **Var:** `runForecasts` i [`jobs.ts`](../../apps/api/src/monitoring/jobs.ts) (40 per körning; cachen gäller bara inom en körning och nyckeln är 3 decimaler, ~100 m).
- **Vid 1000+ (alla kunder):** SMHI:s rutnät är ~2,5 km; många fastigheter delar punkt men hämtas och
  sparas var för sig, och genomloppet tar fler omgångar (driver S-12).
- **Åtgärd:** Spara prognosen per rutnätspunkt och låt fastigheter peka på den; hämta varje punkt en
  gång per cykel oavsett organisation.

**S-35 Nowcast hinner inte med fler än ~500 olika platser** · P2 · Fas 7
- **Var:** `runNowcast` i [`jobs.ts`](../../apps/api/src/monitoring/jobs.ts) (punkter avrundade till 0,01°, ~1 km; 4 hämtningar åt gången med 1 s paus; tidsgräns 180 s; körs var 5:e minut).
- **Vid 500–1000 (alla kunder):** Fastigheter spridda över landet ger nästan en punkt var. Vid ~1,5 s
  per omgång om fyra hinns ~500 punkter innan tidsgränsen. Över det slutar jobbet med `timeout`,
  backoff slår till och regnradarn ("Regn om 20 min") blir gammal för delar av portföljen – samtidigt
  som jobbet blockerar kön i 180 s (S-34).
- **Åtgärd:** Dela upp i delmängder per varv (äldst först, `moreWork`) i stället för alla förfallna
  punkter, och fler parallella hämtningar inom MET Norways villkor. Hämta nowcast bara för fastigheter
  där det ska visas (t.ex. inte för pausade).

**S-32 Live-strömmen har ett tak på 500 lyssnare** · P3 · Fas 7
- **Var:** [`bus.ts`](../../apps/api/src/monitoring/bus.ts) `setMaxListeners(500)`.
- **Vid många användare:** Fler än 500 öppna flikar i plattformen ger varningar i loggen; inget går
  sönder, men det är ett tecken på att en process bär alla strömmar.
- **Åtgärd:** Höj taket med mätning av antal strömmar i `/health`, och planera för flera API-processer
  (då behövs en delad buss) när det blir aktuellt.

---

## 5. Prestandamål

Mäts med testportföljen och mätskriptet från Fas 0, för 200, 500 och 1000 fastigheter.

| Mått | I dag vid 500 | Mål vid 500 | Mål vid 1000 |
|---|---:|---:|---:|
| Portföljdata till webbläsaren | 9,6 MB | ≤ 0,5 MB | ≤ 1 MB |
| `buildOverviewVM` (dator) | 142 ms | ≤ 30 ms, och inte vid tangenttryck | ≤ 60 ms |
| Byte av fastighet | hela portföljen | en fastighet (≤ 40 KB) | samma |
| Snabbväxla, höjd | hela listan | ≤ 60 % av fönstret | samma |
| Händelseflöde vid en länsvarning | 60 rader, andra händelser borta | 1 kort, rätt antal, övriga kvar | samma |
| Kvittera en länsvarning | 300 klick, 429 efter 60 | 1 klick | 1 klick |
| Live-uppdateringar per timme | ~20 hela omladdningar i dag, ~40 vid 1000 | bara berörda rader | samma |
| `/v1/portfolio`, ett anrop (testdatabas) | 1,6 s (3,3 s vid 1000) | ≤ 500 ms | ≤ 1 s |
| Heaptopp per portföljanrop i API:t | 142–160 MB (187–195 vid 1000) | ≤ 30 MB | ≤ 50 MB |
| Tre samtidiga anrop vid 192 MB heap | minnesbrist | klarar | klarar |
| Längsta väntan för `sms_notifications` | 284 s (i dag, 13 fastigheter) | ≤ 45 s | ≤ 45 s |

---

## 6. Faser

Faserna är ordnade efter hur mycket de påverkar användarna. Fas 0 är en förutsättning för att kunna
verifiera resten lokalt.

### Fas 0 – Testportfölj och mätbänk

**Mål:** Kunna se och mäta appen med 200, 500 och 1000 fastigheter på `localhost:3000`.

1. Demoläget får en parameter för storlek, t.ex. `/demo/overview?n=500` (sparas i en cookie så att
   den följer med mellan sidor), som klonar demoportföljen deterministiskt: stabila id:n, spridda
   positioner över Sverige, namn med löpnummer, och demoflödets händelser kopierade så att en
   länsvarning träffar en stor andel. Bara när `FASTIGHETSRADAR_DEMO_ENABLED=true`; aldrig i live.
2. Mätskript i repot (`scripts/measure-portfolio.ts` eller test i `apps/web/test`) som skriver
   tabellen i avsnitt 2.1 – storlek, zod-tid, `buildOverviewVM`, `buildDetailVM`.
3. En syntetisk organisation för API/SQL: seed i `packages/db` som skapar N fastigheter, prognosrader i
   produktionsstorlek (avsnitt 2.3), matchningar och ändringar för en länsvarning. Kör den i den
   befintliga testdatabasen `fastighetsradar_test` på podden (samma väg som
   `scripts/run-real-db-tests.mjs`) och mät `/v1/portfolio` med `app.inject` och en fejkad
   `verifyAuth` – tid, byte och `heapUsed` vid 200/500/1000 och vid 3 samtidiga anrop. Kör aldrig mot
   applikationsdatabasen `fastighetsradar`.
4. Logga byte, antal fastigheter, tid och `heapUsed` per portföljanrop i API:t (inga data), så att
   verkliga kunder kan följas efter driftsättning.

**Klart när:** `/demo/overview?n=500` visar 500 fastigheter, mätskriptet ger samma siffror som avsnitt
2.1 (± brus), och mätningen mot `fastighetsradar_test` har gett tid, byte och heap för
`/v1/portfolio` vid 200/500/1000 – skrivna i Fasloggen. Om heapen vid 500 och tre samtidiga anrop går
över ~150 MB: säg till produktägaren direkt, eftersom S-33 då är akut för nästa större kund.

**Genomfört (gren `claude/skalning-fas0`):**
- `scaleDemoPortfolio` i `packages/domain/src/fixtures/scaled-demo-portfolio.ts`. Avvikelse från punkt 1:
  klonerna sprids över **Stockholms län** (inte hela Sverige) så att demots regionala varningar
  ("Stockholms län") fortfarande stämmer; område och kommun sätts efter närmaste kommuncentrum.
  Den kvitteringspliktiga SMHI-varningen blir en länsvarning som når alla fastigheter.
- `/demo/…?n=500` sparar storleken i cookien `fr_demo_size` (`apps/web/proxy.ts`), `?n=0` återställer.
  Högst 2000. Bara i demoläget och bara utanför produktionsbyggen (demot är avstängt i produktion,
  kontrollerat 2026-11-22).
- Klientmätning: `npm run measure:portfolio [storlekar…]` (`scripts/measure-portfolio.mts`).
- Serverloggning: `portfolio built` med `portfolio.{properties, bytes, durationMs, heapUsedMb}` per
  anrop till `/v1/portfolio` (`apps/api/src/routes/customer.ts`).
- Mätning mot testdatabasen: `node scripts/run-portfolio-scale.mjs [storlekar…]` bygger
  `tests/perf/portfolio-scale.ts`, seedar `org_perfscale<n>` i `fastighetsradar_test`, mäter i
  barnprocesser med 192 MB heap (som produktionen) och söker minsta heap som klarar anropet, och
  städar sedan bort alla `perf`-data. Fastighetskontext (SGU/MCF/SCB) seedas inte.

### Fas 1 – Hitta rätt fastighet

**Mål:** Användaren hittar och byter fastighet lika snabbt med 500 som med 5.
**Fynd:** S-01, S-02, S-03, S-13, S-22, S-27 (listdelen).

1. `PropertyPicker` (S-01) – används av Snabbväxla och fastighetsväljaren på fastighetssidan.
2. Kommandopaletten i sidhuvudet (S-02) med `⌘K`/`Ctrl+K`.
3. Memoisering och stabila callbacks (S-03).
4. Kartan behåller zoom vid uppdatering (S-13).
5. Tak på vädrets KPI-listor och täckningslistan (S-22).
6. SMS-regelns fastighetsval: sök, markera alla som syns, antal valda; trunkerade namn i
   aktivitetsloggen (S-27).

**Test:** DOM-tester för `PropertyPicker` (sök med å/ä/ö, piltangenter, Esc, max 100 rader, aktuell
fastighet i vy), för kommandopaletten och för att kartans `fitBounds` inte anropas vid ny
portfölj med samma grupp.
**Klart när:** Med `?n=500` är Snabbväxla högst 60 % av fönstret och sökbar; sidhuvudets sök hittar
en fastighet på namn och adress; att skriva i fastighetslistans sök startar inte `buildOverviewVM`
(mätt med profiler eller räknare i test). Visat på localhost:3000 och godkänt.

**Genomfört (gren `claude/skalning-fas0`, 2026-11-22):**
- `PropertyPicker` ersätter `PropertyList` i Snabbväxla och i fastighetssidans växlare: sökfält med fokus
  direkt (namn, adress, område, kommun; alla ord måste finnas, exakt namn och namn som börjar med sökningen
  först), ↑/↓/PgUp/PgDn/Enter, Esc via popovern, högst 100 rader med "Visar 100 av 500 – skriv för att
  söka", egen scroll, aktuell fastighet markerad ("Visas nu") och i vy, senast besökta (localStorage i
  try/catch) överst. Uppmätt med `?n=500`: menyn är 460,8 px i ett 768 px fönster (60 %).
- Sidhuvudets sök är en kommandopalett (`CommandPalette`, ⌘K/Ctrl+K eller klick) med samma väljare;
  texten säger "Sök fastigheter" tills larm är sökbara. Fokus tillbaka till sökfältet vid Esc.
- `DashboardStateProvider` har stabila callbacks och memoiserat värde; `buildOverviewVM`/`buildDetailVM`
  memoiseras i översikt, fastighetslista, mobila larm och fastighetssida; fastighetslistans sök använder
  `useDeferredValue`. Test: 0 extra `buildOverviewVM` medan man skriver (tidigare en per tangent).
- Kartan uppdaterar nålar per id och kör `fitBounds` bara när mängden fastigheter ändras.
- Täckningslistan visar 10 fastigheter och "Visa alla N". Vädrets KPI-kort hade redan tak (5 i kortet,
  scrollbar ruta för "Visa alla"), så den är oförändrad.
- SMS-regelns fastighetsval (`RulePropertySelect`): sök, "Markera alla (som syns)", "Avmarkera", "X av Y
  valda"; aktivitetsloggen visar "A, B och 298 till" med "Visa alla". Inte visat i webbläsaren eftersom
  SMS-regler inte finns i demoläget – täckt av DOM-test.

### Fas 2 – Larm och kvittering vid stora händelser

**Mål:** En länsvarning över hundratals fastigheter är **ett** larm som kan förstås och kvitteras på
en gång, och andra händelser syns fortfarande.
**Fynd:** S-04, S-05, S-06, S-07, S-08, S-09.

1. Flödet begränsas per händelse och revision (S-04); kontraktet får antal berörda och fastighets-id:n
   per grupp.
2. Batch-kvittering i API, BFF-allowlista och UI, inklusive ångra för gruppen (S-05).
3. Larmräknaren räknar händelser (S-06).
4. Aktiva larm grupperas i SQL och får index (S-07).
5. Händelsesida `/larm/<händelse>` (S-09) – i demo och live.
6. Kvitteringsrapporten grupperad per händelse, exportendpoint, CSV, Web Worker, sökbart
   fastighetsfilter (S-08).

**Test:** SQL-test för flödesfrågan (länsvarning över 300 fastigheter + 5 andra händelser → alla 6
händelserna kommer med); API-test för batch-kvittering (behörighet: bara egna rader; transaktion;
historik en rad per fastighet); DOM-test för "Kvittera alla" och räknaren; PDF-test med 3 000 rader
(befintligt `apps/web/test/acknowledgement-export.dom.test.tsx` utökas).
**Klart när:** Med `?n=500` visar flödet länsvarningen som ett kort med rätt antal och övriga händelser
kvar; "Kvittera alla" kvitterar alla i ett anrop; badgen visar antal larm; PDF för 3 000 kvitteringar
laddas ner. Visat på localhost:3000 och godkänt.

**Ordning inom Fas 2:** 1) flöde och larm per händelse (S-04, S-06, S-07), 2) "Kvittera alla" (S-05),
3) händelsesida (S-09), 4) kvitteringsrapporten (S-08).

**Genomfört steg 1 (gren `claude/skalning-fas0`):**
- **Mätning före** (testdatabasen, 500 fastigheter, `run-portfolio-scale.mjs --feed`; en länsvarning som
  når 320 fastigheter, ett Krisinformation-meddelande till alla 500, trafik): flödet hade 30 rader och
  **ett** kort – Krisinformation med "30 berörda" i stället för 500. Länsvarningen och all trafik var borta.
- **Flödet per händelse (S-04):** SQL:en väljer de 60 senaste *händelserna* (samma revision av samma
  källhändelse över alla fastigheter den når) och hämtar alla deras rader (tak 5 000 rader); API:t
  begränsar till 30 händelser i stället för 30 rader (`FEED_EVENT_LIMIT`). Kortets fastighetslista
  renderas först när kortet öppnas.
- **Larmräknaren (S-06)** räknar olästa händelser; "att kvittera" visar händelser och, när de når fler,
  antal fastigheter ("126 att kvittera · 625 fastigheter"). Lästmarkeringen är kvar per fastighet.
- **S-07 inte ändrat:** de aktiva larmen tog 3 ms vid 500 (301 rader, Fas 3-profilen) och använder redan
  `idx_monitoring_changes_event`; en gruppering i SQL ändrar kontraktet utan mätbar vinst.
- **Efter:** flödet visar 30 kort – Krisinformation med alla 500 fastigheter, länsvarningen med alla 320
  och 28 trafikhändelser. Pris: 848 rader i stället för 30 (~0,5 MB okomprimerat; en rad per fastighet
  behövs för kvitteringen). Demo vid `?n=500`: vindvarningen är ett kort med "500 berörda fastigheter",
  menyns larmräknare 625 → 126.
- **Test:** SQL-test mot riktig PostgreSQL (länsvarning över 300 fastigheter + 5 andra händelser → alla 6
  kommer med, varningen med alla 300 rader; gräns 3 → länsvarningen och de två senaste); API-test för
  30 händelser med 300 rader i en; DOM-test att gruppens rader visas när kortet öppnas.
- **Rättat på vägen:** testet "PostGIS matching" i den riktiga databassviten läste närliggande
  observationer från `/v1/portfolio`, som inte har dem sedan Fas 3 steg 1 – sviten kördes inte då.
  Testet läser dem nu från fastighetens snapshot och kontrollerar att listan saknar dem.
- **Öppen fråga:** översiktens nyckeltal "Aktiva larm" räknar varning × fastighet (872 i demo vid 500);
  rutan "Officiella varningar" visar redan antalet varningar.

**Genomfört steg 2 – "Kvittera alla" (gren `claude/skalning-fas0`):**
- `POST /v1/feed/acknowledgements/batch` med `changeIds` (högst 1 000) och `acknowledged`: en SQL-sats,
  så allt eller inget; bara organisationens egna rader; redan kvitterade rader behåller sin tid.
  Historiken får fortfarande en rad per fastighet (triggern), som rapporten behöver. Hastighetsgränsen
  räknar anrop: 60 batchar à 1 000 rader går, inte 60 rader. Ny rutt i BFF:ens allowlista.
- Gruppkortet har "Kvittera alla (N)"; direkt efter visas "Ångra", som ångrar exakt de rader knappen
  kvitterade (i samma anrop). Ångra per kvittering finns kvar på kvitteringssidan. Samma i demoläget
  (`toggleMany`) och på mobilen.
- **Test:** API (bara egna rader, 1 001 avvisas, ogiltiga id avvisas, ångra, en token per anrop); riktig
  PostgreSQL med 300 fastigheter (en sats kvitterar alla 300, en annan organisation kvitterar inget,
  ny kvittering behåller tiden, 300 historikrader en per fastighet, ångra markerar alla 300); DOM-test
  på dator och mobil (ett anrop med de väntande raderna, kortet öppnas inte, "Ångra" först när
  sparningen är klar och bara för knappens rader).
- **Visat på localhost** (`/demo/alerts?n=500`): ett klick på "Kvittera alla (500)" → "500 av 500
  kvitterade" och "Ångra"; chippet 126 → 125 att kvittera; kvitteringssidan har en rad per fastighet.

**Genomfört steg 3 – händelsesidan (gren `claude/skalning-fas0`):**
- `/alerts/<händelse>` (live och demo; följer appens engelska sökvägar i stället för `/larm/…`):
  varningstexten en gång med område och giltighet, karta med de berörda fastigheterna, sökbar lista
  (100 rader och "Visa alla"), "Kvittera alla (N)" och kvittering per fastighet. Gruppkorten i flödet
  har länken "Öppna händelsen".
- API: `GET /v1/events/:id` – händelsen och organisationens alla berörda fastigheter (träffade nu
  eller i historiken) med den senaste flödesraden att kvittera; 404 för en händelse som aldrig nått
  organisationen. `loadOrgEvent` i `packages/db`.
- **Grupperade SMS** (en händelse över flera fastigheter) länkar till `/h/<nyckel>` → händelsesidan;
  SMS om en fastighet länkar som förut till `/p/<nyckel>`. Nyckeln är händelsens första 16
  hexsiffror (`eventLinkKey`) – ingen migrering; `GET /v1/events/links/:key` slår upp den bara för
  organisationen händelsen nått (och bara om nyckeln är entydig).
- **Test:** riktig PostgreSQL (händelsesidan för 300 fastigheter, en annan organisation får inget,
  länknyckeln; regelns förhandsvisning: grupperat SMS → `/h/<nyckel>`, en fastighet → `/p/<nyckel>`,
  API 200 för egen organisation och 404 för annan); API (401/403, 404, 400); demo (500 fastigheter en
  gång med varningstext); DOM (text en gång, 100 rader + "Visa alla", sök, "Kvittera alla" i ett
  anrop).
- **Visat på localhost** (`/demo/alerts?n=500` → "Öppna händelsen"): 500 fastigheter på kartan och i
  listan, varningstexten en gång, sök, "Kvittera alla (500)" → alla rader "Kvitterad"; mobilbredd utan
  sidledsrullning.

**Genomfört steg 4 – kvitteringsrapporten (gren `claude/skalning-fas0`):**
- **En hämtning:** `GET /v1/feed/acknowledgements/export` ger hela urvalet i ett anrop (högst
  10 000 kvitteringar, de senaste; `truncated` när fler matchar – rapporten säger det) i stället för
  sida efter sida om 30.
- **Grupperad per händelse** (`groupAcknowledgements`; källa, rubrik, händelsetid och text – historiken
  har inget händelse-id): den korta listan har en rad per händelse ("300 fastigheter"); den fullständiga
  rapporten skriver varningstexten en gång och fastigheterna i en kort tabell. En händelse med en
  fastighet ser ut som förut.
- **PDF:en byggs i en Web Worker** (`pdf.worker.ts`), med huvudtråden som reserv om workern inte
  startar. **CSV** med en rad per fastighet (semikolon och BOM för svensk Excel). **Sökfält** i
  fastighetsfiltret när det finns fler än 10 fastigheter.
- **Mätning** (pdfmake i Node, 3 000 kvitteringar över 10 händelser à 300 fastigheter): fullständig
  rapport som förut (ett avsnitt med text per rad) **113 s och 2,1 MB** – i huvudtråden, alltså en
  frusen flik – nu **0,9 s och 388 KB**; kort lista 0,1 s, 21 KB. I webbläsaren (demo, 500+ kvitteringar):
  fullständig rapport 0,76 s i workern, huvudtråden blockerad högst 72 ms; CSV 97 KB.
- **Test:** riktig PostgreSQL (300 kvitteringar i ett anrop, taket markeras, annan organisation får
  inget); API (filter och datumkontroll); rapporten med 3 000 kvitteringar (en rad per händelse,
  texten en gång), taket i rapporten, CSV (citattecken, semikolon, BOM); kvitteringssidan hämtar
  exporten med ett anrop.
- **Inte ändrat:** kvitteringssidans lista på skärmen visar fortfarande en rad per fastighet, 30 åt
  gången; "Ångrad av"/"Kvitterad av" namnges inte (historiken sparar användar-id, inga namn).

### Fas 3 – Lättare dataflöde

**Mål:** Sidladdning, fastighetsbyte och live-uppdatering kostar lika lite vid 500 fastigheter som i
dag vid 50.
**Fynd:** S-10, S-11, S-12, S-14, S-15, S-16, S-17, S-33.

1. Nytt kontrakt: portföljlista + fastighetsdetalj (S-10). Uppdatera `PortfolioSchema`, API, BFF,
   demo och alla vymodeller. Versionera så att en gammal flik inte kraschar under driftsättning.
2. Fastighetssidan och metadata hämtar bara en fastighet (S-11).
3. SMS-kortlänken flyttas ut ur dashboard-layouten (S-14).
4. Live-signaler per organisation och fastighet, sammanslagning av centrala signaler, radvis
   uppdatering och `ETag` (S-12).
5. `Map`-indexering i snapshot-byggaren och notifieringsberikningen (S-15).
6. SQL: händelser en gång, sparad närmaste station, bara nödvändiga prognossteg i listan, tidsgräns på
   flödet, index; `EXPLAIN` på den syntetiska organisationen (S-16). Summary räknar utan att bygga
   allt (S-17).
7. Minnesskydd: ett portföljbygge åt gången per organisation, slumpad refresh-fördröjning i klienten,
   `heapUsed` i loggen per portföljanrop (S-33).

**Test:** Kontraktstest för listan (storlek per fastighet < 1 KB i fixtures); snapshot-tester ger
samma utdata före och efter `Map`-refaktoreringen; test att `/properties/:id` inte anropar
`/v1/portfolio`; test att prognosjobbet publicerar fastighets-id:n och inte `'all'`.
**Klart när:** Målen i avsnitt 5 för datamängd, fastighetsbyte och live-uppdatering är uppfyllda i
demoläget med `?n=500`, och `EXPLAIN`-planerna från podden finns i Fasloggen. Visat och godkänt.

**Mätning före steg 1 (2026-11-22, testdatabasen, 500 fastigheter, `run-portfolio-scale.mjs --fields`):**
28,7 KB per fastighet varav prognos 7,7 KB (serie 6,2 + dygn 1,2), övervakningskontext 6,9 KB
(observationer 3,2 + luftkvalitet 3,0), mätvärden 6,0 KB (13 st), händelser 2,0 KB, riskindex 1,3 KB,
varningar 1,1 KB, uppmätt regn 0,6 KB. Produktionens svar är gzip-komprimerade (nginx), så upprepad
källinformation kostar lite över nätet – kostnaden är att bygga, serialisera, parsa och hålla data
som listan aldrig läser. Därför **ingen packning av formatet**; i stället skickas den datan inte alls.

**Ordning inom Fas 3:** 1) detalj vid behov (S-10, S-11, S-14), 2) live-signaler per fastighet (S-12),
3) API:t: minnesskydd, `Map`-indexering, SQL och `EXPLAIN` (S-33, S-15, S-16, S-17).

**Genomfört steg 1 (gren `claude/skalning-fas0`):**
- `listSnapshot`/`listPortfolio` (domain): listan behåller formen men tömmer prognosserie och -dygn,
  uppmätt regn, närliggande observationer/luftkvalitet/täckning och mätvärden som ingen listvy läser
  (`LIST_METRIC_KEYS`). `/v1/portfolio` och demolägets layout skickar listan.
- Fastighetssidan hämtar en fastighet via `/v1/properties/:id/snapshot` (även `generateMetadata`,
  delat med `cache()`), aldrig hela portföljen (S-11). `PropertyDetailData` registrerar den före
  `PropertyDetail` i layouten, så serverns HTML är komplett; vid fel visas listdata med ett meddelande.
- SMS-kortlänken `/p/<nyckel>` ligger utanför dashboard-layouten (S-14).
- Test: alla listvyers vymodell (översikt i alla grupper, nowcast-märken) är identiska från listan och
  från hela portföljen (demo och 500); fastighetssidan anropar bara snapshot-endpointet.
- **Efter (testdatabasen, 500):** 14,4 MB → 6,0 MB, 28,7 → 12,1 KB per fastighet. Demo: 9,6 → 6,3 MB.
  Fastighetsbyte i demoläget: en begäran på 22 KB (6 KB över nätet) i stället för att API:t bygger hela
  portföljen.

**Genomfört steg 2 (gren `claude/skalning-fas0`):**
- **Signaler per fastighet.** Prognosen, nowcast (bara punkter som faktiskt hämtades) och SGU/MCF/SCB
  publicerar organisation + fastighets-id i stället för `'all'` (`JobResult.changed.properties`).
  Centrala källor (stationer: observationer, luftkvalitet, vattenföring, havsvattenstånd; länsområden)
  slås ihop i bussen till högst en signal per 5 minuter med alla källor som ändrats
  (`CENTRAL_SIGNAL_GAP_MS`); signalen har `all: true` och inga fastighets-id.
- **Nya läsvägar.** `GET /v1/portfolio/rows?ids=…` (högst 50): listraderna för de fastigheterna plus
  flödet, larmkandidaterna, deras kommande förhållanden och källstatus – byggt med samma funktioner som
  listan, men övervakningsdata hämtas bara för de fastigheterna (`loadOrgMonitoring` tar flera id).
  `GET /v1/portfolio/nowcast[?ids=…]`: bara radarprognosen (en fråga).
- **Klienten** (`lib/live/use-live-updates.ts`, `lib/live/patch.ts`): samlar signaler och hämtar minst
  15 s isär plus slumpad 0–5 s (S-33); dolda flikar väntar tills de visas. Ändrade rader (data eller
  händelser) lappas in med flöde, aktiva larm och kommande förhållanden; nowcast lappas separat;
  observationer (visas bara på fastighetssidan) laddar bara om den öppna fastigheten. Den öppna
  fastighetens fulla snapshot hämtas om när den berörs. **Hel omladdning** (`router.refresh()`) bara
  vid: central källa som listan visar, signal utan fastighet (fastighet tillagd/flyttad/borttagen),
  avbrott (`utility_outages` – täckningsrapporten), fler än 50 fastigheter, en källa som bytt status,
  och när listan är äldre än 30 minuter (rader byggs med tidpunkten: aktuell prognostimme, färskhet).
- **Avvikelser från planen:**
  - Egna endpoints i stället för `GET /v1/portfolio?ids=…`, eftersom svaren har ett annat format än listan.
  - **Ingen `ETag`.** Listans svar ändras vid varje jobbkörning (källstatus, `generatedAt`), och hela
    omladdningar går via serverrenderingen, där ett `304` bara kan återanvändas om webbservern sparar
    varje användares portfölj. Radvisa uppdateringar ger samma besparing.
  - Även händelsesignaler (Trafikverket, varningar) lappas radvis med flödet. I produktion kom de 1,2
    gånger per timme för organisationen med 11 fastigheter, nästan bara från Trafikverket; vid 500
    fastigheter blir det nära var 5:e minut (en per trafikkörning).
  - "Kommande förhållanden": de lappade fastigheternas förhållanden byts ut. Ett förhållande för en
    annan fastighet som låg under plats 8 är okänt för klienten, så en ledig plats fylls av det näst
    bästa kända fram till nästa hela omladdning (högst 30 minuter). Fas 4 (S-21) gör om listan.
- **Mätning (testdatabasen, 500 fastigheter, `run-portfolio-scale.mjs --live 500`):** hela listan 1,6 s,
  6,0 MB, +115 MB heap. En prognoskörning (40 fastigheter) som radvis uppdatering: 0,26 s, 0,65 MB,
  +27 MB heap. Den lappade listan är identisk med hela listan för rader, flöde, aktiva larm och kommande
  förhållanden. Nowcast: 1,3 KB per punkt i produktion (23 värden), alltså ~0,9 MB för alla 500 mot
  6,0 MB för listan. Av de 0,65 MB är ~0,15 MB larmkandidater (länsvarningen över 60 % av fastigheterna)
  och tiden domineras av organisationsövergripande frågor (flöde, larm) – steg 3 (S-16).
- **Per timme och öppen flik vid 500 (uppskattat från uppmätta frekvenser):** i dag ~20 hela
  omladdningar (~40 vid 1000). Efter: nowcast ~12 smala uppdateringar, prognos ~13 radvisa
  (40 fastigheter var), händelser upp till ~12 radvisa, observationer ~4 bara på fastighetssidan,
  luftkvalitet ~1 hel och en hel var 30:e minut – alltså ~3 hela omladdningar per timme.
- **Test:** prognos- och nowcastjobben publicerar fastighets-id och inte `'all'`; bussen slår ihop
  centrala signaler; schemaläggaren skickar varje organisation bara dess fastigheter; endpoints validerar
  id och svarar bara för organisationens fastigheter; signal → rätt hämtning, lappning, dold flik och
  fastighetssida (DOM-test med falsk ström).

**Genomfört steg 3 (gren `claude/skalning-fas0`):**
- **Profil före** (testdatabasen, 500 fastigheter, driftsatt kod `b335ecf`, `run-portfolio-scale.mjs
  --profile`): 1,4 s med frågorna parallellt. Var för sig: SQL 0,58 s, bygget i JS 1,08 s, JSON 10 ms.
  Tyngst i SQL: närmaste station 289 ms (varav ~100 ms JIT-kompilering), observationshistorik 169 ms,
  prognoserna 22,6 MB JSON. Tyngst i JS (CPU-profil): `stepHours` 248 ms och `precipitationTotal`
  145 ms – summeringen sorterade alla prognossteg med `localeCompare` vid varje anrop, ~22 anrop per
  fastighet, varav 20 för dygnssammanställningen som listan aldrig visar.
- **Åtgärder:**
  - `Map`-indexering (S-15) i snapshot-byggaren, "Kommande", SMS-berikningen och SMS-utlösarna.
  - Beräkning: summeringen sorterar bara osorterade serier; nederbördsmåtten byggs en gång per
    fastighet i stället för per dygn och mått; stationshistorik och prognossteg konverteras en gång.
  - **Listläge** (`MonitoringService.list`, `LoadMonitoringOptions.list`): `/v1/portfolio` och de
    radvisa uppdateringarna laddar bara det listan läser – närmaste station för vattenföring,
    havsvattenstånd, PM2,5, PM10 och NO₂ (5 av 14), stationshistorik utan 15-minutersregn, prognossteg
    från 3 h bakåt till 54 h framåt (urval med `jsonb_path_query_array` i SQL) – och räknar inte
    dygnssammanställningar. Kontrollerat vid 500 och 1000: listan är identisk med `listSnapshot` av
    hela bygget (`profile` jämför dem).
  - **JIT av** för appens databasanslutningar (`SESSION_OPTIONS` i `packages/db/src/pool.ts`).
    PostgreSQL kompilerade närmaste-station-frågan vid varje portföljanrop från några tiotal
    fastigheter: ~100 av 137 ms vid 500.
  - Högst ett bygge av organisationens lista åt gången; samtidiga anrop delar resultatet, och bara
    flöde och larm (läst/oläst) hämtas per användare (S-33). `/v1/portfolio/summary` räknar från samma
    lista (S-17).
- **Avvikelser från planen:** ingen tabell för närmaste station (listläge + JIT av räckte: 289 → 38
  ms); ingen kortare tidsgräns för flödet (11 ms vid 500 med 30 dagars ändringar); händelsetexten
  skickas fortfarande en gång per fastighet, eftersom det är en ändring av kontraktet som hör till
  datamängden nedan.
- **Mätning efter** (testdatabasen, `run-portfolio-scale.mjs`, matrisen i barnprocesser):

  | | 500 före Fas 3 | 500 nu | 1000 före Fas 3 | 1000 nu |
  |---|---:|---:|---:|---:|
  | `/v1/portfolio`, ett anrop (median) | 1,6 s | 0,33 s | 3,3 s | 0,69 s |
  | Tre samtidiga anrop (median) | – | 0,49 s | – | 0,87 s |
  | Heaptopp i mätprocessen, ett anrop | 142–160 MB | 120 MB | 187–195 MB | 213 MB |
  | Minsta heap för tre samtidiga | 256 MB | 128 MB | 384 MB | 192 MB |
  | Svar | 14,4 MB | 6,0 MB | – | 12,0 MB |

  En radvis live-uppdatering (40 fastigheter, steg 2) vid 500: 0,26 → 0,06 s, fortfarande identisk med
  listan. Profilen vid 500: 0,26 s parallellt (bygget i JS 108 ms), vid 1000: 0,55 s. Heaptoppen mäts i
  samma process som tolkar svaret, så den räknar med mätarens egen kopia; den följer listans storlek.
- **EXPLAIN (ANALYZE, BUFFERS) vid 500, efter:** flödet 11,5 ms (sekventiell läsning av
  `monitoring_changes`, 5 801 rader efter filtret, top-N-sortering, ett indexuppslag per visad rad
  via `idx_monitoring_changes_event`); närmaste station 37 ms (2 500 uppslag via
  `idx_observation_stations_param` + top-N-sortering; med JIT 137 ms, varav kompilering 99,6 ms);
  prognoserna 38,8 ms (sekventiell läsning, 500 rader, urval i SQL); luftkvalitetshistoriken 10,5 ms
  (merge join, index på fastighetens läge, 8 265 rader).
- **Inte uppfyllt:** datamängden (6,0 MB vid 500 mot målet ≤ 0,5 MB) och heaptoppen (mål ≤ 30 MB).
  Båda styrs av listans storlek, 12 KB per fastighet (mätvärden 4,2 KB, händelser 2,0 KB, riskindex
  1,3 KB, varningar 1,1 KB). Det kräver ett kompaktare listkontrakt – nästa steg om målet ska nås.
- **Iakttaget:** direkt efter att 1000 fastigheter lagts in tog ett anrop 6,1 s tills PostgreSQL
  hunnit uppdatera statistiken (därefter 0,69 s). Gäller också en stor kund som importerar allt på en
  gång – se Fas 6.

**Genomfört steg 4 – listans kostnad (gren `claude/skalning-fas0`):**
- **Beslut: inget kompakt listkontrakt.** Mätt vid 500 (testdatabasen, `run-portfolio-scale.mjs --fields`
  med underfält): 12,1 KB per fastighet – mätvärden 4,2 KB (varav upprepad `geo`-text 1,0 KB), händelser
  2,0 KB, riskindexets faktorer 1,1 KB, varningstexter 0,4 KB; på portföljnivå täckningsrapporten 374 KB.
  Med demolistan vid 500: som den är 5,8 MB / **337 KB med gzip**; utan texter listan inte läser 5,7 MB /
  313 KB; förlustfritt packad (strängtabell, kolumner) 1,9 MB / 96 KB. Produktionen gzippar svaren, så
  **det som går över nätet är redan under målet 0,5 MB**, och webbläsaren tolkar de 6 MB på 29 ms. En
  packning minskar inte minnet efter uppackning, och 1 KB per fastighet kräver en ny radmodell och att
  alla listvyer skrivs om – för liten märkbar vinst. Målet i avsnitt 5 läses därför som överfört (gzip).
- **Det som märktes var `buildOverviewVM`:** 145 ms vid 500 och 289 ms vid 1000 (dator), och sedan steg 2
  körs den vid varje live-uppdatering. CPU-profil: ~120 av 169 ms gick till nowcast – 24 radarstaplar
  med klockslag per fastighet, fast bara fastighetssidan visar dem.
- **Åtgärder:** listraderna och Snabbväxla räknar bara märket och källraden (`nowcastBadge`); staplarna
  bara på fastighetssidan (`nowcastVM`). `summarizeNowcast` sorterar bara osorterade punkter och tolkar
  varje punkts tid en gång. Flödets tidsetiketter räknar dagens och gårdagens datum en gång per flöde.
- **Efter:** `buildOverviewVM` 145 → 30 ms vid 500, 289 → 56 ms vid 1000 (`npm run measure:portfolio`).
  Test: märket och källraden är identiska med den fullständiga vymodellen för 60 fastigheter vid nio
  tidpunkter; osorterade radarpunkter ger samma sammanfattning. Visat på localhost: 312 regnmärken i
  översikten vid `?n=500`, märken i Snabbväxla, fastighetssidans radarpanel med 24 staplar.

### Fas 4 – Listor, karta och grupper

**Mål:** Översikt över hundratals fastigheter på karta och i tabell, uppdelat så som kunden
organiserar sitt bestånd.
**Fynd:** S-18, S-19, S-20, S-21, S-27 (gruppdelen).

1. Fastighetsgrupper: migrering, API, fastighetsdialog, gruppval överallt (S-20).
2. Klustring på desktop- och mobilkartan (S-18).
3. Kolumnsortering, filter, fast rubrik och renderingsbudget i fastighetstabellen och mobilkorten
   (S-19).
4. "Kommande förhållanden" grupperat per förhållande (S-21).
5. SMS-regel med omfattning "grupp" (S-27).

**Test:** Migreringstest; API-test för grupper (tenant-isolering); DOM-test för sortering och filter;
test att klustret får värsta status.
**Klart när:** Med `?n=500` går det att filtrera på grupp i översikt, lista, karta och larm; kartan
visar kluster med rätt färg; "Kommande" visar grupperade rader. Visat och godkänt.

### Fas 5 – SMS vid stora händelser

**Mål:** Inget larm tappas tyst, de viktigaste går först, och en länsvarning blir ett begripligt SMS.
Måste vara klar innan riktiga SMS slås på för stora kunder.
**Fynd:** S-23, S-24, S-25, S-26, S-34, samt länken till händelsesidan från S-09.

0. Larmjobben får en egen loop som aldrig väntar på tunga jobb; tidsbudget per varv för de tunga;
   väntetid för larmjobben i loggen och `/health` (S-34). Görs först – den hjälper redan i dag.
   **Gjort 2026-11-22** utom tidsbudgeten för tunga jobb (se S-34).
1. Minuttaket köar i stället för att spärra; kön sorteras på allvar (S-23).
2. Nödundantag från dagstaken, allvarsordning, varning i regelredigeraren, tak per prisnivå (S-24).
3. Fastigheter över dagstak tas bort ur gruppen i stället för att spärra hela SMS:et (S-25).
4. Batchade räknare, transaktion per regel, `processOutbox` med tidsbudget (S-26).
5. Samlade SMS länkar till händelsesidan.

**Test:** Enhetstester för `enqueue`-beslut (minuttak → köad; VMA förbi dagstak; en fastighet över
tak → övriga skickas); lasttest i simulatorn med den syntetiska organisationen (en länsvarning över
500 fastigheter, 10 mottagare, tre regler) som visar att alla meddelanden blir `simulated` eller
medvetet spärrade med skäl, och att körningen ryms i jobbets tidsgräns.
**Klart när:** Lasttestet är grönt och resultatet (antal per status, körtid) står i Fasloggen, och
API-loggen på podden visar att `sms_notifications` inte väntat mer än 45 s under ett dygn efter
driftsättning (mäts på samma sätt som i avsnitt 2.3).

**Genomfört steg 1–4 (gren `claude/skalning-fas0`; steg 5 – samlade SMS länkar till händelsesidan –
gjordes i Fas 2 steg 3):**
- **Mätning mot riktig PostgreSQL** (organisation med 300 fastigheter, en orange länsvarning,
  `tests/integration/notifications.ts`, "Fas 5"):

  | Läge | Före | Efter |
  |---|---|---|
  | Samlat SMS över 300 fastigheter när minuttakten är full och 5 fastigheter nått dagstaket | `suppressed_limit` för alla 300 – skickas aldrig | köat för 295; loggen namnger de 5 som togs bort |
  | VMA när mottagaren och organisationen nått dagstaket | `suppressed_limit` | köat för alla 300 |
  | En ledig plats i minuten, en orange varning och ett VMA i kön | – (inget köat) | VMA:t skickas först |
  | Regel utan samling över 300 fastigheter (orange) | 5 köade, 295 spärrade, 0,21 s | samma (avsiktligt, mottagarens dagstak), 0,19 s; redigeraren föreslår samling |

- **Ändringar:** minuttakt vid utskick i stället för vid köning (S-23); prioritet i kön (migrering
  0023); nödundantag med eget tak, VMA-regler och allvarsordning först, varning i regelredigeraren
  (S-24); fastigheter över taket tas bort ur gruppen (S-25); dagsräknare i en sats, en transaktion per
  regel, tidsbudget i `processOutbox` (S-26). Befintligt test för minuttakten ändrat: över takten köas
  meddelandet och skickas inte förrän det finns plats.
- **Inte gjort:** tak per prisnivå (inga prisnivåer i datamodellen); riktiga SMS är fortfarande
  avstängda – allt ovan är mätt i simuleringsläget.

### Fas 6 – Stora kunder in

**Mål:** En kund kan lägga in 500–1000 fastigheter på en eftermiddag.
**Fynd:** S-28, S-29, S-30.

1. Omatchning per fastighet/organisation med debounce (S-29) – före importen.
2. CSV/Excel-import med bakgrundsgeokodning och granskningslista (S-28).
3. Tak per organisation; höj till 1000+ när Fas 3 är klar (S-30). Uppdatera prissidans Enterprise-
   rad bara om produktägaren beslutar det.
4. `ANALYZE` på de berörda tabellerna efter en import. I Fas 3 tog ett portföljanrop 6,1 s direkt
   efter att 1000 fastigheter lagts in, tills PostgreSQL uppdaterat statistiken (sedan 0,69 s).

**Test:** API-test för import (validering, dubbletter, tenant-isolering, tak); test att en import
utlöser en omatchning; DOM-test för granskningslistan.
**Klart när:** Import av 500 rader i demoläget/testmiljön ger 500 fastigheter med status per rad, och
omatchning körs en gång.

### Fas 7 – Plattformslast

**Mål:** Många stora kunder samtidigt utan att bakgrundsjobben eller live-strömmen blir flaskhalsen.
**Fynd:** S-31, S-32, S-35.

1. Prognos per rutnätspunkt, delad mellan fastigheter och organisationer (S-31).
2. Nowcast i delmängder per varv (S-35).
3. Mätning av strömmar och höjt lyssnartak (S-32).

**Klart när:** Ett prognosgenomlopp för den syntetiska organisationen gör färre SMHI-anrop än antal
fastigheter (siffror i Fasloggen).

---

## 7. Kända okända

- Hur stort `/v1/portfolio`-svaret är per fastighet i live (databasvolymerna är uppmätta i 2.3, men
  inte svarets storlek). Mät i Fas 0 genom att logga byte, antal fastigheter, tid och `heapUsed` per
  portföljanrop på podden (inga data).
- Var gränsen för minnesbrist faktiskt går (S-33) – mäts mot testdatabasen med 200/500/1000
  syntetiska fastigheter och flera samtidiga anrop.
- Hur ofta SMHI-varningar täcker hundratals fastigheter för en verklig kund – styr hur viktig Fas 2 är
  jämfört med Fas 3.
- Om kunder vill gruppera på mer än en dimension (område **och** förvaltare). Påverkar
  datamodellen i Fas 4.
- Vilka SMS-tak som ska gälla per prisnivå (Fas 5) – produktägarens beslut.

---

## 8. Faslogg (fylls i av agenten)

| Fas | Datum | Gren/commit | Mätning före → efter | Inte verifierat |
|---|---|---|---|---|
| Granskning | 2026-11-22 | – (ingen kod) | Avsnitt 2.1–2.2 | API-tider, livesnapshotens storlek |
| Mätning i produktion | 2026-11-22 | – (ingen kod, bara läsning) | Avsnitt 2.3; nya fynd S-33–S-35 | Heap och svarstid vid 200+ (ingen så stor kund) |
| Fas 0 | 2026-11-22 | `claude/skalning-fas0` / `304d8c2` | Klient: avsnitt 2.1 bekräftat (`npm run measure:portfolio`). API mot testdatabas: avsnitt 2.4 – **OOM vid 500 fastigheter × 3 samtidiga anrop** med 192 MB heap. Snabbväxla vid `?n=500`: 32 322 px hög. | Grundförbrukning i riktiga API:t; webbserverns minne; fastighetskontext ej seedad |
| Fas 1 | 2026-11-22 | `claude/skalning-fas0` | Snabbväxla vid `?n=500`: 32 322 px → 460,8 px (60 % av 768 px), 100 rader i stället för 500. Sök i fastighetslistan: `buildOverviewVM` per tangent → 0. | SMS-regelns fastighetsval i webbläsaren (bara DOM-test); kartans zoom vid live-uppdatering (bara DOM-test, demoläget uppdateras inte live) |
| Fas 3 steg 1 | 2026-11-22 | `claude/skalning-fas0` / `6582b7b`, driftsatt 2026-11-22 | `/v1/portfolio` vid 500 (testdatabas): 14,4 → 6,0 MB, 28,7 → 12,1 KB per fastighet. Fastighetsbyte: hela portföljen i API:t → en fastighet (22 KB RSC i demo). | API:ts heap och tid (bygger fortfarande hela portföljen innan listan skärs – steg 3); målet ≤ 1 KB per fastighet (kvar: mätvärden 4,2 KB, händelser 2,0 KB) |
| Lindring S-33 + Fas 5 steg 0 (S-34) | 2026-11-22 | `f216613`, driftsatt 2026-11-22 11:44 UTC | API-heap 192 → 512 MB (`deploy/pod/index.js`), räcker för 1000 × 3 enligt avsnitt 2.4. Schemaläggaren i tre köer: SMS, larmkällor, övrigt. Före: `sms_notifications` väntade upp till 284 s bakom luftkvalitet (200–430 s per körning, avsnitt 2.3). Efter: enhetstest visar att SMS och avbrottskällor körs medan ett tungt jobb pågår. | Efter driftsättning: API:t kör med `--max-old-space-size=512`, köerna `sms` 1 / `alerts` 50 / `background` 17 jobb, `sms_notifications` var 30:e s med `waitedMs` 5–8 ms. Under luftkvalitetskörningen 12:10:54 (pågick fortfarande 12:12:32) körde `sms_notifications` var 30:e s med `waitedMs` 8–10 ms och `krisinformation` med 9,8 s (bakom avbrottskällorna i larmkön) – med den gamla kön hade båda väntat tills luftkvalitet var klar. Inte gjort: tidsbudget per varv för tunga jobb ej gjord (S-35, Fas 7) |
| Fas 3 steg 2 | 2026-11-22 | `claude/skalning-fas0` / `b335ecf`, driftsatt 2026-11-22 15:45 UTC | Live-uppdatering vid 500 (testdatabas): hela listan 1,6 s / 6,0 MB / +115 MB heap → en prognoskörning som radvis uppdatering 0,26 s / 0,65 MB / +27 MB heap; lappad lista identisk med hel lista. Hela omladdningar per timme och flik: ~20 (~40 vid 1000) → ~3 (uppskattat). | Live-strömmen i webbläsaren (demoläget har ingen ström; DOM-test med falsk ström). I produktion efter driftsättning: loggraderna `portfolio rows built` / `portfolio nowcast built` mot `portfolio built` |
| Fas 3 steg 3 | 2026-11-22 | `claude/skalning-fas0` / `158dc43`, driftsatt 2026-11-22 16:59 UTC | `/v1/portfolio` (testdatabas, median): 1,6 → 0,33 s vid 500, 3,3 → 0,69 s vid 1000; tre samtidiga 0,49 / 0,87 s. Minsta heap för tre samtidiga: 256 → 128 MB (500), 384 → 192 MB (1000). Radvis uppdatering 0,26 → 0,06 s. Listan identisk med `listSnapshot` av hela bygget vid 500 och 1000. EXPLAIN i Fas 3, "Genomfört steg 3". | Datamängd (6,0 MB vid 500, mål ≤ 0,5 MB) och heaptopp (mål ≤ 30 MB) ej uppfyllda – kräver kompaktare listkontrakt. JIT av ej mätt på andra frågor än portföljens (omatchning, inserts) |
| Fas 3 steg 4 | 2026-11-22 | `claude/skalning-fas0` / `ebf7da8`, driftsatt 2026-11-22 17:48 UTC | `buildOverviewVM` (dator): 145 → 30 ms vid 500, 289 → 56 ms vid 1000. Listan över nätet med gzip: 337 KB vid 500 (demo) – målet 0,5 MB nått utan nytt format. | Mobilens tid för vymodellen (bara dator mätt); listans okomprimerade storlek (6,0 MB vid 500) och minnet i webbläsaren är oförändrade |
| Fas 2 steg 1 | 2026-11-22 | `claude/skalning-fas0` / `8138410`, driftsatt 2026-11-22 18:32 UTC | Flödet vid 500 (testdatabas, länsvarning över 320 + Krisinformation över 500): 1 kort med "30 berörda" → 30 kort, Krisinformation med 500, länsvarningen med 320, trafiken kvar. Menyns larmräknare i demo vid 500: 625 → 126. | Flödet blir 848 rader (~0,5 MB okomprimerat) vid två stora händelser; nyckeltalet "Aktiva larm" räknar fortfarande varning × fastighet |
| Fas 2 steg 2 | 2026-11-22 | `claude/skalning-fas0` / `3d22f6f`, driftsatt 2026-11-22 19:32 UTC | Kvittera en varning över 500 fastigheter (demo): 500 klick, spärr efter 60 → 1 klick, ett anrop. Riktig PostgreSQL: 300 rader i en sats, 300 historikrader. | "Ångra" efter "Kvittera alla" finns bara tills sidan lämnas (sedan per rad på kvitteringssidan); kvitteringssidan visar 30 rader åt gången (steg 4) |
| Fas 2 steg 3 | 2026-11-22 | `claude/skalning-fas0` / `dbf4306`, driftsatt 2026-11-22 19:47 UTC | Händelse över 500 fastigheter (demo): en rad per fastighet i flödet → en egen sida med texten en gång, karta, sök och "Kvittera alla". Grupperat SMS: länk till första fastigheten → till händelsesidan. | SMS skickas fortfarande simulerat, så länken i ett riktigt SMS är bara testad via förhandsvisningen; kartans rubrik säger "Portföljkarta" även på händelsesidan |
| Fas 2 steg 4 | 2026-11-22 | `claude/skalning-fas0` / `62ab6b9` + `24b2146`, driftsatt 2026-11-23 07:56 UTC | Kvitteringsrapport för 3 000 kvitteringar (10 händelser à 300): fullständig 113 s / 2,1 MB i huvudtråden → 0,9 s / 388 KB i en Web Worker; hämtning 100 anrop à 30 → 1 anrop. CSV och sökbart fastighetsfilter. | Kvitteringssidans lista på skärmen är fortfarande en rad per fastighet; PDF i workern bara provad i Chromium (webbläsarpanelen) |
| Fas 5 steg 1–4 | 2026-11-23 | `claude/skalning-fas0` | Riktig PostgreSQL, 300 fastigheter: samlat SMS vid full minut och 5 fastigheter vid tak spärrat för alla → köat för 295; VMA efter dagstaken spärrat → köat; VMA skickas före tidigare orange varning. | Tak per prisnivå; riktiga SMS (allt mätt i simulering) |

