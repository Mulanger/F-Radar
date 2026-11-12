# FastighetsRadar — komplett implementationsplan

**Version:** 1.1 (Geoapify + Trafikverket)  
**Dokumentdatum:** 2026-11-12  
**Språk i produkten:** Svenska (sv-SE)  
**Avsedd mottagare:** AI-programmeringsagenter, teknisk projektledare och framtida utvecklare  
**Produkt:** Webbaserad, fleranvändar-/flerkunds-SaaS för adressbaserad bevakning av svensk offentlig data och personligt konfigurerade SMS-varningar.

> **Läs detta först:** Implementera den **redan skapade designen**. Detta dokument ersätter inte existerande Figma-/designagent-leveranser, komponenter, animationer eller assets. Kartlägg befintlig kod innan du skapar nya komponenter. Inga påhittade API-svar, mätvärden, 'realtidsdata' eller fastighetsspecifika riskbedömningar får presenteras som verkliga.
>
> **API-status:** Dokumentation och källhänvisningar kontrollerade per 2026-11-12, inklusive Geoapify och Trafikverkets registreringsflöden. Varje adapter måste dessutom göra ett verkligt *smoketest* mot källan under implementation. Kontrollerat dokumentationsläge är inte samma sak som garanterad drifttillgänglighet.

---

## 0. Uppdraget till AI-utvecklarna

Bygg FastighetsRadar som en **produktionsförberedd, modulär data- och notifieringsplattform** med följande beteende:

1. En kund registrerar konto och organisation.
2. Kunden lägger till en eller flera fastigheter genom adress och verifierad kartposition.
3. Systemet bygger automatiskt en **dataprofil per fastighet** genom att geografiskt matcha öppna svenska datakällor.
4. Kunden ser **Portfolio Overview** (samlad vy) och **Property Detail** (en fastighets mätningar och bevakningar).
5. Vyerna uppdateras när backend har hämtat och bearbetat **nya källvärden eller händelser**. Klientuppdatering kan ske via SSE; detta gör inte en långsamt uppdaterad källa till realtid.
6. Kunden aktiverar egna SMS-regler för valda datatyper, fastigheter, nivåer och tidsfönster.
7. Systemet skickar relevanta aviseringar **högst enligt användarens regler och kostnads-/missbruksspärrar**.
8. Nyckelkrävande källor ska kunna anslutas senare via `.env`, utan att övriga tjänsten går sönder.
9. Systemet sparar **endast nödvändig kundkonfiguration och begränsade tekniska loggar**; det är *inte* ett ärende-/underhålls- eller historiksystem.
10. Källor, uppdateringstid, geografisk precision och datakvalitet måste alltid vara synliga.

### Funktionellt scope

**Ingår:** konto, organisation, adresser/koordinater, automatisk geoprofil, portföljkarta, externa mätvärden, tidsserier för aktuella prognoser, offentliga varningar, status/coverage, valbara SMS-regler, kort händelseflöde, robust datainsamling och tillförlitlig drift.

**Ingår inte:** energimätare, IoT-sensorer, felanmälningar, förvaltning av arbetsuppgifter, egen byggnadsdrift, skadeärenden, försäkringsrådgivning, långvarigt kunddokumentarkiv, betalningar i första driftsättningen eller autonoma beslut om säkerhetsåtgärder.

**Beslut 2026-11-12:** Använd **Geoapify** för svensk adressautocomplete/koordinater (egen gratis API-nyckel), **Trafikverkets öppna API** för trafikhändelser efter gratis privatregistrering/API-nyckel; **Lantmäteriet är valfritt** och får inte blockera MVP eller lansering.

**Grundprincip:** Bred API-täckning är målet. Leverera genom **självständiga adapters med verifierade datakontrakt och feature flags**, inte genom att hårdkoda fiktiva uppgifter för att fylla varje kort i UI.

---

## 1. Produktprinciper som inte får kompromissas

- **Kunddata separerad per organisation (multi-tenant).** Inga data får läcka mellan kunder.
- **Offentlig källa är sanningskälla:** ge källnamn, originallänk, `source_updated_at`, `fetched_at`, geografisk matchningsmetod och datastatus.
- **Saknade data = okänt**, aldrig implicit ”normalt”, 0 eller ”ingen risk”.
- **Prognos ≠ observation**; **officiell varning ≠ egen genererad tröskelvarning**; **kartlagd exponering ≠ nära förestående händelse**.
- **Mätvärden ≠ byggnadens inomhusvärden.** Temperatur på dashboarden betyder väder vid den geografiska positionen, inte temperatur inne i huset.
- **Ändamålsanpassad lagring.** Bevara endast aktuella prognoser, nödvändiga korttidsloggar och kundens egna inställningar enligt dokumenterad gallringspolicy.
- **Ingen offentlig-API-proxy i webbläsaren:** backend ansvarar för källanrop, caching, normalisering, throttling och secrets.
- **Inga verkliga SMS i testmiljö** som standard. Endast explicit godkänd aktivering får skicka skarpa SMS.
- **Källor utan åtkomst/avtal ska inte simuleras som aktiva.** Markera `disabled`, `pending_access` eller `unsupported`.
- **Den befintliga visuella designen är primär designkälla.** Behåll 3D-fastigheter, vattenrörelser, kort, instrument, övergångar och typografi inom prestanda- och tillgänglighetskrav.

---

## 2. Avsedd användarresa

### 2.1 Registrering och onboarding

1. `Sign up` → konto med verifierad e-post, accepterade villkor och integritetsinformation.
2. Skapa organisation (`organization_name`). En person kan senare tillhöra flera organisationer.
3. Ange fastighetens namn och adress. Använd **Geoapify Address Autocomplete** som primär geokodare (`GEOCODING_PROVIDER=geoapify`) när giltig API-nyckel finns. Om nyckeln saknas: visa manuell adress + kartpinne med tydlig markering att automatisk adressverifiering är avstängd.
4. Visa träffens adress, kommun (om levererad), koordinater och karta. Kräv användarens bekräftelse av rätt plats. Acceptera inte enbart stad/postnummer som en verifierad byggnadspunkt; låg säkerhet, saknat husnummer eller tvetydig träff ska leda till manuell justering.
5. Spara `property` + `Point(lon lat)`; börja asynkron profileringsprocess. Status `profiling` tills nödvändiga kontroller är utförda.
6. Resultatet kan vara partiellt: visa klara datapunkter direkt, övriga som `Loading`, `No coverage`, `Requires access`, `Unavailable` eller `Stale`.
7. Be användaren att frivilligt aktivera SMS: verifiera mobilnummer, välj fastigheter och varningstyper, gränsvärden, tysta timmar och max antal utskick.
8. Landning på Portfolio Overview med nästa steg och tydlig kontroll av datakällors status.

### 2.2 Vardagsanvändning

- Användaren öppnar portföljen, ser aktuell status och varningsfördelning.
- Väljer en byggnad från lista, karta eller fastighetsväljare.
- Ser miljöinstrument, varningar, omgivningshändelser och metod-/källinformation.
- Ändrar SMS-regler per fastighet eller för hela portföljen.
- Ser en **kort teknisk aktivitetslogg**, inte en permanent fastighetsjournal.

---

## 3. Datakällor och åtkomstmatris

**Adapterstatus vid uppstart:** `enabled_without_key`, `requires_key`, `requires_approval`, `licensed_review`, `coverage_limited`, `disabled`. Implementationsordningen påverkar inte slutmålet att inkludera samtliga relevanta källor.

| ID | Datakälla | Avsett innehåll | Åtkomst | Kommentar / villkor |
|---|---|---|---|---|
| `smhi_forecast` | SMHI SNOW1gv1 | Temperatur, vind, byvind, luftfuktighet, nederbörd, sannolikheter | Publikt | Modellprognoser för plats; använd **SNOW1gv1**, inte avvecklade PMP3gv2. |
| `smhi_warnings` | SMHI IBWW | Officiella vädervarningar och geometrisk/administrativ utbredning | Publikt | Särskilda villkor: korrekt attribution och oförändrad presentation av officiellt varningsinnehåll. |
| `smhi_observations` | SMHI MetObs | Mätvärden från väderstationer | Publikt | Stationer kan vara långt från fastighet; redovisa stationsavstånd och observationstid. |
| `krisinformation` | Krisinformation v3 | Geotaggade nyheter och samhällsinformation | Publikt | Använd **v3** (v2 avvecklades 2026-09); publicerat område kan vara län snarare än exakt plats. |
| `air_quality` | Naturvårdsverket/SMHI datavärd luft | Mätvärden PM2.5/PM10, NO2, ozon m.m. där stationer finns | Publikt REST/SOS | Realtidsdata kan vara preliminära och geografiskt glest fördelade. |
| `sgu_groundwater` | SGU OGC API Features | Observerade nivåer och regionalt beräknat grundvattenläge | Publikt | Regional 4×4 km HYPE-modell får inte tolkas som lokal källarmätning. |
| `mcf_flood` | MCF Översvämningsportalen | GIS-skikt, scenarier och exponering | Öppna kart-/nedladdningsskikt | **Statiska scenarier**, inte dagsaktuell vattennivå. Täckning varierar. |
| `scb` | SCB PxWebApi v2 | Kommun-/områdesstatistik | Publikt | Enbart kontextdata; sällan meningsfullt med SMS för statistiken. |
| `trafikverket` | Trafikverket öppna API för trafikinformation | Väghändelser, hinder, arbeten | **Gratis registrering + API-nyckel**, även privatperson | Inget organisationsnummer krävs för vanlig API-registrering; bevaka begränsningar/kvoter och matcha enbart geografiskt relevanta händelser. |
| `geoapify_geocoding` | Geoapify Address Autocomplete + Geocoding | Svensk adressökning, adressförslag, WGS84-koordinater | **Gratis konto + API-nyckel** | **Primär adressleverantör**. Inte officiella fastighetsgränser/register-ID. Avgiftsfri plan har 3 000 krediter/dag, som delas med övrig Geoapify-användning. |
| `lantmateriet_address` | Lantmäteriet Referens Uppslag Adress v3 | Officiellt adress-/registerenhetsuppslag | Organisationsbehörighet + juridisk prövning | **Valfritt och avstängt**. Ingen blockerare för onboarding; överväg senare för officiella registerreferenser. |
| `boverket_energy` | Boverket Energideklaration | Energiklass, energiprestanda och deklarationsdatum | Avtal + användningsbegränsningar | **AVSTÄNGT** för SaaS-kundvisning tills användningen uttryckligen är godkänd. |
| `sms_46elks` | 46elks | Utgående SMS | API-användare/lösenord | Betald tjänst. `dryrun` under utveckling. |

### 3.1 Bekräftade adresser och dokumentation

| Adapter | Verifierad ingångspunkt eller dokumentation |
|---|---|
| SMHI prognos | `https://opendata.smhi.se/metfcst/snow1gv1/` |
| SMHI prognos test (punkt) | `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/16/lat/58/data.json?timeseries=4&parameters=air_temperature,wind_speed` |
| SMHI parametrar | `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/parameter.json` |
| SMHI varningar | `https://opendata-download-warnings.smhi.se/ibww/api/version/1/warning.json` |
| SMHI varningsmetadata | `https://opendata-download-warnings.smhi.se/ibww/api/version/1/metadata.json` |
| SMHI MetObs | `https://opendata-download-metobs.smhi.se/api/version/latest.json` |
| Krisinformation v3 | `https://api.krisinformation.se/v3/news?format=json&allcounties=true` |
| Krisinformation dokumentation | `https://www.krisinformation.se/om-krisinformation.se/oppen-data/` |
| Luftdata REST | `https://datavardluft.smhi.se/52North/api/` |
| Luftdata dokumentation | `https://www.naturvardsverket.se/amnesomraden/luft/statistik--utslapp-och-halter/luftkvaliteten-i-realtid-och-preliminar-statistik/webbtjanster-luftkvalitetsdata/` |
| SGU observerat grundvatten | `https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1/collections` |
| SGU regionalt grundvatten | `https://api.sgu.se/oppnadata/grundvattennivaer-sgu-hype-omraden/ogc/features/v1/collections` |
| MCF riskkartor | `https://www.mcf.se/sv/verktyg--tjanster/oversvamningsportalen/` |
| SCB PxWeb v2 | `https://statistikdatabasen.scb.se/` (Swagger: `/swagger/v2/swagger.json`) |
| Trafikverket information | `https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/` |
| Trafikverket registrering | `https://data.trafikverket.se/oauth2/Account/register` |
| Trafikverket kom igång | `https://data.trafikverket.se/get-started` |
| Geoapify Address Autocomplete API | `https://api.geoapify.com/v1/geocode/autocomplete` (GET, kräver `apiKey`; använd `text`, `filter=countrycode:se`, `lang=sv`, `format=json`) |
| Geoapify Geocoding API | `https://api.geoapify.com/v1/geocode/search` (GET, kräver `apiKey`) |
| Geoapify MyProjects | `https://myprojects.geoapify.com/` |
| Geoapify prislista | `https://www.geoapify.com/pricing/` |
| Lantmäteriet v3 | `https://api.lantmateriet.se/distribution/produkter/uppslag/adress/v3` (kräver åtkomst) |
| Boverket | `https://www.boverket.se/sv/om-boverket/oppna-data/publikt-api-for-energideklarationer/` |
| 46elks SMS | `https://api.46elks.com/a1/sms` (POST, HTTP Basic Auth) |

**VIKTIGT:** Flera adresser ovan är **API-roter, kataloger eller dokumentationsingångar**, inte direkta anrop som returnerar alla fält. Implementera inte endpoints som ni inte hämtat från dokumentationen eller bekräftat med lyckade tester. Trafikverkets aktuella requestformat/API-nyckelhantering, Lantmäteriets auth-flöde, SCB:s tabell-ID:n och MCF:s specifika GIS-lager måste identifieras i respektive implementations-PR.

### 3.2 Geoapify och Trafikverket – registrering, kostnad och ansvar

**Geoapify (primär adressökning):**

1. Gå till https://myprojects.geoapify.com/ och skapa ett gratis konto.
2. Skapa ett projekt; under **API Keys** finns en projektknuten nyckel som kan kopieras.
3. Lägg nyckeln i projektets **serversidiga** `.env` som `GEOAPIFY_API_KEY`. Sätt `GEOCODING_PROVIDER=geoapify`.
4. Spärra nyckeln efter relevant miljö: API-anrop från backend med IP-begränsning om infrastrukturen medger stabil egress-IP; eventuell *separat* browsernyckel med HTTP-referrer/origin-begränsning. Dela inte obegränsad servernyckel publikt.
5. Börja med Address Autocomplete. Använd `filter=countrycode:se`, `lang=sv`, `limit=5`, `format=json`, klient-debounce och serverbaserad rate limit.
6. Visa alltid förslag och låt kunden bekräfta pinnen på kartan. Lagra **bekräftad** adress/koordinat och intern geokodningsmetadata enligt leverantörens aktuella villkor; undvik onödigt upprepade geokodningar vid varje dashboardbesök.
7. Gratisplanen erbjuder **3 000 krediter/dygn**, högst **5 anrop/s** och kräver inget kreditkort enligt publicerad prislista 2026-11-12. En autocomplete- eller forward-geocoding-förfrågan kostar normalt **1 kredit**. Tänk på att karttiles och andra Geoapify-API:er förbrukar samma kvot. Begränsningarna och priserna måste kontrolleras vid produktionssättning.
8. Följ aktuell attribution för datakälla och kartor. Använd inte Geoapify som källa till officiell fastighetsbeteckning eller fastighetsgräns.

**Trafikverket (valfritt tills nyckeln finns):**

1. Öppna https://data.trafikverket.se/oauth2/Account/register eller börja via https://data.trafikverket.se/get-started.
2. Registrera dig med e-postadress, visningsnamn och lösenord; acceptera API-licens/avtal och **verifiera e-post**.
3. Logga in i Datautbytesportalen och skapa/hämta en API-nyckel enligt det aktuella kontogränssnittet/kom-igång-guiden. Exakta menybenämningar kan ändras.
4. Sätt `TRAFIKVERKET_API_KEY=<erhållen nyckel>` på backend och därefter `TRAFIKVERKET_ENABLED=true`; tills dess ska integrationen vara `pending_access`.
5. Både privatpersoner och företag får registrera sig för Trafikverkets öppna trafikinformations-API. **Organisationsnummer är inte ett krav för detta konto.** Informationen är CC0-licensierad, men följ dokumenterade anropsgränser och övervaka er trafik.
6. Börja med dokumenterade väghändelse-/trafikstörningsobjekt (t.ex. `Situation` där API-versionen stöder det). Välj datamodell och filter ur **nuvarande** dokumentation och verifiera ett riktigt anrop innan driftsättning. Fånga inte alla händelser i landet per fastighet.

**Ägarens faktiska status:** Har konton/nycklar inte fyllts i är de **inte klara**, även om en registreringsguide finns. AI-agenterna får inte anta att registrering eller godkännande har skett.

### 3.3 Source/license manifest (obligatoriskt)

Skapa `docs/sources.md` och `packages/integrations/src/sources/manifest.ts` med en post per källa:

```ts
export type AccessStatus =
  | 'public'
  | 'requires_key'
  | 'requires_approval'
  | 'legal_review'
  | 'disabled';

export interface SourceManifest {
  id: string;
  authority: string;
  docsUrl: string;
  access: AccessStatus;
  licenseUrl?: string;
  commercialReuseReviewed: boolean;
  attributionText: string;
  dataKind: 'forecast' | 'observation' | 'warning' | 'event' | 'static' | 'statistics';
  geographicPrecision: 'point_grid' | 'station' | 'polygon' | 'municipality' | 'county' | 'national' | 'mixed';
  coverageNote: string;
  updatePolicy: string; // confirmed cadence or "unknown"
  retentionPolicy: string;
  displayPermitted: boolean;
  alertsPermitted: boolean;
  reviewedAt: string;
}
```

Alla källor behöver licens-/villkorskontroll **före publik exponering**; använd `displayPermitted=false` tills eventuella oklarheter är lösta. Även källor utan API-nyckel kan ha licens- och attributkrav.

---

## 4. Rekommenderad teknik och systemarkitektur

### 4.1 Stack

- **Monorepo:** `pnpm` workspaces + Turborepo eller motsvarande.
- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui eller redan vald designstack.
- **3D:** React Three Fiber / Three.js + Drei, endast där det gör visuell nytta; fallback till statisk rendering.
- **Karta:** MapLibre GL JS med lagligt lämplig kart-/tile-leverantör eller egen tile-drift.
- **API:** Fastify + TypeScript, schema-/DTO-validering med Zod, genererat OpenAPI.
- **Databas:** PostgreSQL med PostGIS.
- **Databaslager:** Drizzle eller Prisma om PostGIS-behovet hanteras korrekt; använd rå SQL för spatiala frågor där ORM inte räcker.
- **Bakgrundsjobb:** Redis + BullMQ (dedikerade workers).
- **Liveklient:** Server-Sent Events (SSE) från API-gateway, med återanslutning och snapshot-refetch.
- **Auth:** Etablerad, underhållen auth-lösning med organisationsmedlemskap och serverbaserad behörighetskontroll.
- **SMS:** 46elks server-side adapter.
- **Observability:** strukturerade loggar, error tracking, metrics och health checks.
- **Test:** Vitest, Playwright, Testcontainers/Postgres samt kontraktstester för tredjeparts-API:er.

**Undvik för tidig mikrotjänstuppdelning.** Separata deploybara roller för `web`, `api` och `worker` räcker, med delat domän-/integrationsbibliotek.

### 4.2 Dataflöde

```text
[Offentliga API:er & GIS-skikt]
                  |
                  v
      [Schemalagda Data Collectors]
         | schema validation
         | retry, throttle, source status
         v
       [Normaliserade datapunkter]
           |              |
           v              v
 [Aktuell käll-cache]  [Geo-matchning]
           |              |
           +------> [Event / Rule Engine]
                           |
             +-------------+----------------+
             |                              |
             v                              v
       [Portfolio API]              [SMS Queue / 46elks]
             |                              |
       [SSE / REST]                [Delivery log, cooldown]
             |
       [FastighetsRadar UI]
```

**Viktigt:** Datainsamling är **gemensam för alla kunder** när källan tillåter detta. Exempelvis laddas officiella SMHI-varningar en gång centralt och matchas sedan mot alla relevanta fastigheter. Prognosfrågor grupperas/cachas efter källans grid, koordinat eller annan lämplig upplösning. Anropa inte samma externa API separat per webbläsarsession.

---

## 5. Föreslagen projektstruktur

```text
fastighetsradar/
├── IMPLEMENTATION.md                    # detta dokument
├── .env.example
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── docker-compose.yml
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (auth)/sign-in/
│   │   │   ├── (auth)/sign-up/
│   │   │   ├── (dashboard)/overview/
│   │   │   └── (dashboard)/properties/[propertyId]/
│   │   ├── components/
│   │   │   ├── dashboard/
│   │   │   ├── gauges/
│   │   │   ├── properties/
│   │   │   ├── three/
│   │   │   └── maps/
│   │   └── lib/api/
│   ├── api/
│   │   └── src/
│   │       ├── routes/
│   │       ├── modules/
│   │       ├── auth/
│   │       ├── security/
│   │       └── sse/
│   └── worker/
│       └── src/
│           ├── schedulers/
│           ├── collectors/
│           ├── processors/
│           └── queues/
├── packages/
│   ├── config/
│   ├── db/
│   │   ├── migrations/
│   │   └── schema/
│   ├── domain/
│   ├── integrations/
│   │   └── src/
│   │       ├── sources/
│   │       ├── smhi/
│   │       ├── krisinformation/
│   │       ├── air-quality/
│   │       ├── sgu/
│   │       ├── mcf/
│   │       ├── scb/
│   │       ├── trafikverket/
│   │       ├── geoapify/
│   │       ├── lantmateriet/
│   │       ├── boverket/
│   │       └── sms/
│   ├── alerts/
│   ├── geo/
│   └── ui/
├── docs/
│   ├── sources.md
│   ├── decisions/
│   ├── api-contracts/
│   ├── operations.md
│   ├── privacy.md
│   └── data-dictionary.md
└── tests/
    ├── fixtures/
    ├── integration/
    └── e2e/
```

Om repo redan har en bra struktur: **anpassa planen till den**, inte tvärtom. Skapa inte dubbletter av samma UI eller routing.

---

## 6. Miljövariabler och hantering av secrets

Skapa `.env.example` enligt nedan och **aldrig** checka in riktiga värden i `.env`.

```dotenv
# === APP ===
NODE_ENV=development
APP_URL=http://localhost:3000
API_PORT=4000
TZ=Europe/Stockholm
LOG_LEVEL=info

# === DATABASE / QUEUES ===
DATABASE_URL=postgresql://fastighetsradar:local_dev_password@localhost:5432/fastighetsradar
REDIS_URL=redis://localhost:6379

# === AUTH: choose ONE maintained provider/framework ===
AUTH_SECRET=
AUTH_PROVIDER=
AUTH_PROVIDER_CLIENT_ID=
AUTH_PROVIDER_CLIENT_SECRET=

# === GEOCODING & MAP ===
# Standard när nyckel finns; annars manuell pin-fallback utan automatisk adressverifiering.
GEOCODING_PROVIDER=geoapify
GEOAPIFY_API_KEY=
GEOAPIFY_AUTOCOMPLETE_URL=https://api.geoapify.com/v1/geocode/autocomplete
GEOAPIFY_GEOCODING_URL=https://api.geoapify.com/v1/geocode/search
GEOAPIFY_COUNTRY_FILTER=se
GEOAPIFY_LANGUAGE=sv
# Kartleverantör beslutas separat; Geoapify-nyckeln är inte automatiskt en publik tile-nyckel.
MAP_STYLE_URL=
NEXT_PUBLIC_MAP_STYLE_URL=

# === VERIFIED PUBLIC SOURCE ENTRYPOINTS ===
SMHI_FORECAST_BASE_URL=https://opendata-download-metfcst.smhi.se/api
SMHI_WARNINGS_URL=https://opendata-download-warnings.smhi.se/ibww/api/version/1/warning.json
SMHI_OBSERVATIONS_BASE_URL=https://opendata-download-metobs.smhi.se/api
KRISINFORMATION_BASE_URL=https://api.krisinformation.se/v3
AIR_QUALITY_BASE_URL=https://datavardluft.smhi.se/52North/api/
SGU_OBSERVED_GROUNDWATER_BASE_URL=https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1
SGU_REGIONAL_GROUNDWATER_BASE_URL=https://api.sgu.se/oppnadata/grundvattennivaer-sgu-hype-omraden/ogc/features/v1
SCB_PXWEB_V2_BASE_URL=https://statistikdatabasen.scb.se

# MCF uses selected verified GIS datasets; no invented single catch-all endpoint
MCF_FLOOD_ENABLED=false
MCF_GIS_DATASET_MANIFEST=

# === SOURCES THAT REQUIRE REGISTRATION / APPROVAL ===
# Registrera privat- eller företagskonto: https://data.trafikverket.se/oauth2/Account/register
# Nyckeln aktiverar trafikhändelser, inte Geoapifys geokodning.
TRAFIKVERKET_ENABLED=false
TRAFIKVERKET_API_KEY=
LANTMATERIET_ENABLED=false
LANTMATERIET_AUTH_METHOD=
LANTMATERIET_CLIENT_ID=
LANTMATERIET_CLIENT_SECRET=
BOVERKET_ENABLED=false
BOVERKET_API_KEY=

# === SMS / 46ELKS ===
SMS_ENABLED=false
SMS_DRY_RUN=true
SMS_TEST_ALLOWLIST=
SMS_SENDER=FastRadar
ELKS_API_USERNAME=
ELKS_API_PASSWORD=
SMS_DAILY_LIMIT_PER_ORG=20
SMS_MONTHLY_LIMIT_PER_ORG=100
SMS_GLOBAL_DAILY_BUDGET_SEK=100

# === SOURCE CONTROL FLAGS ===
SOURCE_SMHI_FORECAST_ENABLED=true
SOURCE_SMHI_WARNINGS_ENABLED=true
SOURCE_SMHI_OBSERVATIONS_ENABLED=true
SOURCE_KRISINFORMATION_ENABLED=true
SOURCE_AIR_QUALITY_ENABLED=true
SOURCE_SGU_ENABLED=true
SOURCE_SCB_ENABLED=true
```

**OBS:** Endast variabler som faktiskt används ska finnas i `.env` i drift. Håll separat `development`, `staging` och `production`. Konfigurera i secrets manager i produktion. `SMS_DRY_RUN` måste förbli `true` tills ägaren uttryckligen godkänner skarpa utskick. `SMS_SENDER` måste kontrolleras mot leverantörens avsändarregler.

**Ägarens externa att-göra:**

- [ ] Skapa 46elks-konto och samla in API-användare/lösenord.
- [ ] Skapa gratisprojekt i Geoapify MyProjects, kopiera API-nyckel till `GEOAPIFY_API_KEY` och bekräfta kommersiella villkor/attribution.
- [ ] Registrera Trafikverket-konto som privatperson via registreringssidan (organisationsnummer krävs inte), acceptera licens, verifiera e-post och hämta API-nyckel till `TRAFIKVERKET_API_KEY`.
- [ ] Välj karttile-leverantör separat, kontrollera kommersiella villkor och kvot/kostnad för kartvisningar.
- [ ] Lantmäteriet är **valfritt**; ansök först om behov finns av officiella registeruppgifter och när förutsättningarna för organisationskonto/juridisk prövning är uppfyllda.
- [ ] Be Boverket om uttryckligt besked om användning i kundriktad SaaS, annars håll avstängt.
- [ ] Godkänn integritetspolicy, SMS-villkor, retention och incidentrutiner inför publik drift.

**Blockera inte övrig utveckling** när en nyckel saknas. Adapter ska markeras med `pending_access`, UI med korrekt status och tester med fixtures.

---

## 7. Domänmodell och databas

### 7.1 Kärntabeller

| Tabell | Syfte | Centrala fält |
|---|---|---|
| `users` | Inloggade personer | `id`, `email`, `created_at` |
| `organizations` | Kundkonton/tenants | `id`, `name`, `created_at` |
| `organization_members` | Roller och åtkomst | `organization_id`, `user_id`, `role` (`owner`,`admin`,`viewer`) |
| `properties` | Kundernas platser | `id`, `organization_id`, `name`, `address`, `municipality`, `county_code`, `location geography(Point,4326)`, `geocode_confidence`, `verified_at`, `status` |
| `property_source_profiles` | Matchning per källa | `property_id`, `source_id`, `coverage_status`, `match_method`, `match_distance_m`, `last_checked_at`, `error_code` |
| `source_catalog` | Godkända datakällor | `id`, `license_reviewed`, `enabled`, `attribution`, `source_updated_at`, `last_success_at`, `last_error_at` |
| `current_measurements` | Senaste normaliserade värden | `property_id`, `metric_key`, `value_numeric`, `value_text`, `unit`, `data_kind`, `valid_at`, `forecast_target_at`, `observed_at`, `source_id`, `quality_status`, `expires_at` |
| `forecast_points` | Begränsad aktuell prognosserie | `property_id`/`grid_key`, `metric_key`, `target_at`, `value`, `unit`, `issued_at`, `expires_at` |
| `source_events` | Aktiva externa varningar/händelser | `id`, `source_id`, `external_id`, `event_type`, `severity`, `title`, `source_url`, `valid_from`, `valid_to`, `geometry`, `updated_at` |
| `property_events` | Geo-matchade händelser | `property_id`, `source_event_id`, `match_method`, `active`, `created_at`, `expires_at` |
| `alert_rules` | Kundvalda regler | `id`, `organization_id`, `property_id?`, `metric_key`, `operator`, `threshold`, `time_window`, `channels`, `enabled`, `cooldown_minutes`, `quiet_hours` |
| `alert_state` | Händelse-/regelstatus | `rule_id`, `property_id`, `last_state`, `last_triggered_at`, `last_fingerprint`, `last_cleared_at` |
| `phone_verifications` | Verifierade mottagare | `user_id`, `phone_e164_encrypted`, `verified_at`, `verification_state` |
| `sms_deliveries` | Kort teknisk leveranslogg | `id`, `organization_id`, `rule_id`, `recipient_hash`, `event_fingerprint`, `provider_id`, `status`, `parts`, `cost`, `created_at`, `expires_at` |
| `integration_runs` | Källa/worker-hälsa | `source_id`, `started_at`, `finished_at`, `status`, `items`, `error_code` |

Separera generella externa händelser från kundernas interna matchningar. Förfrågan om en portfölj ska **alltid** filtreras på tillåten `organization_id` från serververifierad session, aldrig från ett okontrollerat client-påstående.

### 7.2 Geodataindex och constraints

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Exempel; anpassa till valda migrationer och färdigt schema.
CREATE INDEX idx_properties_org ON properties (organization_id);
CREATE INDEX idx_properties_location ON properties USING GIST (location);
CREATE INDEX idx_source_events_geometry ON source_events USING GIST (geometry);
CREATE INDEX idx_property_events_property ON property_events (property_id, active);
CREATE UNIQUE INDEX idx_alert_state_unique ON alert_state (rule_id, property_id);
```

Använd `geometry`/`geography` konsekvent och dokumentera CRS. Indata i WGS84 (`EPSG:4326`, lon/lat), eventuellt `EPSG:3006` för svenska GIS-skikt efter säker transformation. Kontrollera lon/lat-ordningen i tester.

### 7.3 Dataminimering / initial retention (förslag, juridiskt beslut krävs)

| Data | Förslag | Syfte |
|---|---|---|
| Konton/fastigheter/regler | Så länge kundkontot används | Kärnfunktion |
| Prognoscache | Till den blir inaktuell + kort felsökningsmarginal | Snabb dashboard |
| Historiska mätvärden | Endast begränsat fönster där diagram kräver det | Temporära trender |
| Aktiva externa events | Tills upphörda + kort aktivitetstidslinje | Händelsehantering |
| Dedup-nycklar | Till cooldown-/uppdateringsfönstret passerat | Förhindra dubbletter |
| SMS-leveransloggar | Exempelvis 30 dagar om motiverat | Leveransfel och kostnadskontroll |
| Tekniska loggar | Kort, definierat fönster, redigerade från personuppgifter | Drift/felsökning |

Skriv faktisk policy i `docs/privacy.md`; bygg automatisk gallring, kontoradering och registerutdrag/rättelse. Ta inte dessa tidsperioder som juridiska facit.

---

## 8. Standardiserade datakontrakt

**Varje adapter måste mappa källdata till samma kontrakt** så UI och regler inte behöver känna till varje myndighets datastruktur.

```ts
type DataStatus =
  | 'ok'
  | 'loading'
  | 'no_coverage'
  | 'stale'
  | 'source_unavailable'
  | 'access_required'
  | 'not_applicable'
  | 'unknown';

type DataKind = 'forecast' | 'observation' | 'official_warning' | 'derived_alert' | 'static_exposure' | 'statistics';

type GeoMatch = 'point_grid' | 'polygon_intersection' | 'within_radius' | 'nearest_station' | 'county' | 'municipality' | 'not_matched';

interface DataPoint {
  propertyId: string;
  sourceId: string;
  metricKey: string;                 // exempel: 'weather.air_temperature'
  kind: DataKind;
  status: DataStatus;
  value: number | string | boolean | null;
  unit: string | null;              // t.ex. '°C', 'm/s', 'mm/24h'
  observedAt?: string | null;
  issuedAt?: string | null;
  validAt?: string | null;
  fetchedAt: string;
  expiresAt?: string | null;
  geoMatch: GeoMatch;
  matchedDistanceMeters?: number | null;
  coverageNote?: string;
  attribution: string;
  sourceUrl: string;
  qualityFlags: string[];
}

interface MonitorEvent {
  id: string;
  sourceId: string;
  externalId: string;
  type: string;
  kind: 'official_warning' | 'source_event' | 'derived_alert';
  severity: 'info' | 'monitor' | 'warning' | 'critical' | 'unknown';
  headline: string;
  description?: string;
  sourceUrl: string;
  issuedAt?: string;
  validFrom?: string;
  validTo?: string;
  geometry?: GeoJSON.Geometry;
  countyCodes?: string[];
  qualityFlags: string[];
}
```

#### Obligatoriska regler för normalisering

- Validera **externt svar** (Zod/JSON Schema); kassera eller flagga ogiltiga poster utan att krascha hela källjobbet.
- Respektera `missingValue`, `null`, tomma och okända enheter.
- Konvertera enheter centralt och dokumentera fysiska beräkningar.
- `0` är ett riktigt mätvärde endast om det verkligen rapporterats; skilj från saknad datapunkt.
- All lagring i UTC; UI visar `Europe/Stockholm` med korrekt sommar-/vintertid.
- Separera publiceringstid, prognosens giltighetstid, observationstid och vår egen hämtningstid.
- För geometrisk matchning: bifoga metod och precision. Länsbaserad nyhet får inte beskrivas som ”incident 100 m från fastigheten”.
- Bevara källa/länk utan att hitta på ett eget myndighetsuttalande.
- Alla uppdateringar ska vara idempotenta via källans stabila ID + relevant revisions-/giltighetsinformation.

---

## 9. Implementation av varje datakälla

### 9.1 SMHI prognoser — `smhi_forecast`

**Initiala metriker:**

- `weather.air_temperature` (°C)
- `weather.relative_humidity` (%)
- `weather.wind_speed` (m/s)
- `weather.wind_gust` (m/s)
- `weather.wind_direction` (grader)
- `weather.precipitation` (dokumenterad prognosperiod/enhet)
- `weather.precipitation_probability` (%)
- `weather.thunderstorm_probability` (källa kan rapportera fraktion; konvertera korrekt)
- `weather.cloud_cover` (källa kan rapportera oktas; konvertera inte oreflekterat till procent)
- `weather.symbol_code` (metadata/ikon)

**Plan:**

1. Hämta parameterkatalog från `.../parameter.json` och verifiera nycklar/enheter mot faktiskt svar.
2. Hämta prognos för koordinat via SNOW1gv1-punktendpoint.
3. Spara aktuell prognosserie för valda tidshorisonter och en aggregerad kort sammanfattning.
4. Implementera `next_6h`, `next_12h`, `next_24h`, `next_48h`, där aggregation bara görs enligt källans faktiska intervallsemantik.
5. `mm/24h`: säkerställ att prognosvärden avser icke-överlappande perioder och inte dubbelräknas. Verifiera exempel mot SMHI:s dokumentation.
6. Normalisera till senaste prognoskörning och tidsfönster. Skilj från observerade värden.
7. Cacha per närliggande modellgrid/koordinat med dokumenterad policy; respektera SMHI:s anropsrekommendationer.

**Tester:** minst en punkt i Stockholm, Göteborg, Malmö samt geografiskt utanför modellområdet. Kontrollera bortfall, avrundning och sommartid.

### 9.2 SMHI officiella varningar — `smhi_warnings`

- Hämta `warning.json` samt metadata från version 1 av IBWW.
- Testa med SMHI:s publicerade exempelvarningar när ingen skarp varning finns.
- Matcha geometrier/områdeskoder korrekt mot fastigheter.
- Läs in varningar som separata originalobjekt; hantera uppdaterade, upphävda och utgångna varningar.
- Bevara officiell nivå, tider och källa; skapa separat UI-fält för vår egen sammanfattning om tillåtet, och förvanska aldrig originalvarningens betydelse.
- `No active warnings` visas endast om senaste lyckade hämtning är färsk och geografisk täckning/parsning lyckades.

### 9.3 SMHI observationer — `smhi_observations`

- Hämta katalog över parametrar och stationer.
- Matcha närmaste **relevanta station med färska observationer**, inte enbart närmaste station som råkar finnas på kartan.
- Visa stationsnamn, avstånd, observationstid och datatyp.
- Vissa stationer saknar vissa parametrar; stöd `no_coverage`.
- Håll observationer separata från platsprognoser. Ingen extrapolering till en fastighets exakta väder utan dokumenterad modell.

### 9.4 Krisinformation — `krisinformation`

- Hämta v3-nyheter, t.ex. `/v3/news?format=json&allcounties=true`.
- Läs `Headline`, `Preamble`, `ChangedDate`, `Area`, `Web`, och andra fält efter faktisk respons.
- Matcha via publicerade län/områden när datan inte innehåller exakt geometri.
- Märk objekt som **regional information**, inte exakt lokal incident, om källan bara anger län.
- Skapa `updated`-händelse endast vid relevant revisionsskillnad; deduplicera.
- `crisis`-SMS: valbart, med rimlig försiktighet för generell nyhetsrapportering.

### 9.5 Luftkvalitet — `air_quality`

- Använd Naturvårdsverkets dokumenterade REST-/SOS-tjänst via SMHI:s datavärd.
- Upptäck tillgängliga stationer och föroreningar; verifiera REST-resurser från faktisk tjänst före adapterimplementation.
- Visa PM2.5, PM10, NO₂, ozon där det finns tillräckligt färska data.
- Visa alltid stationsnamn, avstånd, enhet och ”preliminär/ej kvalitetssäkrad” om aktuellt.
- Skapa **inte** nationellt, byggnadsspecifikt AQI eller trafikprognos utan en transparent, dokumenterad beräkningsmetod.
- Alert endast när relevant station täcker området och gränsvärde/aggregation är definierat.

### 9.6 SGU grundvatten — `sgu_groundwater`

- Använd OGC API Features, katalog `collections`.
- **Observerat:** välj station och mättid; visa datum och avstånd.
- **Regionalt beräknat:** matcha fastigheten mot HYPE-område och visa regionalt läge med upplösning/caveat.
- Blanda inte observerade nivåer och regionalt modellindex i samma gauge utan tydliga etiketter.
- SMS om förändring bara vid väldefinierad källa, publicerad uppdatering och stabil klassificering.
- Undvik ord som ”fastighetens grundvattennivå” när data gäller ett större område.

### 9.7 MCF översvämningsdata — `mcf_flood`

- Använd Översvämningsportalens **identifierade GIS-lager**, inte ett antaget generiskt MCF-REST-API.
- Kartlägg skikt per region, scenario, publikationsdatum, licens och koordinatsystem i manifest.
- Ladda ned/importera till PostGIS när det är tillåtet; alternativt använd WMS för visualisering.
- `ST_Intersects` med **verifierad fastighetsgeometri** om sådan finns; om vi bara har adresspunkt måste UI förklara att det är en punktbaserad indikering och kan missa delar av byggnaden/fastigheten.
- Visa scenariotyp (100-årsflöde, 200-årsflöde, högsta flöde etc.) och att det inte är ett aktuellt vattenstånd.
- **Animationer av vatten i designen är dekorativa** om de inte kan knytas till ett faktiskt underlag.
- Skicka normalt inte löpande SMS för oförändrad statisk kartläggning. Eventuell varning endast när ett relevant kartunderlag revideras och användaren aktivt valt detta.

### 9.8 SCB statistik — `scb`

- Använd PxWebApi **v2**; inga nya integrationer mot v1.
- Välj några explicita, relevanta tabeller (exempelvis kommunstatistik) efter kontroll av metadata och uppdateringsfrekvens.
- Visa som kontextpanel, aldrig som realtidsvärde.
- Respektera SCB:s gräns (dokumenterat 30 anrop/10 s per IP och max 150 000 celler per uttag).
- Cacha statistik länge och versionshantera tabell-ID och år. Ingen automatisk SMS-logik utan tydlig nytta.

### 9.9 Geoapify — `geoapify_geocoding` (standard, gratis konto + nyckel)

**Syfte:** Lösa adress → verifierad WGS84-punkt i onboarding. Använd inte som ersättning för officiella fastighetsgränser.

**Förväntat requestformat för förslag (verifiera i smoketest):**

```http
GET https://api.geoapify.com/v1/geocode/autocomplete?text=Sveav%C3%A4gen%2042%2C%20Stockholm&filter=countrycode:se&lang=sv&limit=5&format=json&apiKey=YOUR_API_KEY
```

**Kontrakt:**

- `GET /v1/geocoding/suggestions?q=...` (internt, autentiserat, backend-proxy) → normaliserade förslag `{label, lat, lon, city?, postcode?, street?, housenumber?, confidence?, placeId?}`. Använd `format=json` och mappa dokumenterade fält, hantera saknade fält och schemaändringar.
- `GET /v1/geocoding/resolve?text=...` (intern backend-route) får använda `/v1/geocode/search` vid explicit verifiering, aldrig för varje tangenttryckning.
- Blockera sökningar kortare än 3 tecken; debounce 300–500 ms, avbryt inaktuella begäranden, högst fem förslag, server-rate-limit per konto/IP samt cache för vanliga söksträngar där lagringstillstånd tillåter.
- Filter `countrycode:se`; `lang=sv`. Avvisa resultat utanför Sverige även om leverantören returnerar sådana.
- Kräv att användaren väljer förslag och kontrollerar kartpinnen. Vid frånvarande husnummer eller låg `rank.confidence_building_level`: begär manuell kartbekräftelse och visa flaggan `precision=approximate`. Spara inte sådana resultat som officiellt verifierade adresser.
- Spara bara nödvändiga fält (`formatted`, `lat`, `lon`, `provider=geoapify`, matchningsklass, bekräftelsestatus, tidsstämpel). Egen tenant-guard för att inte exponera fastighetsadresser.
- Om `GEOAPIFY_API_KEY` saknas/fel eller kvot är nådd: returnera `geocoding_unavailable`, låt användaren placera kartpinne manuellt, visa kvalitetsvarning och stäng inte av andra integrationer.
- Observera: Geoapify kan hitta **adresspunkter**, inte garanterat den exakta byggnaden, lantmäteriets fastighetsbeteckning eller registergeometri.
- Kostnadsinstrumentering: mät dagliga förbrukade geokodningsanrop och separata karttiles; gratisplanen 3 000 krediter/dygn är en **total delad budget**.
- Testa autocomplete mot minst en svensk stadsadress, en landsbygdsadress och en tvetydig adress (med hemligheten hämtad från env), men spara aldrig autentiseringsnyckel i testloggar/fixtures.

### 9.10 Trafikverket — `trafikverket` (gratis registrering + nyckel)

- **Registrering:** https://data.trafikverket.se/oauth2/Account/register. Privatpersoner kan registrera sig utan organisationsnummer. Godkänn licens, verifiera e-post och skapa/hämta nyckel efter inloggning.
- **Aktivering:** När `TRAFIKVERKET_ENABLED=true` och nyckel finns: implementera enligt **aktuell officiell API-handledning och datamodell** på https://data.trafikverket.se/get-started.
- Bekräfta att anrop med nyckeln fungerar i integrationstest innan källan får status `ok`; kontrollera `401/403`, `429`, leverantörens datamodell/version och CC0-villkoren.
- Begränsa till väghändelser i relevant radie eller med påvisad påverkan kring adressen.
- Beräkna avstånd på lämpligt CRS; en väghändelse nära byggnaden innebär inte nödvändigtvis blockerad infart.
- Visa `nearby traffic event`, inte ”infarten blockerad” utan ytterligare evidens.
- Deduplicera ändringar och kontrollera källans datalicens och throttling.
- Saknas nyckel: visa `access_required`, krascha inte systemet.

### 9.11 Lantmäteriet — `lantmateriet_address` (valfritt; organisationsbehörighet krävs)

- **Inte en blockerare** för FastighetsRadars adress-onboarding: Geoapify är vår primära geokodare och manuell kartpinne är fallback.
- Efter godkänd behörighet: integrera `Referens Uppslag Adress v3` enligt tilldelat autentiseringsflöde.
- Använd för att komplettera/registermatcha uppgifter, men **inte** som obegränsad publik geokodare utan att rättigheter och täckning kontrollerats.

### 9.12 Boverket — `boverket_energy` (default OFF)

- API kräver avtal. Den publicerade avtalsmallen innehåller begränsningar för spridning till externa parter och nedladdning.
- **Implementera endast ett deaktiverat adaptergränssnitt** tills skriftligt juridiskt klartecken finns för den kundriktade användningen.
- UI: visa inte energiklass eller energiprestanda som ”hämtad data” innan integrationen verkligen är lagligt och tekniskt aktiv.

---

## 10. Geospatial motor och områdesmatchning

Skapa ett gemensamt geobibliotek med:

- Adress + användarbekräftad WGS84-position.
- `point_in_polygon` för varningar och riskzoner.
- `distance_meters` för mätstationer, trafikobjekt och andra punktkällor.
- `county/municipality`-matchning endast mot identifierade officiella områdeskoder.
- CRS-transformering och korrekt geometrivalidering (ogiltiga polygoner, datumlinje, koordinatordning, geometri saknas).
- Per källtyp konfigurerbar `coverage radius` där sådan är sakligt motiverad.
- Egen metadata `match_method`, `uncertainty_note`, `distance_m`, `coverage_status`.

**Ett adresspunktresultat är inte en fullständig fastighetsgräns.** Om det behövs en byggnads-/registergeometri krävs kompletterande tillåten datakälla eller kundens egen verifierade geometri.

**Geo-regler:**

- SMHI prognos: närmaste relevant modellgrid/koordinat enligt källan.
- SMHI varning: fastighetens punkt inne i varningens dokumenterade polygon/område, eller administrativ matchning om källan så kräver.
- MCF: GIS-scenariopolygon, med täckning och scenarioversion.
- SGU: regionrutor eller observerad stationspunkt med korrekt beskrivning.
- Krisinformation: län/källområde; ej fabricerad exakt radie.
- Luft: stationsbaserat med synlig distans och kvalitetsflagga.
- Trafik: källans geografiska objekt och explicit radie där användaren valt detta.

---

## 11. Hämtning, schema och cache

Implementera `CollectorScheduler` per källa:

1. Läs manifest: aktiv, tillåten, avtalsstatus, tillåtet anropsmönster.
2. Beräkna due jobs efter *källa-specifik* frekvens och uppdateringssignal.
3. Hämta med timeout, retries, backoff + jitter och hantering av HTTP 429.
4. Parse + schema validation + normalisering.
5. Upsert med stabil källa/version/objekt-ID; lagra kortlivad cache.
6. Kör geo-matchning, eventdiff och alert evaluation vid **meningsfulla förändringar**.
7. Publicera SSE-event och, vid behov, SMS-jobb.
8. Publicera `last_success_at`, `last_checked_at`, `freshness_status`, `error_code`.

### Initiala operativa intervall (endast designförslag)

| Källa | Initial kontrollpolicy | Anpassning |
|---|---|---|
| SMHI prognos | Var 15–30 min | Ta hänsyn till uppdateringsfrekvens, kvoter och caching. |
| SMHI varningar | Var 5–10 min | Förankra i villkor och faktiska uppdateringar. |
| SMHI observationer | Efter stations-/parameterns rapportfrekvens | Variabel. |
| Krisinformation | Var 10–15 min | Se källans trafikrekommendationer. |
| Luftkvalitet | Ungefär timvis vid relevanta stationer | Beroende av rapportering. |
| SGU | Dagligen/veckovis beroende på dataset | Regionalt inte realtid. |
| MCF | Schemalagd kontroll av versionsändringar | Statiska GIS-lager. |
| SCB | Vid nya statistikpubliceringar / periodiskt | Låg frekvens. |
| Trafikverket | Anpassa till aktuell dokumentation | API-nyckel, kvotstyrning. |

**Dessa är vår interna utgångskonfiguration, inte verifierade krav från myndigheterna.** Bygg `pollingPolicy` som en konfigurerbar del av varje adapter och ändra efter tester.

### Robusthet

- Jobb och event ska tåla omstart utan dubbla SMS eller korrupt state.
- Källor ska kunna ligga nere utan att slå ut inloggning eller dashboard.
- Stale-while-revalidate får användas för UI men gammal data ska märkas tydligt och **inte utlösa nya larm**.
- Larma internt vid utebliven ny data, parsingfel, onormal mängd händelser eller leverantörsändringar.

---

## 12. Event- och SMS-motorn

### 12.1 Eventkategorier

```text
weather.official_warning
weather.rain_forecast_threshold
weather.wind_forecast_threshold
weather.gust_forecast_threshold
weather.temperature_below
weather.temperature_above
weather.thunderstorm_probability
crisis.regional_publication
air_quality.observed_threshold
groundwater.regional_level_change
traffic.nearby_disruption
flood.map_dataset_updated      # ej livevattennivå
```

Varje regel har `source`, `metric`, `operator`, `threshold`, `aggregation_window`, `scope`, `channel`, `severity_filter`, `cooldown`, `quiet_hours`, `enabled`, `recipient` och `notification_budget`.

### 12.2 Exempel på kundregel

```json
{
  "organizationId": "org_example",
  "propertyId": "property_example",
  "source": "smhi_forecast",
  "metricKey": "weather.precipitation_24h",
  "operator": "gte",
  "threshold": 25,
  "unit": "mm",
  "aggregationWindow": "24h",
  "channel": "sms",
  "enabled": true,
  "cooldownMinutes": 360,
  "quietHours": {"enabled": true, "from": "22:00", "to": "07:00", "timezone": "Europe/Stockholm"}
}
```

**Exemplet är vår egen regelmodell.** Enheterna och aggregationerna måste valideras mot SMHI:s källkontrakt innan det finns en skarp alert.

### 12.3 Precis när skickas ett SMS?

**Måste vara deterministiskt och testbart:**

1. Identifiera **nytt/uppdaterat relevant källobjekt** eller en **verifierad tröskelpassage**.
2. Kontrollera datastatus = `ok`, giltighetstid och tillräcklig precision/täckning.
3. Kontrollera att den aktuella organisationen och fastigheten berörs.
4. Kontrollera att kunden har aktiv, uttrycklig SMS-regel och verifierat telefonnummer.
5. Kontrollera att regeln går från `not_triggered` till `triggered`, eller att en **materiell uppdatering** kräver nytt meddelande.
6. Använd hysteresis/återställning för värden kring ett gränsvärde (undvik fladdrande larm).
7. Bilda en idempotent fingerprint, exempelvis `org|property|rule|sourceId|externalId|eventVersion`.
8. Kontrollera atomärt dedup, cooldown, quiet hours och SMS-budget. Ovanligt många händelser kräver rate limit och eventuell sammanfattning.
9. Lägg i SMS-kö med **unik dedup-nyckel**. Retry får inte kunna dubbeldebitera vid timeout mot leverantören utan säker kontroll av skickstatus.
10. Skicka endast om `SMS_ENABLED=true`, `SMS_DRY_RUN=false`, verifierad mottagare och tillåten miljö.
11. Logga provider-ID/status/antal SMS-delar/kostnad, men minimera meddelandetext och mobilnummer i logg.
12. När händelse upphör: uppdatera state. Skicka ett ”upphört”-SMS endast om användaren uttryckligen aktiverat det.

### 12.4 46elks adapter

- POST `https://api.46elks.com/a1/sms` med HTTP Basic Auth, `application/x-www-form-urlencoded`.
- Fält: `from`, `to` (E.164), `message`, valfritt `dryrun=yes`.
- `dryrun=yes` validerar anrop utan verkligt utskick enligt dokumentationen.
- Stöd för flera SMS-delar; beräkna/registrera kostnad per providerrespons. Håll meddelanden korta och undvik onödigt Unicode som kan ge fler SMS-delar.
- Implementera verifiering av mobilnummer och kundens opt-in, avregistrering och rimliga tysta timmar.
- Om leverantören stödjer säkert leveranswebhookflöde: validera autenticitet och deduplicera webhooks.
- Testa alltid i första hand med `SMS_DRY_RUN=true` och senare med godkända testnummer.
- Lagra inte API-lösenord i klienten, loggar eller frontend-bundle.

### 12.5 Exempel på SMS-copy (inte myndighetsoriginal)

```text
FastighetsRadar: Prognosen för [Fastighet] visar minst [X] mm nederbörd
under kommande 24 h. Källa: SMHI. Se detaljer: [kort HTTPS-länk]
```

För officiella vädervarningar: ange källa och länka till oförändrad originalinformation. Märk prognosbaserade tröskelmeddelanden som **FastighetsRadars egna bevakningar**, inte officiella varningar.

---

## 13. Backend-API för vår SaaS

### 13.1 Resursendpoints (förslag)

| Metod | Endpoint | Beteende |
|---|---|---|
| `GET` | `/v1/me` | Aktuell användare/organisation |
| `GET` | `/v1/organizations/current` | Aktuell tenant |
| `GET` | `/v1/geocoding/suggestions?q=...` | Geoapify-adapter, säkrat adressautocomplete; fallback när nyckeln saknas |
| `GET` | `/v1/geocoding/resolve?text=...` | Fördjupad validering efter användarval vid behov, rate-limited |
| `POST` | `/v1/properties` | Lägg till användarbekräftad adress/position |
| `GET` | `/v1/properties` | Lista egna fastigheter |
| `GET` | `/v1/properties/:id` | Egen fastighet och metadata |
| `PATCH` | `/v1/properties/:id` | Namn, adress, positionsbekräftelse |
| `DELETE` | `/v1/properties/:id` | Ta bort fastighet, regler och kundkopplingar |
| `GET` | `/v1/portfolio/summary` | KPI:er över egen portfölj |
| `GET` | `/v1/portfolio/map` | GeoJSON för egna fastigheter och tillåtna lager |
| `GET` | `/v1/portfolio/events` | Aktiva/kortlivade events |
| `GET` | `/v1/properties/:id/measurements` | Aktuella datapunkter och statuses |
| `GET` | `/v1/properties/:id/forecast` | Validerad tidsserie |
| `GET` | `/v1/properties/:id/events` | Matchade källhändelser |
| `GET` | `/v1/properties/:id/coverage` | Källstatus och täckning |
| `GET` | `/v1/alert-rules` | Regler, inklusive portföljregler |
| `POST` | `/v1/alert-rules` | Skapa regel |
| `PATCH` | `/v1/alert-rules/:id` | Redigera/pausa |
| `DELETE` | `/v1/alert-rules/:id` | Ta bort regel |
| `POST` | `/v1/phone/verification/start` | Skicka verifieringskod med budgetskydd |
| `POST` | `/v1/phone/verification/confirm` | Verifiera nummer |
| `GET` | `/v1/notifications/recent` | Kort teknisk händelse-/leveranslista |
| `GET` | `/v1/sources/status` | För kunden relevanta källstatusar |
| `GET` | `/v1/stream` | Autentiserad SSE för tenant |

**API-designkrav:** OpenAPI, request/response-Zod, paginering, filtrering, standardiserade fel, `requestId`, authorization på varje endpoint och rate limiting.

### 13.2 Förväntat dashboard-kontrakt

```json
{
  "propertyId": "p_123",
  "propertyName": "Storgatan 18",
  "status": "monitor",
  "statusReason": "1 aktiv geografiskt relevant SMHI-varning",
  "measurements": [
    {
      "metricKey": "weather.air_temperature",
      "value": 8.2,
      "unit": "°C",
      "dataKind": "forecast",
      "dataStatus": "ok",
      "source": "SMHI",
      "validAt": "2026-11-12T14:00:00Z"
    }
  ],
  "sources": [
    { "id": "smhi_forecast", "status": "ok" },
    { "id": "boverket_energy", "status": "access_required" }
  ]
}
```

Alla siffror och fastigheter i detta JSON-exempel är **syntetiska**, endast för schema/tester. Returnera aldrig exempelvärden från ett skarpt endpoint när upstream saknas.

### 13.3 SSE

- Skicka minimala events: `portfolio.updated`, `property.updated`, `source.status_changed`, `alert.created`, `alert.cleared`.
- Klienten hämtar ny snapshot via REST efter relevant event; strömmen behöver inte innehålla hela kundens dataprofil.
- Autentisera per session/tenant; validera access även vid återanslutning.
- Heartbeat, reconnect, backoff och `Last-Event-ID` eller ersätt med snapshot för förlorade events.
- Ge korrekt fallback till polling om SSE inte stöds av infrastrukturen.

---

## 14. Frontend — följ befintlig design exakt

**Först:** Inspektera repo efter designagentens assets, komponenter och CSS. Gör en komponentinventering och koppla riktiga API-svar till befintliga vyer. Re-designa inte det som redan är godkänt.

### 14.1 Sida 1: Portfolio Overview (`/overview`)

**Obligatoriska visuella block:**

1. Sidomeny och header med FastighetsRadar-branding, sök, användarmeny, notifieringar, ny fastighet.
2. Switcher **”Alla fastigheter”** + snabbval av fastighet.
3. KPI-kort: antal fastigheter, aktiva officiella varningar, fastigheter med aktiva triggers, lokala informationshändelser, aktiva SMS-regler, uppdateringsstatus.
4. Huvudkarta med alla fastigheter, markörer och aktiverade kartlager.
5. Fastighetslista/grid: namn, adress, datatäckning, senast hämtad prognos, varningar/status och klick till detalj.
6. Samlat eventflöde med källa och tidsstämplar.
7. Fördelning av varnings-/datastatus (donut/ring/gauge) — mätbara händelser, inte ett påhittat ”hälsotal”.
8. Prognossammanfattning (kommande nederbörd/vind/temperatur för relevant urval).
9. Tydliga tomlägen, laddningslägen, källfel och `no coverage`.

**KPI-beräkningar:**

- `total_properties`: antal fastigheter för tenant.
- `properties_with_official_warnings`: unika fastigheter med **aktiv och geoverifierad** officiell varning.
- `active_alerts`: aktiva regler/händelser, inte antal historiskt skickade SMS.
- `sources_with_issues`: integrationsfel/stale som påverkar tenant.
- `sms_rules_enabled`: verkligt antal aktiva SMS-regler.
- `portfolio_status`: härledd från aktiva officiella varningar och användartriggers; visa förklaringsbar regel, inte ospecificerad ”property health”.

### 14.2 Sida 2: Property Detail (`/properties/:propertyId`)

**Obligatoriska visuella block:**

1. Breadcrumb **Alla fastigheter → vald fastighet**.
2. Fastighetsväljare för byte utan att gå tillbaka.
3. Fullständig verifierad adress, kommun, position, senast uppdaterat.
4. Stor **3D-fastighetsvisualisering** på plattform med elegant, animerat vatten (dekorativt om inte verkliga vattendata finns), miljöpartiklar och högkvalitativ motion design.
5. Mätinstrument: temperatur, luftfuktighet, vind, byvind, nederbörd kommande 24 h, vädervarning, luftkvalitet (station/täckning), grundvatten (regionalt/observerat), översvämningsexponering (scenario), krisinformation, trafikstörningar, SMS-status.
6. Riktiga prognosgrafer med `validAt`, enhet, källa och korrekt tidszon.
7. Officiella varningar i separat tydlig panel.
8. Vatten-/översvämningspanel med statiska kartscenarier tydligt separerade från aktuell nederbörd.
9. Lokal karta med fastighetsposition, valbara WMS/GeoJSON-lager och relevanta händelser.
10. Kort eventflöde och knappen **”Konfigurera SMS”**.
11. För varje datakort: `value`, `unit`, `source`, `timestamp`, `status`, detaljtooltip/metod.

**Föreslagna UI-instrument** (knyt enbart till faktiska data):

| Widget | Källa | Rätt visning |
|---|---|---|
| Temperaturtermometer/sparkline | SMHI prognos/MetObs | Tydlig etikett prognos eller station |
| Vindring + vindriktning | SMHI | m/s, riktning, prognostid |
| Nederbördsstaplar | SMHI | mm per intervall eller korrekt summerad mm/24 h |
| Luftfuktighetsmätare | SMHI | % och prognostid |
| Varningsindikator | SMHI officiella varningar | Originalnivå, källa, giltighetstid |
| Luftkvalitetskort | Naturvårdsverket | Station, luftförorening, enhet, distans |
| Grundvattenkort | SGU | Regional klass eller stationsvärde, aldrig ”källarnivå” |
| Översvämningslager | MCF | Historiskt/statistiskt scenario och karttäckning |
| Trafikhändelser | Trafikverket | Händelser i närhet när geodata stöder det |
| Krisinformation | Krisinformation | Läns-/områdesrelevans och länkar |
| Områdesstatistik | SCB | Publiceringsår, geografisk nivå |
| Energideklaration | Boverket | **Endast om användningsrätt uttryckligen klarerad** |

### 14.3 Design, 3D och animationer

- Respektera originaldesignens visuella kvalitet, typografi, glass/shadow-kort, gauges, välbalanserad spacing och navigationsmönster.
- Använd riktig 3D-geometri eller lagliga 3D-assets. Visa inte en fiktivt fotorealistisk ”digital tvilling” som om den är exakt modell av kundens byggnad. Märk generiska modeller `illustration`.
- Vatten kan vara procedur-/shader-animation eller diskret CSS/WebGL-lager, men får inte tolkas som verklig översvämningsnivå.
- Små interaktioner: mjuk hover, laddningsskelett, kortövergång, diskreta pulserande pin-markörer.
- Responsiv från desktop ned till mobil. På små skärmar: prioritera varningar, lista och läsbar grafik; minimera tung WebGL.
- `prefers-reduced-motion` ska stänga av icke-nödvändiga animationer.
- 3D och diagram får aldrig blockera datatillgänglighet, läsbarhet, tangentbord eller skärmläsare.
- Lazy-load 3D, hantera WebGL-fel, `Suspense`-fallback och minnesläckor vid navigation mellan fastigheter.
- Kontrollera visuellt att 3D-animationen inte lägger över källa, etikett eller viktiga knappar.

---

## 15. SMS-inställningar och onboarding-UX

Konfigurationspanel (i Property Detail, modal eller separat settings-rutt, men **behåll de två primära dashboard-sidorna**):

- Global SMS-aktivering för organisationen.
- Verifierat mobilnummer; tydlig mottagare och avregistrering.
- Per fastighet: checkboxar för officiella varningar, vind, regn, frost, lokal krisinformation, luft och trafik när respektive källa stöds.
- För tröskelregler: slider/input för numerisk nivå, enhet och prognosfönster.
- Officiella varningar: val för nivå/typ, utan att förvanska originalklassificeringen.
- ”Skicka bara en gång per händelse” som default, med tydliga inställningar för uppdateringar.
- Tysta timmar (Sverige), val för kritiska kategorier och max SMS per dag/månad.
- Visa uppskattad SMS-användning/kvot på ett begripligt sätt; kostnader är leverantörsberoende.
- Bekräftelse innan sparad ändring leder till påslagna SMS.

**Default:** Alla SMS-regler är AV. Användaren måste aktivera dem själv.

---

## 16. Säkerhet, juridik och tillförlitlighet

### 16.1 Säkerhet

- Använd etablerad auth, säkra cookies, CSRF-skydd där relevant, sessionshantering och MFA-stöd om auth-provider erbjuder.
- Inga API-nycklar i frontend eller loggar. `NEXT_PUBLIC_` endast för uttryckligen publika konfigurationer.
- All tenantdata filtreras server-side via organisationstillhörighet, inklusive SSE, exporter och sök.
- ORM/raw SQL parametriserad; validera user input, lat/lon, GeoJSON och utgående requests.
- Skydda mot SSRF genom allowlistade externa API-domäner och hårdkodade anropsmallar.
- Restriktioner mot massregistrering av fastigheter, OTP-missbruk och SMS-spam.
- TLS i drift; kryptera/åtkomstskydda mobilnummer och övriga personuppgifter.
- Structured logging med redaction av tokens, nummer, e-post där möjligt.
- Rate limits per IP/user/org och separata leverantörskvoter.
- Säker hantering av webhooks om aktiverade.

### 16.2 Rättigheter och attribution

- Granska källans faktiska licens per dataset, inte bara huvudmyndighetens generella sida.
- Visa källa och originallänk på berörda kort.
- Officiella varningar ska behålla korrekt betydelse, källmärkning och tidsangivelser.
- Respektera kart-/tile-leverantörens attribution och produktionsvillkor. Använd inte gratis publika OSM-tile-/Nominatim-servrar som obegränsad kommersiell infrastruktur.
- Boverket förblir avstängt tills extern vidarevisning/lagring i vår SaaS uttryckligen klarerats.
- Utforma tjänsten som kompletterande information och undvik att kalla SMS ”garanterade akuta myndighetslarm”.

### 16.3 GDPR

- Dokumentera ändamål/rättslig grund för konto, fastighetskonfiguration, mobilnummer och notifieringar.
- Skapa personuppgiftspolicy, register över leverantörer, raderingsflöde och dataminimering.
- Bedöm avtal för personuppgiftsbiträden och tredjelandsöverföring vid val av auth, hosting, analytics och SMS.
- Verifiera att mottagaren själv har accepterat SMS-bevakningen. Undvik att skicka till obekräftade tredje parter.
- Särskilj service-SMS från eventuell framtida marknadsföring.

---

## 17. Teststrategi (måste vara automatiserad)

### 17.1 Enhetstester

- SMHI enheter, missing values, summering av nederbördsintervall.
- Geo: point-in-polygon, GeoJSON-invaliditet, EPSG-transform, geografiska gränsfall.
- Matchningar mot kommun/län, stationsavstånd och täckning.
- Eventdiff och idempotency vid uppdatering/upphörande.
- Regler: operatorer, cooldown, hysteresis, DST, quiet hours och budgetgräns.
- SMS längd/antal delar och dryrun-path.
- `no_coverage`/`stale`/`access_required` får aldrig renderas som `ok`.

### 17.2 Adapterkontrakt

- Spara små, tillåtna, anonymiserade/syntetiska fixtures från representativa API-former.
- Testa validering mot officiella exempel och icke-kompletta, tomma och förändrade svar.
- Kontraktstest med live smoke-test i separat jobb; undvik instabila nätverkstester i varje lokal testkörning.
- Kontrollera att ingen adapter kan producera ett skarpt mätvärde från fallback-mock.

### 17.3 Integrationstester

- PostGIS-insert och korrekt tenant-filtrering.
- Redis/BullMQ-retry, idempotent jobbstyrning och lease/lock.
- REST-API access per organisationsmedlem/roll.
- SMS blockeras utan verificerat nummer/opt-in eller med `SMS_ENABLED=false`.
- Dubbelbearbetning av samma event ger **exakt ett** planerat utskick.

### 17.4 E2E med Playwright

1. Registrera konto och organisation.
2. Lägg till fastighet; bekräfta kartkoordinat.
3. Se riktiga eller explicit märkt fixture-data.
4. Välj fastighet från portföljkarta och lista.
5. Byt fastighet genom switcher på detaljsidan.
6. Aktivera SMS-bevakning i testläge.
7. Injicera test-event → dashboard uppdateras och 46elks `dryrun` eller stub tar emot jobbet.
8. Repetera samma event → ingen dublett.
9. Stäng av regeln → inga fortsatta SMS-jobb.
10. Logga in som annan tenant → ingen åtkomst till den första kundens data.
11. Simulera tredjeparts-API nere → korrekta stale/error-indikatorer, övriga funktioner aktiva.
12. Testa mobilvy, tangentbord och reduced motion.

---

## 18. Drift, CI/CD och observability

### Lokal utveckling

- `docker compose up -d` startar PostgreSQL/PostGIS + Redis.
- `pnpm install`, migrationskommando, seed av **syntetiska demo-objekt**, start av `web`, `api`, `worker`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build` ska finnas och fungera.
- README dokumenterar exakta kommandon efter vald stack.

### Produktionsförberedelse

- Hosting av web/api/workers separat men med samma versionsrelease.
- Migrera databas säkert och möjliggör rollback där det går.
- Health endpoints: `live`, `ready`, källstatus och worker queue lag.
- Monitoring: API latency/error rate, källfärskhet per adapter, ködjup, antal retry, SMS-felgrad, kostnad och rate limit.
- Central error tracking, larm vid källor som slutar uppdatera, loggar utan hemligheter.
- Dagliga backuper med testad restoreprocedur och definierad retention.
- Lås ned administration, stötta rottering av secrets.
- Feature flags för varje integration så den kan stängas av oberoende.

---

## 19. Exakt arbetsordning för AI-programmerarna

> **Regel:** Varje steg ska resultera i körbar kod, automatiserade tester, dokumenterad PR/commit och uppdaterad checklista. Agenten ska inte hävda att en integration är färdig förrän verkligt kontraktstest/fixture-test och UI-status är verifierade.

### Fas 0 — Repo- och designinventering

- [ ] Inspektera hela projektmappen: befintlig design, routning, UI-komponenter, färger, 3D-assets, animationer.
- [ ] Dokumentera vilka delar som redan finns och inte ska skrivas om.
- [ ] Identifiera eventuella tekniska konflikter med detta dokument.
- [ ] Lås grundval av stack och skapa `docs/decisions/0001-architecture.md`.
- [ ] Skapa `docs/implementation-progress.md` med ansvarig, status, blockerare för varje fas.

**Godkänd när:** repo startar och originaldesignens båda sidor kan visas oförstörda.

### Fas 1 — Projektinfrastruktur

- [ ] Konfigurera workspaces, typer, lint, format, CI.
- [ ] Lägg till Docker/PostGIS/Redis och migrationssystem.
- [ ] Skapa gemensam env-validering: saknade *valfria* API-nycklar ger `disabled`, inte buildfail.
- [ ] Implementera logging, problem-details errors och health routes.

**Godkänd när:** clean checkout kan starta backend, databas, redis och web enligt README.

### Fas 2 — Auth, organisationer och fastigheter

- [ ] Registrering, e-postverifiering och inloggning.
- [ ] Organisation, medlemsroll, tenant guards.
- [ ] Geoapify Address Autocomplete som primär adressleverantör (`GEOAPIFY_API_KEY`), serverproxy med debounce, kvotspärr, svensk filter och användarbekräftad kartposition; utan nyckel: manuell pin-fallback.
- [ ] CRUD och navigering mellan flera fastigheter.
- [ ] RLS eller konsekvent backend-authorization och test för isolering.

**Godkänd när:** två olika kunder kan lägga till byggnader utan möjlighet att se varandras uppgifter; Geoapify-test ger verkliga koordinater när nyckel finns, och registrering går fortfarande genom manuell pin när nyckel saknas.

### Fas 3 — Geomotor och datamodell

- [ ] PostGIS och matchningsbibliotek.
- [ ] Kontrakt `DataPoint`, `MonitorEvent`, `SourceManifest`.
- [ ] Källstatus och datastatusmodell.
- [ ] Geografiska tester och migrationer.

**Godkänd när:** alla geografiska relationer kan testas på syntetiska fastigheter/polygoner.

### Fas 4 — Offentliga kärnkällor

- [ ] SMHI SNOW1gv1 (prognoser och parametrar).
- [ ] SMHI officiella varningar.
- [ ] SMHI MetObs.
- [ ] Krisinformation v3.
- [ ] Källspecifika integrationstest, retries, rate limits, attribution.

**Godkänd när:** riktiga hämtningar lyckas, källor kan vara nere utan att UI bryts och inga fejkvärden visas.

### Fas 5 — Övriga öppna data

- [ ] Luftkvalitet, täckning och stationsmatchning.
- [ ] SGU observerat + regionalt grundvatten.
- [ ] MCF GIS-lager: inventera dataset, licens, import och överlagring; aktivera endast validerade lager.
- [ ] SCB v2 med ett litet urval relevanta tabeller och kontextkort.
- [ ] Utvärdera om fler öppna relevanta källor bör läggas till, med samma manifestprocess.

**Godkänd när:** varje källa har dokumenterad coverage, betydelse, last-update och felbeteende. Källor med saknad täckning visar detta tydligt.

### Fas 6 — Aggregation och liveflöde

- [ ] Centrala collectors, jobbköer, cache, idempotency.
- [ ] Property geo-matching och portfolio summary.
- [ ] REST-endpoints och SSE.
- [ ] Loading/stale/error state i varje instrument.

**Godkänd när:** uppdaterat källvärde kan nå rätt kunddashboard automatiskt utan onödiga källanrop.

### Fas 7 — Koppla in hela godkända designen

- [ ] Portfolio Overview med karta, KPI, händelseflöde, fastighetslista.
- [ ] Property Detail med 3D-fastighet, vattenanimationer, instrument, grafer och källor.
- [ ] Fastighetsswitcher, breadcrumbs, karta och filter.
- [ ] Responsive layout, a11y, reduced motion, WebGL fallback.
- [ ] UI visar faktiska backendkontrakt och explicita tomlägen.

**Godkänd när:** båda sidorna ser ut som designreferensen och fungerar med verklig databearbetning.

### Fas 8 — SMS-motor, initialt enbart dry run

- [ ] Regelbyggare, verifierat nummer, opt-in.
- [ ] 46elks adapter med `dryrun=yes`.
- [ ] Event matching, hysteresis, dedup, quiet hours och budget.
- [ ] Leveransstatus, rate limiting och automatisk gallring.
- [ ] E2E med testevent och upprepat testevent.

**Godkänd när:** ingen test kan skicka riktiga SMS och dubbletter konsekvent förhindras.

### Fas 9 — Nyckel-/avtalsberoende källor

- [ ] Trafikverket efter gratis privat-/företagsregistrering, verifierad e-post och giltig API-nyckel. Dokumentera `Situation`/andra valda datamodeller, närhetsmatchning och felhantering.
- [ ] Lantmäteriet **endast som frivillig framtida enrichment** efter juridiskt godkännande och organisationsbehörighet; det får inte ersätta Geoapify i normala onboardingflödet utan nytt produktbeslut.
- [ ] Boverket endast om skriftligt klartecken för kundriktad SaaS finns.
- [ ] Dokumentera användningsvillkor och adapterkontrakt.

**Godkänd när:** Trafikverket kan aktiveras/deaktiveras med en enda flagga, utan att röra Geoapify och dashboardens övriga källor; Lantmäteriet får ligga `disabled` utan produktionsblockering.

### Fas 10 — Kvalitet, säkerhet och pilot

- [ ] E2E och lasttest för flera hundra/tusentals adresser, utifrån realistiska provider-kvoter.
- [ ] Pen-test/check av tenant isolation, endpoint auth, secrets och abuse limits.
- [ ] Gallring, dataexport, kontoradering, backup/restore.
- [ ] Källvillkor och SMS/juridik granskade.
- [ ] Pilot med verklig fastighetsägare, korrekt språk och tydliga begränsningar.
- [ ] Granska kundens feedback och mät vilka instrument som används.

**Godkänd när:** drift kan ske säkert, utan falska ”allt lugnt”-statusar eller SMS-stormar.

### Fas 11 — Produktionsaktivering av SMS (separat godkännande)

- [ ] Projektägaren har fyllt i 46elks-uppgifter i säker secrets manager.
- [ ] Testnummer verifierade, SMS-budget och opt-in dokumenterade.
- [ ] `SMS_ENABLED=true` och `SMS_DRY_RUN=false` **endast efter explicit ägarbeslut**.
- [ ] Genomför kontrollerat skarpt test och verifiera återställning/rullback.

**Godkänd när:** skarpa SMS levereras en gång, med korrekt källa, tenant och kostnadslogg.

---

## 20. Tydliga produkt- och datakvalitetskrav

För varje instrument/kort, visa eller gör tillgängligt i tooltip:

- `Vad visas?` (namn och definition)
- `Vilken datatyp?` (prognos, observation, varning, statiskt scenario, statistik)
- `Var gäller den?` (grid, station med avstånd, punkt, polygon, län/kommun)
- `När gäller den?` (mät-/prognos-/publiceringstid)
- `Hur färsk är den?` (hämtningstid, freshness)
- `Varifrån?` (myndighet + originallänk)
- `Kan jag få SMS?` (bara om datatyp, precision och regelmotorn tillåter det)

### Undvik följande felaktiga UI-etiketter

| Visa inte | Visa i stället |
|---|---|
| ”Fastighetens luftkvalitet: 42” | ”Närmaste tillgängliga mätstation: PM2.5 X µg/m³, Y km bort” |
| ”Vattennivå 70 %” från en MCF-karta | ”Omfattas av karterat 100-årsscenario (källa och år)” |
| ”Ingen risk” när SMHI nere | ”Väderinformation tillfälligt otillgänglig” |
| ”Realtid” vid årsstatistik | ”Senast publicerade statistik: [år]” |
| ”Byggnadshälsa 98 %” utan metod | ”Inga aktiva varningar i tillgängliga källor” |
| ”Trafik stoppad vid huset” från osäker radius | ”Trafikhändelse rapporterad i närheten” |

---

## 21. Definition of Done för hela projektet

- [ ] Originaldesignens **två huvudsidor** finns, ser professionella ut och är fullt responsiva.
- [ ] Kund kan registrera konto, organisation, lägga till flera fastigheter och byta vy.
- [ ] Verkliga offentliga API:er levererar korrekt normaliserade data med källor, tid och precision.
- [ ] Samtliga inventerade källor har adapter/manifest och tydlig accessstatus; blockerade visas inte falskt som aktiva.
- [ ] Data/status uppdateras automatiskt och via SSE utan extra manuell refresh.
- [ ] Alla mätinstrument har tydlig datatyp och saknade data hanteras korrekt.
- [ ] Portföljkarta, händelseflöde, 3D-fastighetsillustration och animationer fungerar utan att blockera användbarhet.
- [ ] SMS-regler är användarstyrda, avstängda som default och fungerar i dryrun med idempotency.
- [ ] SMS-budgets, cooldown, verifierat nummer och tysta timmar är testade.
- [ ] Tenantisolering och grundläggande säkerhets-/privacykrav är testade.
- [ ] Dokumentation för deployment, source manifest, env och incidenter finns.
- [ ] Testsvit går grönt, inklusive e2e, kontrakt och centrala integrationer.
- [ ] Inga produktionshemligheter eller riktiga personuppgifter ligger i repo.
- [ ] Ägaren har godkänt eventuella källvillkor och skarpa SMS separat.

---

## 22. Arbetsinstruktion att lägga överst i programmeringsagenternas uppdrag

> Du ska implementera FastighetsRadar utifrån `IMPLEMENTATION.md` och det befintliga godkända dashboard-UI:t. Läs hela dokumentet och inspektera repo innan du ändrar kod. Arbeta fas för fas, men använd modulära adapters så att alla relevanta datakällor kan kopplas in utan att förändra övriga systemet. Använd bara verifierade API-rutter, giltig åtkomst och tillåten återanvändning. Påstå aldrig att en adapter fungerar innan du har körbara tester som visar det. Inga påhittade datapunkter, ingen felaktig ”realtid”, inga fejkade 3D-byggnadsdata, inga riktiga SMS utan uttryckligt godkännande. Efter varje fas: redovisa kodändringar, körda tester, funktionsstatus, blockerare, miljövariabler som saknas och uppdatera `docs/implementation-progress.md`. Fortsätt där det är möjligt även om tillstånd eller API-nyckel saknas för en enskild integration.

---

## 23. Källor, externa referenser och kontrollpunkter

Dessa länkar är primära underlag för integrationsbesluten. Verifiera aktuell dokumentation igen vid själva implementationen.

1. SMHI SNOW1gv1: https://opendata.smhi.se/metfcst/snow1gv1/
2. SMHI SNOW exempel/parametrar: https://opendata.smhi.se/metfcst/snow1gv1/examples
3. SMHI prognosbeskrivning: https://www.smhi.se/data/sok-oppna-data-i-utforskaren/meteorologisk-prognos-api
4. SMHI IBWW varningar: https://opendata.smhi.se/warnings/
5. SMHI vädervarningars villkor: https://www.smhi.se/data/sok-oppna-data-i-utforskaren/konsekvensbaserade-vadervarningar-api
6. SMHI MetObs exempel: https://opendata.smhi.se/metobs/examples
7. Krisinformation öppna data / v3: https://www.krisinformation.se/om-krisinformation.se/oppen-data/
8. Naturvårdsverket webbtjänster luft: https://www.naturvardsverket.se/amnesomraden/luft/statistik--utslapp-och-halter/luftkvaliteten-i-realtid-och-preliminar-statistik/webbtjanster-luftkvalitetsdata/
9. SGU grundvattennivåer: https://www.sgu.se/produkter-och-tjanster/geologiska-data/grundvatten--geologiska-data/grundvattennivaer/
10. SGU observerat OGC: https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1/collections
11. SGU regionalt OGC: https://api.sgu.se/oppnadata/grundvattennivaer-sgu-hype-omraden/ogc/features/v1/collections
12. MCF Översvämningsportalen: https://www.mcf.se/sv/verktyg--tjanster/oversvamningsportalen/
13. SCB PxWebApi v2: https://www.scb.se/vara-tjanster/oppna-data/pxwebapi/pxwebapi-v2/
14. SCB API Swagger: https://statistikdatabasen.scb.se/
15. Trafikverkets öppna trafikinformations-API: https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/
16. Lantmäteriet Referens Uppslag Adress v3: https://geotorget.lantmateriet.se/geodataprodukter/referens-uppslag-adress-api
17. Boverket energideklarationer: https://www.boverket.se/sv/om-boverket/oppna-data/publikt-api-for-energideklarationer/
18. Boverket användaravtal (kontrollera senaste version vid ansökan): https://www.boverket.se/contentassets/51c02d34c12f472085ffa2222699ad9ac/api-avtal2.pdf
19. 46elks SMS: https://46elks.se/docs/send-sms
20. IMY principer för personuppgiftsbehandling: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/grundlaggande-principer
21. Geoapify MyProjects / nycklar: https://myprojects.geoapify.com/
22. Geoapify Address Autocomplete API: https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/
23. Geoapify Geocoding API: https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/
24. Geoapify priser och kvoter: https://www.geoapify.com/pricing/
25. Geoapify Map Tiles / licens- och attributionskrav: https://apidocs.geoapify.com/docs/maps/
26. Trafikverket registrering: https://data.trafikverket.se/oauth2/Account/register
27. Trafikverket kom igång och nyckelhantering: https://data.trafikverket.se/get-started

---

## 24. Beslutslogg / sådant som återstår att välja

Följande beslut ska tas uttryckligen i repo och inte lämnas som tysta antaganden:

- [ ] Exakt driftplattform och secrets manager.
- [ ] Auth-provider och organisationsmodell.
- [x] **Geoapify är vald som primär geokodare**. Återstår: projektets API-nyckel, kontroll av budget/attribution och verifierad integration.
- [ ] Karttile-leverantör och dess separata krediter/attribution. Geoapify kan även användas för tiles, men kostnaden ska mätas separat.
- [ ] Om 3D-fastigheten är generisk illustration eller en licensierad faktisk byggnadsmodell.
- [ ] Exakta tröskelvärden och vilka datatyper som får ge SMS; börja konservativt.
- [ ] Källspecifika pollingintervall efter verklig kvot-/villkorskontroll.
- [ ] Rättslig grund, retention, personuppgiftsbiträden och raderingsrutiner.
- [ ] Beslut om vilka MCF GIS-lager som importeras och vilka som enbart renderas via WMS.
- [ ] Om Boverket över huvud taget ska inkluderas i kunddashboarden beroende på avtal.
- [ ] Prisplaner, SMS-budgetar och eventuell framtida betalningsfunktion (ej del av kärnimplementation).

**Slutprincip:** Bygg ett brett, robust och trovärdigt fastighetsdatagränssnitt. Vackra animationer får förstärka presentationen, men aldrig ersätta giltiga data, källor och kvalitetssäkring.
