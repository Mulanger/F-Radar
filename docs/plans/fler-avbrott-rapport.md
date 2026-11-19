# Fler avbrott – rapport

Leveransen är **delvis nationellt**. Kodgrunden och helhetsfunktionerna är byggda, men flera källor och fullständiga nationella kundmått återstår. Inget är deployat eller aktiverat. SMS_MODE är oförändrat.

## Gren och commits

Gren: `codex/avbrott-hela-landet`, egen worktree från `e9945d5`. Senaste kodcommit: `9cf2a14`. Sista commit är grenens `HEAD`: rapportcommiten direkt ovanpå `9cf2a14`. Alla commits är pushade. `landing-merge`, basgrenen och produktionsdatabasen är orörda.

| Fas | Status och leverans | Commit |
|---|---|---|
| 0 | Delvis: nationella Ei/SCB-underlag, poddprov och plattformskartläggning; ytterligare 81 kandidatsidor granskade. Full värme-/VA-kundandel saknas. | `9ee7b22`, `9cf2a14` |
| 1 | Delvis: värdlåst svenskt proxystöd, TLS-kedjor, täckningsrapport och lucksignal. Svensk proxy och driftverifiering återstår. | `78c82cb` |
| 2 | Delvis: fyra stora elnätsbolag tillagda. Övriga nät har inte tillräckligt verifierade adaptrar. | `03417d8`, `9cf2a14` |
| 3 | Klar: gemensam vatten-/gasgrund, kategorier, livscykel, kartor och kvitteringsregler. | `adffac4` |
| 4 | Delvis: Exergi, Vattenfall Värme, Solör, Umeå värme/kyla och Mälarenergi värme. Fler bolag och kyllager återstår. | `1200f09`, `9cf2a14` |
| 5 | Delvis: SVOA, Tekniska verken och VA-profiler; kokningsregler och separata simulerade SMS-kategorier. Nationell VA-utbyggnad återstår. | `ecc1b61` |
| 6 | Delvis: Göteborg gas och gemensam SMS-/matchningslogik; Driva/Weum ej anslutna. | `5d4c1eb` |
| 7 | Inte gjord enligt ditt beslut; endast kartläggning. | `d2c31e6` |
| 8 | Klar i kod: täckning/källhälsa för fem nyttigheter, ETag och planerade avstängningar bakom flagga. Oberoende hälsa inom delade jobb återstår. | `8a4f168`, `9cf2a14` |

## Täckning före och efter

Produktions­täckningen är oförändrad. Alla nytillskott är avstängda som standard. Måtten gäller leverantörernas kundbas, inte andelen adresser med exakt träff eller SMS.

| Nyttighet | Före → efter i produktion | Potential och begränsning |
|---|---|---|
| El | **68,7677 % → 68,7677 %**: 3 859 845 av 5 612 871 abonnemang | Fyra nya bolag: +335 510. Konservativ potential **74,6308 %** med vatten av; **73,7947 %** med VA på i delade jobb, utifrån fångade svar. |
| Fjärrvärme | Full andel ej verifierad → oförändrad | Säkert särredovisad del Göteborg: minst **4,0410 %** av 351 520 kundrelationer. Med Exergi blir motsvarande potentiella nedre gräns **7,2022 %**. Övriga bolags hela kundbas tillgodoräknas inte utan verifierad nätomfattning. |
| Vatten | **0 % → 0 %** | Nationell andel anslutna kunder ej verifierad. Stockholm/Huddinge/Linköping motsvarar **12,0941 % av invånarna**, en befolkningsproxy som inte får kallas kundandel. |
| Gas | **0 % → 0 %** | Göteborgs 7 005 abonnemang motsvarar **9,3055 %** av Ei:s redovisade 75 278. Jämförbarheten med hela landets stadsgas är inte färdigverifierad. |

Ny SELECT bekräftade elbaslinjen med aktiva jobb, senaste status `ok` och högst 20 min gammal lyckad hämtning. Oxelös tidigare ignorerade El-profil blir nu korrekt `partial` för en post utan yta: 6 423 abonnemang räknas därför bort i potentialen. Med VA på blir även EEM partial; dess 46 931 elabonnemang räknas då bort. Underlag och beräkningar finns i `docs/sources/utility-outages-2026-11-19/`.

## Tillagda källor och lager

”Ja” betyder att flödet hämtats från podden; begränsningar anges separat.

| Källa | Plattform och nyttighet | Från podden |
|---|---|---|
| Öresundskraft Elnät | Trimble, el, områdesprecision | Ja |
| Kraftringen Nät | Digpro-KML, el | Ja |
| Umeå Energi | Publicerad JSON/GeoJSON, el/värme/kyla | Ja |
| Skellefteå Kraft | JSON, el | Ja |
| Stockholm Exergi | Digpro-KML, värme | Ja |
| Vattenfall Värme | Trimble, värme, områdesprecision | Ja |
| Solör Bioenergi | ServiceAlert, värme, områdesprecision | Ja |
| Mälarenergi | Trimble, värme i befintligt eljobb, områdesprecision | Ja |
| Stockholm Vatten och Avfall | Paginerad JSON med polygoner, vatten | Ja |
| Tekniska verken | JSON/GeoJSON, vatten | Ja |
| Söderhamn, Oxelö, Emmaboda, EEM, Ljusdal, Ulricehamn | ServiceAlert VA-profiler | Ja; geometri varierar, EEM ofullständig |
| Göteborg Energi | Digpro-KML/API, gas | Ja; samtliga gaslistor tomma |

## Källor som återstår

- Falu, Halmstad, Härnösand, Bergs Tingslags, Luleå, Nacka och Jämtkraft: blockerings-/anslutningsfel; svensk utgång oprövad. Hedemora/Linde: TLS-kod fungerar lokalt men är inte verifierad installerad i podden.
- Härryda: Digpro identifierad, men KML och nätområde ger timeout från podden; ingen adapter byggd.
- Jönköping: inget verifierat geografiskt kontrakt. Gotland: osäker status-/kundantalssemantik. Telge, Borås, C4 och återstående elnät: fortsatt API-/precisionskartläggning behövs. Den automatiska HTML-genomsökningen bevisar inte att flöden saknas.
- Öresundskraft värme och övriga värmebolag: ingen tillräckligt verifierad geometrikoppling i leveransen.
- Göteborg VA: adresspunkter utan ritad yta. VA SYD: timeout. Uppsala och övriga stora VA-organisationer: inte färdiga. SVOA-adresser utanför polygonerna matchas inte ännu.
- Driva: [arbetssidan](https://www.drivagasnat.se/arbeten) ger veckor/TBD och ledningsarbeten, vilket inte säkert betyder leveransavbrott. Weum: inget verifierat publikt maskinläsbart avbrottsflöde identifierat.

## Beslut jag tog

- Följde dina senare beslut: inget serverinköp, behållet **El och värme**, kokning enligt §2.3, flaggstyrd tidslinje och ingen Fas 7. Inget bolag kontaktades och inget konto skapades.
- Vatten/avlopp delar `water` och `WaterSupply`; gas använder `Heating`. Riskfaktorns namn är centraliserat; vatten påverkar händelsestatus men ingår tills vidare inte i faktorn El och värme.
- Saknad yta blir inte en gissad polygon. Okänd typ/tid förblir okänd. Generella VA-meddelanden är information utan SMS eller kvittering; kokning är röd inom publicerat område och kräver kvittering.
- Kokning klassificeras försiktigt från uttryckliga rubriker. Inget aktivt verkligt kokningsfall fanns att liveverifiera; klassificeringsfallen är syntetiska på riktiga ytor. Vattenbesparingsmeddelanden tas inte in dubbelt med Krisinformation.
- SMS kräver exakt träff och bekräftad position även vid adresslista. Ingen bakåtfyllnad eller antagen återställning skickas. Kokning passerar tysta timmar bara vid regelns uttryckliga undantag. Nya SMS hålls till en del och dedupliceras även mellan regler.
- Tidslinjen utelämnar okänd sluttid, gammalt underlag och områdes-/närhetsträffar. Delade jobb får konservativt gemensam hälsa: ett ofullständigt lager kan sänka även andra nyttigheters täckning.
- Ditt uttryckliga undantag användes endast via `run-real-db-tests.mjs` mot `fastighetsradar_test`, seriellt och efter nollkontroll av anslutningar.

Återstående ägarval: proxyleverantör/kostnad samt separat deployment och produktionsaktivering. Ingen ytterligare detaljfråga väntar.

## Flaggor, migreringar och aktivering

Nya flaggor nedan är `false` som standard:

```text
SOURCE_UTILITY_ORESUND_ENABLED
SOURCE_UTILITY_KRAFTRINGEN_ENABLED
SOURCE_UTILITY_UMEA_ENABLED
SOURCE_UTILITY_SKEKRAFT_ENABLED
SOURCE_UTILITY_EXERGI_ENABLED
SOURCE_UTILITY_VATTENFALL_HEAT_ENABLED
SOURCE_UTILITY_SOLOR_ENABLED
SOURCE_UTILITY_UMEA_HEAT_ENABLED
SOURCE_UTILITY_MALAR_HEAT_ENABLED
SOURCE_UTILITY_SVOA_ENABLED
SOURCE_UTILITY_WATER_ENABLED
SOURCE_UTILITY_GAS_ENABLED
SMS_WATER_OUTAGE_ENABLED
SMS_HEATING_OUTAGE_ENABLED
SMS_GAS_OUTAGE_ENABLED
UTILITY_OUTAGE_UPCOMING_ENABLED
```

`UTILITY_OUTAGE_SE_PROXY_URL` är normalt tom och ska hanteras som serverhemlighet.

Migrering **0017** skapar tenantbundna täckningsluckor. **0018** tillför vatten, meddelandetyp och kategorin WaterSupply. Båda är endast körda i testdatabasen.

För produktionsaktivering måste du:

1. Granska/merga grenen, kontrollera migreringsnummer mot parallellt arbete, göra ren `npm ci`, bygga och deploya genom ordinarie releaseflöde. Använd inte lokala junction-baserade byggartefakter.
2. Köra 0017/0018 genom ordinarie checksummade migreringar. Behålla SMS_MODE simulerat.
3. Behålla `SOURCE_UTILITY_OUTAGES_ENABLED=true` och sätta önskade käll-/nyttighetsflaggor ovan till `true`. Om `UTILITY_OUTAGE_OPERATORS` är begränsad: lägg till `oresundskraft,kraftringen_elnat,umea,skekraft,stockholm_exergi,vattenfall_heat,solor,svoa`. Mälarenergi använder befintliga `trimble:malarenergi`.
4. För blockerade källor: ordna en svensk HTTPS CONNECT-proxy med giltigt TLS, autentisering/IP-begränsning och ingen TLS-interception. Tillåt endast port 443 till `webmap.fev.se`, `dpwebmap.hem.se`, `dpwebmap.hemab.se`, `dpweb.btea.se`, `webmap.luleaenergi.se`, `dp-prod.nackaenergi.se`, `avbrottskarta.jamtkraft.se`. Sätt proxyvariabeln och verifiera varje flöde från podden. Separat liten svensk proxy rekommenderas; ingen är anskaffad.
5. Kontrollera fullständiga lyckade jobb, täckning och simulerade inom-/utanför-träffar. Slå därefter på önskade SMS-flaggor och uttryckliga kundregler med samtyckta mottagare. Tidslinjen kräver sin egen flagga. Nya värmekällor går via `heating_outage`; äldre värmeregler bevaras.

## Tester och kvarstående risker

Slutresultat: **69 Vitest-filer, 513 godkända tester, 6 överhoppade lokala PostGIS-tester utan TEST_DATABASE_URL. Separat poddsvit: 36/36 godkända.** Typer för web/api/db/domain samt övriga paket och eslint är gröna. API-build och webbens webpack-build passerar.

Inte verifierat: svensk proxy, nya TLS-koden i podden, verkligt aktiv gas-/kokningspost, manuell webbläsargranskning, produktionsaktivering och full nationell värme-/VA-kundandel. Webbbygget varnar om 27 externa junction-filer i standalone; ren releaseinstallation krävs. `apps/web/next-env.d.ts` är inte committad.

Nästa steg: ordna och prova svensk utgång, verifiera återstående stora leverantörers kontrakt i kundordning, förbättra adressmatchning och oberoende hälsa per nyttighetslager, och fortsätt därefter utrullningen stegvis med simulerade SMS.
