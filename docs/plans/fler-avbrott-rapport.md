# Fler avbrott – arbetsrapport (pågår)

Gren: `codex/avbrott-hela-landet`, egen worktree från `e9945d5`.
Senaste färdiga fascommit: `03417d8` (Fas 2). Inte pushat ännu. Inget deployat eller aktiverat.
SMS_MODE är oförändrat.

## Beslut jag tog

- Följde ägarens senare instruktioner: inget serverinköp, ingen produktionsändring, ingen Fas 7-implementation.
- Proxy är HTTPS CONNECT, autentiserad/IP-begränsad och värdlåst; ingen TLS-interception.
  En svensk proxy rekommenderas, men driftleverantör och kostnad lämnas till ägaren.
- Vatten och avlopp blir gemensam `water`, eftersom de verifierade VA-profilerna inte skiljer dem säkert.
  Kategorin `WaterSupply` skiljs från hydrologins `Water`.
- Gas använder kategorin `Heating` och befintlig brandikon. Ny gasinsamling kräver egen avstängd flagga.
- Behöll riskfaktorns namn **El och värme** och dess nuvarande nyttigheter. Vatten får händelser/status,
  men räknas inte in i denna faktor innan ett senare byte av namn och omfattning. Namnet är en konstant.
- Kokningsrekommendationers domänregler följer §2.3: rött inom publicerat område, kvittering,
  exakt och bekräftad träff för SMS; inget påstående om upphörande när meddelandet bara försvinner.
  Klassificering och vatten-SMS färdigställs i Fas 5.
- VA-meddelanden utan säker avbrottstyp/tider blir information: blått, ingen status, kvittering eller SMS.
  Utgångstid för meddelandet används inte som påhittad avbrottstid.
- Koordinatlistor utan publicerad avbrottsyta gör inte en polygon: ingen konvex hull, radie eller geokodning
  gissas. Sådana igenkända meddelanden räknas som skipped/partial, inte som ett friskt tomt svar.
- Nya elnät kräver separata opt-in-flaggor, även när den globala operatörslistan är tom.
- Okända Skellefteå-statusar ger inget SMS. Aktiv Umeå-el saknades vid provet; ändringsfallen testas syntetiskt
  med enum som verifierats i den publika kartkoden.
- Gamla Ei-placeholder-id:n löses på lässidan med exakt bolagsnamn; ingen produktionsdata behöver skrivas om.
- Ett avstängt nyttighetslager får inte avslutas av nästa hämtning av andra nyttigheter hos samma operatör.
- ServiceAlert tas bort utan återställningsantagande; att texten försvinner bevisar inte att leveransen
  eller en kokningsrekommendation har återställts/upphört.
- Telekomtyper/adaptrar byggs inte när ägaren uttryckligen valt bort Fas 7.

## Ägarbeslut och tillåtna undantag

- Ägaren tillät `scripts/run-real-db-tests.mjs` mot endast `fastighetsradar_test` och uppladdning
  till `/home/instapod/fr-ci`; inga andra poddskrivningar. Databasen kontrolleras före varje körning
  med SELECT mot pg_stat_activity; bara en körning åt gången.
- Ägaren valde proxy-stöd utan att skaffa proxy, behållet risknamn, kokning enligt §2.3,
  kommande avstängningar enligt §5.6 bakom default-false-flagga och endast kartläggning av telekom.

Slutrapporten kompletteras efter sista genomförbara fas med commitlista, flaggor/migreringar,
täckningsmått, källtabell, testantal och kvarstående risker.
