# Juridik – status och vad som återstår

Implementerat efter *FastighetsRadar – Juridikpaket, Policytexter & Implementationsguide* (2026-11-21).
Texterna är utkast och ersätter inte juridisk rådgivning – låt gärna en IT-/affärsjurist granska
särskilt ansvarsbegränsningen (villkor § 8) och PUB-avtalet innan större företagsavtal tecknas.

## 1. Fyll i företagsuppgifterna (ett ställe)

Alla uppgifter läses från **`apps/web/lib/legal/company.ts`** (`LEGAL_COMPANY`). Så länge ett värde är
`null` visas platshållaren (t.ex. `[ORG_NR]`) på sajten, så att det syns vad som saknas.

| Platshållare | Fält i `LEGAL_COMPANY` | Syns i | Status |
| :--- | :--- | :--- | :--- |
| `[FÖRETAGSNAMN]` | `companyName` | Sidfot, villkor, integritetspolicy, PUB-avtal, PDF-sidfot | Saknas |
| `[ORG_NR]` | `orgNumber` | Sidfot, villkor, integritetspolicy, PUB-avtal | Saknas |
| `[MOMS_NR]` | `vatNumber` | (förberett – används när fakturor skickas) | Saknas |
| `[GATUADRESS]` | `streetAddress` | Sidfot, villkor, integritetspolicy | Saknas |
| `[POSTNR_ORT]` | `postalTown` | Sidfot, villkor, integritetspolicy | Saknas |
| `[SÄTE]` | `seat` | Villkor § 11.2 (tingsrätt) | Saknas |
| `[DOMÄN]` | `domain` | Villkor, integritetspolicy, cookies, PDF-sidfot | Saknas – tills vidare visas sajtens egen adress (`APP_URL` / webbläsarens adress) |
| `[SUPPORT_EPOST]` | `supportEmail` | Sidfot, villkor (kontakt, uppsägning) | Saknas |
| `[JURIDIK_EPOST]` | `legalEmail` | Integritetspolicy | Saknas |
| `[FAKTURA_EPOST]` | `billingEmail` | (förberett) | Saknas |
| `[HOSTING_LEVERANTÖR]` | `hostingProvider` | Integritetspolicy § 3 | Saknas – i dag körs appen och databasen på InstaPods (region fr-2) |
| `[SMS_LEVERANTÖR]` | `smsProvider` | Integritetspolicy § 3 | Ifyllt: **46elks AB (Sverige)** – den enda SMS-integrationen i koden. Ändra om ni byter. |
| `[FAKTURA_LEVERANTÖR]` | `billingProvider` | Integritetspolicy § 3 | Saknas |
| `[ANALYSVERKTYG]` | – | Behövs inte: ingen analys används (se 3) | – |
| `[DATUM]` | `LEGAL_VERSIONS` i `packages/domain/src/legal.ts` | Alla dokument | **2026-11-21** |
| F-skatt | `fSkatt` (`true` visar ”Godkänd för F-skatt” i sidfoten) | Sidfot | Ej angivet |

`[FÖRETAGSNAMN_KUND]` och `[KUND_ORG_NR]` (fakturagodkännandet) fylls i automatiskt från kundens
organisationsnummer i beställningsdialogen.

## 2. Vad som är byggt

- **Sidor** (publika, med samma sidhuvud/sidfot som startsidan): `/villkor`, `/integritetspolicy`,
  `/cookies` (variant A), `/pub-avtal` (med *Skriv ut / Spara som PDF*) och `/datakallor`.
  Texterna finns i `apps/web/components/legal/documents/`.
- **Sidfot** på alla publika sidor: kolumnen Juridik, företagsraden och käll-/kartraden (Del 4.1).
  Inloggnings- och registreringssidornas sidfot länkar till villkor, integritetspolicy och datakällor.
- **Registrering:** obligatorisk kryssruta med texten i Del 4.2 (länkar öppnas i ny flik). Version och
  tidpunkt sparas på Clerk-användaren och kopieras till organisationen när den skapats
  (`organizations.terms_version`, `terms_accepted_at`, `privacy_version`, `privacy_accepted_at`,
  `legal_accepted_by_user_id` – migration `0022_legal_acceptance.sql`, API `GET/POST /v1/legal/acceptance`).
  Organisationer som saknar godkännande (konton från före villkoren, eller när en ny version
  publiceras) får en engångsdialog för en administratör i översikten.
- **Ny version av villkoren:** ändra datumet i `LEGAL_VERSIONS` (`packages/domain/src/legal.ts`).
  Administratörer ombeds då godkänna igen.
- **SMS-mottagare:** texterna i Del 4.3. Tidpunkt för samtycke (`sms_recipients.consent_at`) och vem
  som lade till numret (`sms_recipients.created_by`) sparades redan. Gallringen efter 30 dagar körs
  av jobbet `sms_notifications` var 30:e sekund (`NotificationService.cleanup`).
- **Fotnoter:** Riskindex-fotnoten (Del 4.4) under *Så räknas poängen* på desktop och mobil, och
  sidfoten i PDF-exporten av Kvitteringar.
- **Kartattribuering:** kontrollerad – Geoapify, OpenMapTiles och OpenStreetMap visas i alla kartor
  (Portföljkarta, Närområde, adressväljaren och händelsekartan, där den står i kortet nedtill).
- **Fakturabeställning:** godkännandet i Del 4.5 i beställningsdialogen på `/priser`.

## 3. Cookies – variant A, ingen banner

Inventering 2026-11-21: inga analys-, reklam- eller tredjepartsskript (inget Google Analytics,
Tag Manager, Meta Pixel, Hotjar eller Intercom). Det som används är strikt nödvändigt:
Clerks inloggningscookies, `fr_session_alive` (”Kom ihåg mig” avbockad) samt lokal lagring
(`fr-ephemeral-session`, `fr-signup-email`, `fr-view:*`). Därför visas ingen cookie-banner.
**Lägger ni till analys eller spårning måste ni först bygga en banner som blockerar skripten
tills samtycke ges och byta `/cookies` till variant B** (se juridikpaketet, Del 2 § 7).

## 4. Manuella steg (kan inte göras i koden)

1. **Clerk produktionsläge:** byt från *Development mode* till produktionsnycklar innan lansering.
2. **Clerk applikationsnamn:** ändra från ”F-radar” till ”FastighetsRadar” i Clerk Dashboard
   (syns i texten *”för att fortsätta till F-radar”*).
3. **Juridisk granskning** av texterna innan större företagsavtal.

## 5. Öppen fråga: avbrottsdata från kommersiella bolag

Juridikpaketet (Del 2 § 6) säger att inga skarpa hämtningar ska göras mot kommersiella el-,
fjärrvärme- och vattenbolag utan API-avtal. **I dag hämtar produktionen sådan data** – från bolagens
publika störningskartor (bl.a. Ellevio, Vattenfall, E.ON, Stockholm Exergi, Stockholm Vatten och
Avfall och ServiceAlert-kommuner), påslaget i `scripts/deploy-policy.mjs` (2026-11-14 och 2026-11-19).
Det är inte ändrat. Beslut behövs: behålla (och i så fall säkra tillstånd/villkor per bolag) eller
stänga av `SOURCE_UTILITY_*` tills avtal finns. Sidan `/datakallor` nämner i dag källan som
”Nät- och energibolag”.
