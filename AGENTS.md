# Instruktioner för AI-agenter

Den här filen gäller alla agenter som arbetar i projektet (Codex, Claude med flera). Läs den först.

## Projektet i korthet

FastighetsRadar är en betald premiumtjänst (ca 18 000 kr/år) där fastighetsägare bevakar väder, elavbrott
och störningar i vatten och avlopp vid sina adresser. Live: https://f-radar.fr-2.instapods.app

- `apps/web` – Next.js 16 (App Router) med Clerk-inloggning. Next 16 skiljer sig från äldre versioner:
  läs `node_modules/next/dist/docs/` innan du skriver Next-kod.
- `apps/api` – Fastify-API (`/v1`) med schemaläggare som hämtar data.
- `packages/domain` (zod-scheman, format, demodata), `packages/integrations` (datakällor),
  `packages/db` (PostGIS-migreringar), `packages/config`.

Läs vid behov: [`README.md`](README.md), [`IMPLEMENTATION.md`](IMPLEMENTATION.md),
[`docs/implementation-progress.md`](docs/implementation-progress.md) (vad som är gjort),
`docs/plans/` (planer), `docs/decisions/` (beslut), [`docs/sources.md`](docs/sources.md),
[`docs/outage-operations.md`](docs/outage-operations.md) och `docs/legal/`.

## Om ägaren

Ägaren är inte tekniker.

- Skriv på enkel svenska, kort och utan facktermer. Ta ett steg i taget.
- Ge raka svar. Svara ja eller nej först, förklara sedan.
- Förklara vad du gjort och vad som återstår. Undvik långa tabeller.
- Planer skrivs som fasindelade `.md`-filer i `docs/plans/`, utan tidsuppskattningar.

## Produktregler

- Allt kunden ser ska kännas proffsigt. Visa aldrig intern information för kunden, som täckningsluckor,
  datakvalitet, "ej bedömd" eller "inte undersökt". Tjänstens begränsningar står i avtalet, inte på skärmen.
- Vi erbjuder väder, el och vatten/avlopp. Fjärrvärme, kyla och gas är dolda för kunden. Tele och bredband
  är inte byggt.
- En fastighets position ska bekräftas av kunden innan den sparas. Visa den inte senare som "ungefärlig".
- Portföljkartan visar alltid SMHI:s regnradar. Den har inga lagerknappar och inget översvämningslager.
  Översvämningsrisken ingår i fastighetens riskbedömning.
- Ställ frågan "skulle en betalande kund av en premiumtjänst vilja se det här?" innan du ändrar något som
  kunden ser.

## Arbetsregler

- **Ingen commit, push eller utläggning utan ägarens uttryckliga ja.** Om inget annat sägs lämnar du
  ändringarna osparade och rapporterar vad du gjort, så granskas de innan de sparas.
- Visa ändringar som syns för kunden på localhost och vänta på ägarens godkännande innan de sparas.
- Kontakta aldrig företag, kommuner eller myndigheter.
- Skriv aldrig ut hemligheter, till exempel `.env`, `INSTAPOD_TOKEN`, Clerk-nycklar eller databasadresser.
- Produktionsdatabasen `fastighetsradar`: skriv aldrig till den. Läs bara sammanställda siffror, aldrig namn,
  adresser eller telefonnummer. Tester mot riktig databas körs mot `fastighetsradar_test`.
- Serverns inställningar (`/etc/instapods/app.env`) ändras bara efter ägarens ja, med säkerhetskopia först.
  SMS ska förbli simulerade.
- Flera agenter delar mappen `D:\F-Radar` och dess worktrees. Gör aldrig stash, reset eller byte av gren i
  någon annans mapp. Spara bara dina egna filer.

## Kontroller

Kör från repots rot innan du rapporterar att något är klart:

```bash
npx vitest run
npx eslint .
npm run typecheck
```

Ändringar i API eller databas testas också mot riktig databas på servern (körs i bakgrunden, tar några minuter):

```bash
node node_modules/tsup/dist/cli-default.js --config tsup.deploy.config.ts && node scripts/run-real-db-tests.mjs
```

## Utläggning till servern

Lägg **bara** ut med projektets verktyg `scripts/deploy-pod.mjs`. Det bevarar serverns inställningar, kör
databasmigreringar, söker efter läckta hemligheter, sparar förra versionen som `app.prev` och rullar tillbaka
automatiskt om något går fel.

Gör aldrig något av följande:

- ladda upp eller packa upp filer för hand;
- ändra filer i `/home/instapod/app` för hand;
- ta bort `/home/instapod/app/.env`, eftersom verktyget läser serverns inställningar därifrån;
- ändra Clerk- eller SMS-inställningar i samband med en utläggning.

Gör så här, efter ägarens ja:

1. Spara allt med commit. Snabbspola utläggningsgrenen `deploy/live-stromavbrott` till din commit. Versionen
   som körs nu (i `/home/instapod/app/RELEASE`) måste finnas i historiken bakåt.
2. Lägg ut från en ren separat worktree med `git checkout --detach`. Huvudmappen har ofta andras osparade
   ändringar.
3. Säkerhetskopiera den worktreens `.env` och ta bort raderna som börjar med `NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY`,
   `CLERK_SECRET` och `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Lägg tillbaka `.env` efteråt.
4. Kör från **PowerShell**, inte Git Bash, där tar-steget misslyckas: `node scripts\deploy-pod.mjs`
5. Kontrollera efteråt:
   - att `/home/instapod/app/RELEASE` visar din commit;
   - att webben svarar 200;
   - att `NRestarts` för tjänsten `app` är 0;
   - att `journalctl -u app` inte visar nya fel.

Serverkommandon körs med `node scripts/instapods.mjs exec -- sh -c '…'`. I Git Bash behöver du skriva
`MSYS_NO_PATHCONV=1` först.
