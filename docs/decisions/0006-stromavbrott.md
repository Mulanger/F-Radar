# ADR 0006 – Strömavbrott från nätbolagens avbrottskartor

**Status:** Godkänd av produktägaren 2026-11-14. Genomförs enligt
[`docs/plans/stromavbrott.md`](../plans/stromavbrott.md), en fas i taget. Fas 1 implementerad 2026-11-14.

## Bakgrund

Det finns inget officiellt, öppet API för strömavbrott i realtid i Sverige. Energimarknadsinspektionen
publicerar bara årlig statistik. Nätbolagens publika avbrottskartor hämtar däremot JSON/KML utan nyckel,
och de flesta mindre nätbolag använder några få kartplattformar (Digpro, Trimble, ServiceAlert). Kunderna
vill få veta om planerade avbrott i förväg och om oplanerade avbrott direkt – men **bara** när deras
fastighet faktiskt berörs.

## Beslut

1. **Källa:** `utility_outages` (data class `UTILITY_OUTAGE`, kategori `Power`). Ett insamlingsjobb per
   nätbolag (`utility_outages:<operatorId>`) var 5:e minut (min 120 s), så att ett trasigt flöde bara gör
   *det* nätbolagets fastigheter "Ej bedömd". Avstängd som standard (`SOURCE_UTILITY_OUTAGES_ENABLED`);
   enskilda nätbolag kan stängas av via `UTILITY_OUTAGE_OPERATORS` utan driftsättning.
2. **Precision per fastighet** (inte per avbrott):

   | Matchning | Villkor | Nivå |
   |---|---|---|
   | `outage_polygon` | Fastighetens punkt inom avbrottets polygon | Hög (Medel om positionen är ungefärlig) |
   | `outage_address` | Gata + husnummer i nätbolagets lista (Fas 4) | Hög |
   | `outage_street` | Gatan nämns utan husnummer (Fas 4) | Medel |
   | `outage_adjacent` | ≤ 25 m utanför polygonen | Låg – bara fastighetspanelen |
   | `outage_point` | Punkt-avbrott ≤ 30 m | Låg – bara fastighetspanelen |
   | `outage_postal_area` / `outage_area` | Postnummer-/driftområde (Fas 2–3) | Område |

   Positionen räknas som bekräftad när geokodningen är `building` eller punkten satts/justerats manuellt.
3. **Färg och status:** oplanerat pågående med hög precision = **röd** (`critical`) i händelseflödet och
   fastighetsstatus; planerat pågående eller medelprecision = orange; publicerat planerat avbrott = blå i
   flödet utan att ändra dagens status; återställt = grön. Fastighetsstatusen är nu
   *högsta av officiell varning och bekräftat avbrott* (`statusMethod: highest_official_warning_or_outage`).
   Avbrottskällans hälsa gör aldrig status `unknown`.
4. **SMS (anti-spam):** endast hög precision; aldrig område/närhet/punkt; aldrig typ `unknown`. Ett
   start-SMS per avbrott och mottagare; ändrat kundantal ger aldrig nytt SMS. "Strömmen är tillbaka" och
   ändringar skickas bara till mottagare som fått ett tidigare SMS om samma avbrott och stoppas inte av
   regelns frekvensgräns. Påminnelse kl 18–21 kvällen före ett planerat avbrott som publicerats ≥ 24 h före.
   Oplanerat avbrott räknas som nödläge för regelns undantag från tysta timmar.
5. **"Inga registrerade avbrott"** visas bara när fastigheten ligger i ett bevakat nätbolags nätområde och
   flödet är aktuellt. Annars "Ej bedömd", "Nätet bevakas inte ännu" eller "Nätbolaget är okänt".
   Matchningen av avbrott är rent geografisk och beror inte på nätområden.
6. **Livscykel:** versionen ändras bara av läge/typ eller väsentlig tidsändring (planerat fönster avrundat
   till 15 min, beräknat klart till 30 min). Ett avbrott som saknas i **två kompletta** hämtningar i rad
   avslutas; ett misslyckat eller ofullständigt svar avslutar aldrig något. Explicit `restored` från
   nätbolaget avslutar direkt.
7. **Språk (ADR 0003):** våra texter är beskrivande ("Oplanerat strömavbrott registrerat av …"); aldrig
   "kris", "fara", "akut" och aldrig "fastigheten saknar ström". Nätbolagets text visas ordagrant och
   attribueras.
8. **Riskindex:** påverkas inte förrän produktägaren godkänt en egen faktor (Fas 5).

## Tillägg Fas 2 (2026-11-14)

9. **Områdesträffar** (Ellevios postnummerområden, Trimbles driftområden) visas i händelseflödet först när
   avbrottet berör **minst 25 kunder** (`AREA_FEED_MIN_CUSTOMERS`); mindre avbrott (ofta en enda kund i ett
   postnummer med tusentals adresser) visas bara under "I närheten" i fastighetspanelen. Aldrig SMS.
10. **Nätområden** kommer från Energimarknadsinspektionens nationella datamängd (CC0, ungefärliga gränser),
    importerad veckovis. Bolag vi inte bevakar visas med namn ("Nätet bevakas inte ännu – … Kraftringen Nät AB").
    Täcker två olika nätbolags områden samma adress visas "Osäkert nätbolag" i stället för "Inga registrerade avbrott".
11. Ellevios `affected_site_total_count` är avbrottets totala antal berörda, inte postnummerområdets – inga
    "x av y"-andelar visas.

## Tillägg Fas 3–4 (2026-11-14)

12. **E.ON** och **ServiceAlert** ger områdesprecision (nätstationsområden respektive operatörsritade cirklar);
    aldrig SMS. ServiceAlert saknar starttid – läge "okänt", och ett försvunnet meddelande beskrivs som
    "visas inte längre", aldrig som "tillbaka".
13. **Fjärrvärme och fjärrkyla** följer samma färg-, status- och SMS-regler som el. SMS-regeln väljer
    nyttigheter (el, fjärrvärme, fjärrkyla).
14. **Adresslistor:** en träff på gata + husnummer i nätbolagets lista (inom operatörens adressområde) är hög
    precision oberoende av kartnålen; en gata utan husnummer ger medelprecision (ingen SMS). Gatunamn matchas
    exakt efter normalisering – ingen fuzzy-matchning.

## Konsekvenser

- Flödena är odokumenterade och kan ändras; adaptrarna validerar allt och hoppar över det som inte går
  att tolka (`partial`). Okända statuskoder loggas och visas aldrig som SMS.
- Täckningen är begränsad till implementerade nätbolag; resten visas ärligt som inte bevakade.
