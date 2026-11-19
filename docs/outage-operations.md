# Avbrottsbevakning: förberedelser före produktionsaktivering

Denna gren får inte deployas eller ändra produktion automatiskt. SMS_MODE ändras inte.

## Svensk utgång, Fas 1

`UTILITY_OUTAGE_SE_PROXY_URL` är en **serverhemlighet**, normalt tom. Format:
`https://[användare:lösenord@]proxyvärd:port` (URL-koda autentiseringsuppgifter).
Det ska vara en vanlig HTTPS-proxy med HTTP CONNECT till port 443, svensk publik utgång,
giltigt publikt TLS-certifikat och autentisering eller IP-begränsning från podden.
Ingen intercept/dekryptering av leverantörens TLS. Inga request-/response-body-loggar.
Proxyn ska dessutom själv neka alla mål utom följande FQDN och port 443:

- `webmap.fev.se`
- `dpwebmap.hem.se`
- `dpwebmap.hemab.se`
- `dpweb.btea.se`
- `webmap.luleaenergi.se`
- `dp-prod.nackaenergi.se`
- `avbrottskarta.jamtkraft.se`

Koden använder proxy bara för `requiresSwedishEgress`-markerade operatörer och nekar andra
värdar, protokoll, målportar, URL-uppgifter och omdirigeringar i dessa anrop.
Utan env-variabeln används befintlig direkt hämtning. Fel ger fortsatt otillgänglig källa,
aldrig "inga avbrott". Ingen proxy, server, hosting eller konto har skaffats.
Rekommendation: en separat liten proxy i Sverige, efter ägarens val av drift och kostnad.
Verifiera samtliga sju flöden från podden när ägaren har ordnat utgången; timeout bevisar
inte geografisk blockering, så svensk IP är ingen garanti.

## TLS, Fas 1

`tls-intermediates.ts` innehåller två publika mellanliggande CA-certifikat, hämtade efter
normal Windows-kedjeverifiering 2026-11-19. De används bara för respektive exakta värd,
tillsammans med Node:s vanliga rotcertifikat. Fingeravtryck kontrolleras före användning.
Hostname, giltighetstid och hela kedjan verifieras normalt; inga leaf-certifikat betros.

| Värd | CA | SHA-256 | CA giltigt till |
|---|---|---|---|
| `webmap.hedemoraenergi.se` | GoGetSSL RSA DV CA | `43:CA:C3:1E:F8:E8:BA:1B:4B:16:B8:20:6E:4C:0A:26:C5:BA:DB:2F:C3:AA:09:E9:01:70:E4:1B:66:C2:FD:64` | 2028-09-05 |
| `webmap.lindeenergi.se` | GlobalSign GCC R46 OV TLS CA 2025 | `D1:60:E2:DE:4E:56:CB:10:B6:6C:1C:B0:AD:CB:79:CF:93:C7:8D:CD:9D:B3:0C:20:18:22:02:62:C0:40:63:F9` | 2029-06-23 |

Lokalt adapterprov med kodens TLS-kedja: Hedemora 1 avbrott, Linde 0 avbrott, 0 skipped.
Från podden bekräftades ursprungligt curl 60, men nya koden har inte lagts där och är
**inte verifierad från podden**. Ingen produktionsfil eller global certifikatmiljö har ändrats.

## Täckning, Fas 1

Migration `0017_utility_coverage_gaps.sql` skapar tenantbundna lucksignaler vid fastighetsändringar.
Den är endast provad i `fastighetsradar_test`. Läsning av täckning fungerar utan tabellen;
skrivning av signalen uteblir tills migreringen är gjord. Rapporterna räknas alltid från aktuell
källa/nätgeometri, inte från en gammal lucksignal. Ett `partial`-svar räknas konservativt som
otillräckligt för att säga "Bevakas". Nästa kompletta, lyckade hämtning återställer täckningen.

Tenantbundet API: `GET /v1/utility-coverage`, även via BFF `/api/app/utility-coverage`.
Samma rapport följer portföljen och visas i bevakningsstatus på dator och mobil.
Signalloggen innehåller bara operatör, nyttighet, anledning och antal, aldrig adresser eller fastighets-id.

## Ägarens arbetsordning

1. Granska grenen och beslut i slutrapporten. Gör en ren installation (`npm ci`) och bygg i egen releasekatalog.
2. Kör migreringarna genom befintlig checksummad migreringsrutin. Ändra inte redan tillämpade filer.
3. Behåll nya käll-/nyttighetsflaggor av och SMS_MODE simulerat tills varje separat källa verifierats.
4. Ordna eventuell svensk proxy, testa allowlist och ange servervariabeln ovan genom vanlig secrets-hantering.
5. Efter ägarens deployment: kontrollera per-operatörens lyckade hämtning och täckningsrapport,
   prov med syntetisk fastighet inom/utanför ytan och simulerat SMS, inklusive fel-/stale-läge.

Lokala byggprov använder delade externa beroenden via junctions. Turbopack accepterar inte dessa
utanför worktree-roten; `next build --webpack` passerar men dess standalone-spårning varnar om
externa junction-filer. Dessa lokala artefakter får inte användas som deploypaket.
En ren installation utan externa junctions krävs inför release.

## Nya elnät, Fas 2

Samtliga kräver `SOURCE_UTILITY_OUTAGES_ENABLED=true` och dessutom sin egen flagga:

| Operatörs-id | Flagga (default false) |
|---|---|
| `oresundskraft` | `SOURCE_UTILITY_ORESUND_ENABLED` |
| `kraftringen_elnat` | `SOURCE_UTILITY_KRAFTRINGEN_ENABLED` |
| `umea` | `SOURCE_UTILITY_UMEA_ENABLED` |
| `skekraft` | `SOURCE_UTILITY_SKEKRAFT_ENABLED` |

Om `UTILITY_OUTAGE_OPERATORS` är en uttrycklig lista måste id:t också finnas där.
En tom lista aktiverar fortfarande bara befintliga operatörer; de fyra nya kräver egna flaggor.
Ingen av dessa fyra behöver svensk proxy enligt poddproven. Ingen ny migrering i Fas 2.
Efter aktivering måste varje jobb ha en komplett lyckad hämtning innan adresser räknas som bevakade.

## Vatten-/gasgrund, Fas 3

- Migration `0018_water_supply_outages.sql`: `water` i nyttighetsvillkoret, `notice_kind` med
  avbrott/information/kokning/vattenrestriktion och separat kategori `WaterSupply`.
- `SOURCE_UTILITY_WATER_ENABLED=false` spärrar alla nya VA-profiler.
- `SOURCE_UTILITY_GAS_ENABLED=false` spärrar Göteborgs nya gaslager, även när el/värme redan hämtas.
- Utility-flaggor filtrerar både hämtning och visning. Komplett hämtning avslutar bara de nyttigheter
  som faktiskt ingick, så avstängd VA inte av misstag räknas som återställd av ett eljobb.
- Kvittering: vanliga exakta avbrott enligt befintliga regler; kokning alltid vid publicerad områdesträff;
  generiska VA-notiser/restriktioner aldrig. Vatten-SMS införs separat i Fas 5 och gas-SMS i Fas 6.
- Ritad ServiceAlert-yta kan visas som information. Rena adresspunkter utan ritad yta är ännu inte
  tillräckliga för en exakt avbrottsyta och gör svaret partial. Det gäller bland annat aktuella VA-poster
  hos Eskilstuna och Göteborg. Ingen "Bevakas" från ett sådant partial-svar.
