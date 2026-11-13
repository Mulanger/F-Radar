# ADR 0003 – Riskindex v1 och återhållsam presentation

**Status:** Godkänd av produktägaren 2026-11-13. Ersätter demovärdet `demoRisk` (`unspecified_demo_value`).

## Bakgrund

Designen visar "Samlad fastighetsrisk" (0–100) med fem faktorer och "Portföljens riskpoäng".
IMPLEMENTATION.md (§1, §14.1, §20) förbjuder en poäng utan dokumenterad metod, så fälten har visat
"Ej bedömd". Det här beslutet är den metoden.

Produktkravet är **att inte överdriva**: poängen ska spegla sannolik påverkan på *byggnaden*, inte att
"något händer i närheten". Ett statiskt översvämningsscenario är inte en pågående översvämning, ett
regionalt myndighetsmeddelande är inte en kris vid fastigheten, och utomhusluft påverkar inte huset.

## Grundprinciper

1. **Bara officiella, aktuella varningar kan ge höga nivåer.** "Hög" kräver en röd SMHI-varning med
   direkt påverkan på byggnaden eller ett VMA som gäller fastighetens kommun. Statiska data, prognoser
   utan varning, trafik och luft kan aldrig ge mer än "Låg".
2. **Små saker summeras inte till en hög nivå.** Totalen kan aldrig hamna i ett högre band än den
   allvarligaste enskilda faktorn.
3. **Saknad data är aldrig 0.** En faktor vars källa inte är aktuell visas som "Ej bedömd". Kan
   varningskällorna (SMHI-varningar, Krisinformation) inte kontrolleras blir hela poängen "Ej bedömd".
4. **Våra egna texter är beskrivande.** Ord som "kris", "fara" eller "akut" används aldrig i texter vi
   genererar; alarmerande formuleringar kommer bara ordagrant från myndigheten.
5. **Spårbart.** Varje faktor anger källa och skäl. Metoden är versionerad (`fr_risk_index_v1`).

## Nivåer

| Poäng | Nivå | Färg |
|---|---|---|
| 0–24 | Låg | grön |
| 25–49 | Bevaka | blå |
| 50–74 | Förhöjd | orange |
| 75–100 | Hög | röd |

## Officiella varningsnivåer → poäng

En SMHI-varning ger poäng efter nivå: **gul 35 · orange 60 · röd 85**. Varningar som påverkar byggnaden
indirekt flyttas **ett steg ned** (röd 60 · orange 35 · gul 15). Varningar som inte berör byggnader på
land ger 0 och visas bara som information. Nivån "Meddelande" (Info) ger aldrig poäng.

| SMHI-varning (kod) | Påverkan | Faktor |
|---|---|---|
| Vind (WIND), Snöfall (SNOW), Åskoväder (THUNDER) | direkt | Väder |
| Regn (RAIN) | direkt | Vatten |
| Höga flöden (HIGH_FLOW), Högt vattenstånd (HIGH_SEALEVEL), Översvämning (FLOODING) | direkt om adresspunkten ligger i karterat översvämningsområde, annars ett steg ned | Vatten |
| Isbeläggning (BLACK_ICE), Höga temperaturer, Stark kyleffekt, Brandrisk (FIRE) | indirekt (människor, framkomlighet) | Väder |
| Vind på kalfjället, Medelvind till havs, Nedisning till havs, Lågt vattenstånd, Risk för vattenbrist | ingen | – |

Okända varningstyper behandlas som indirekta.

## Faktorer

| Faktor | Källa | Regel | Tak |
|---|---|---|---|
| **Väder** | SMHI-varningar, SMHI-prognos | Högsta varningspoäng enligt tabellen ovan. Utan varning: prognosbyar ≥ 21 m/s ger 15. | 85 |
| **Vatten** | SMHI-varningar, MCF:s översvämningskartering, SGU, SMHI-prognos | Statiskt: adresspunkten i 100-årsområde 12 · 200-årsområde 8 · högsta beräknade flöde 5; grundvatten ≥ 90:e percentilen för årstiden +5. Prognos ≥ 30 mm/24 h utan varning ger 12. Aktiv vattenvarning ger varningspoäng, +10 inom samma nivå om adresspunkten ligger i karterat område. | 20 utan varning, annars 95 |
| **VMA** | Krisinformation | VMA för fastighetens kommun (eller hela länet/landet) 75. VMA som bara gäller *andra* kommuner i länet 30. Övriga Krisinformation-nyheter är regional information och ger 0. | 75 |
| **Framkomlighet** | Trafikverket | Händelse med mycket stor påverkan ≤ 250 m 20 · stor påverkan ≤ 250 m 10 · övrigt ≤ 1 km 5. Påverkar tillträde, inte byggnaden. | 20 |
| **Luft (utomhus)** | Närmaste mätstation ≤ 25 km | Över miljökvalitetsnorm (NO₂ 90 µg/m³ timme, PM10 50 µg/m³, PM2,5 25 µg/m³) 10. Påverkar inte byggnaden. | 10 |

## Sammanvägning

`poäng = min(T + 0,1 · S, bandtak(T))`, där `T` är den högsta faktorns poäng och `S` summan av övriga.
`bandtak` är övre gränsen för bandet som `T` ligger i (24, 49, 74 eller 100). Ett vanligt viktat
medelvärde används inte eftersom det späder ut en röd varning till "låg".

**Portföljen:** medelvärdet av bedömda fastigheter, plus vilken fastighet som ligger högst.

## Status och formuleringar i övriga dashboarden

* **VMA-matchning:** ett VMA matchas mot fastighetens kommun när meddelandet listar kommunen eller
  saknar kommunlista (gäller hela länet). Ett VMA som listar *andra* kommuner i samma län matchas som
  `county` och ger status **Bevaka** i stället för Kritisk.
* **Krisinformation-nyheter** (inte VMA) kallas "länsinfo"/"regional information", aldrig "kris".
* **Statiska översvämningsscenarier** visas med scenarionamn (t.ex. "100-årsflöde") i neutral färg,
  aldrig som röd "Hög".
* **Trafikhändelser** färgas efter Trafikverkets egen påverkansgrad.

## Begränsningar och uppföljning

* MCF-karteringen täcker bara utvalda vattendrag; "inget karterat område" betyder inte att risk saknas.
* Poänghistorik ("+6 sedan igår", "Daglig riskbedömning") kräver en sparad poäng per dag – steg 2.
* Byggnadsdata (källare, takkonstruktion, våningsplan) saknas; när kunden anger dem kan v2 vikta vatten
  och vind per byggnad.
* Gränsvärdena ska ses över efter några månaders verklig drift.
