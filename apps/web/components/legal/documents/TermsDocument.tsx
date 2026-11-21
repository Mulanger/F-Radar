import Link from 'next/link';
import { Clause, Email, Ph, SiteLink } from '../LegalText';
import css from '../legal.module.css';

/** Dokument A – Användarvillkor (B2B). */
export function TermsDocument({ domain }: { domain: string }) {
  return (
    <>
      <dl className={css.parties}>
        <dt>Leverantör</dt>
        <dd><Ph field="companyName" />, org.nr <Ph field="orgNumber" />, <Ph field="streetAddress" />, <Ph field="postalTown" /> (”Leverantören”, ”vi”, ”oss”).</dd>
        <dt>Kontakt</dt>
        <dd><Email field="supportEmail" /></dd>
      </dl>

      <h2 id="tillampning">1. Tillämpningsområde och B2B-avgränsning</h2>
      <Clause no="1.1">Dessa användarvillkor (”Villkoren”) gäller när en juridisk person, näringsidkare, bostadsrättsförening, kommunal verksamhet eller annan organisation (”Kunden”, ”ni”) skapar ett konto eller använder webbtjänsten <strong>FastighetsRadar</strong> på {domain} (”Tjänsten”).</Clause>
      <Clause no="1.2">Tjänsten tillhandahålls <strong>uteslutande för yrkesmässig användning (B2B)</strong>. Privatpersoner i egenskap av konsumenter har inte rätt att ingå avtal om Tjänsten. Konsumentköplagen och distansavtalslagens regler om ångerrätt är därmed inte tillämpliga.</Clause>
      <Clause no="1.3">Den fysiska person som registrerar kontot eller uppgraderar Tjänsten intygar att denne har behörighet att binda Kunden till dessa Villkor.</Clause>

      <h2 id="tjansten">2. Beskrivning av Tjänsten</h2>
      <Clause no="2.1">FastighetsRadar är ett digitalt <strong>informations- och beslutsstöd</strong> som sammanställer och visualiserar offentliga samt externa miljö-, väder-, vatten-, trafik- och samhällsdata kopplade till de adresser och kartpositioner som Kunden själv registrerar i Tjänsten.</Clause>
      <Clause no="2.2">Tjänsten inkluderar, beroende på vald prisnivå, portföljöversikt, riskindikatorer (Riskindex), händelseflöde, kvitteringslogg med PDF-export samt konfigurerbara aviseringar (inklusive SMS).</Clause>
      <Clause no="2.3">Leverantören har rätt att löpande utveckla, uppdatera och förändra Tjänstens funktioner, gränssnitt och ingående datakällor.</Clause>

      <h2 id="ansvarsfriskrivning">3. Viktig ansvarsfriskrivning – ej säkerhetsklassat larmsystem</h2>
      <Clause no="3.1"><strong>Informationsstöd, inte kritiskt larm:</strong> Tjänsten är ett komplement och beslutsstöd för fastighetsförvaltning och fastighetsskötsel. Tjänsten är <strong>inte</strong> ett säkerhetsklassat larm-, skydds- eller nödsystem och får inte användas som enda beslutsunderlag för att skydda liv, hälsa eller egendom.</Clause>
      <Clause no="3.2"><strong>Externa datakällor:</strong> Tjänsten bygger på data från tredje part (såsom SMHI, Krisinformation, Trafikverket, SGU, MCF, SCB, MET Norway samt kart- och geokodningstjänster). Leverantören ansvarar inte för riktigheten, fullständigheten, aktualiteten eller tillgängligheten i externa myndigheters eller leverantörers data, API:er eller mätstationer.</Clause>
      <Clause no="3.3"><strong>Egna beräkningar och adresspositioner:</strong> Sammanvägda indikatorer (såsom Riskindex) är Leverantörens egna modellberäkningar baserade på tillgängliga datakällor och utgör inte officiella myndighetsbedömningar. Adresspunkter och kartpositioner hämtas från externa geokodningstjänster och utgör inte juridiska fastighetsgränser. Kunden ansvarar själv för att kontrollera att placerad nål motsvarar rätt fastighet.</Clause>
      <Clause no="3.4"><strong>Ingen garanti för SMS-leverans:</strong> Leverans av SMS beror på externa teleoperatörer, mobiltäckning, mottagarens telefoninställningar samt Kundens egna regelinställningar (inklusive tysta timmar och maxgränser per dag). Leverantören kan därför inte garantera att varje enskilt SMS levereras i realtid eller alls.</Clause>
      <Clause no="3.5"><strong>Kundens egen beredskap:</strong> Kunden ansvarar alltid själv för att följa officiella myndighetskanaler (t.ex. Sveriges Radio P4, Krisinformation.se och SMHI) samt för att vidta nödvändiga fysiska och operativa åtgärder vid väder-, vatten- eller krishändelser.</Clause>

      <h2 id="konton">4. Konton, användare och SMS-mottagare</h2>
      <Clause no="4.1">Kunden ansvarar för all aktivitet som sker inom Kundens organisation i Tjänsten samt för att inloggningsuppgifter hanteras säkert.</Clause>
      <Clause no="4.2">Kunden ansvarar för att varje person vars mobilnummer registreras för SMS-aviseringar har informerats om utskicken och att Kunden har rättslig grund och behörighet att registrera numret i Tjänsten.</Clause>
      <Clause no="4.3">Tjänsten får inte användas för automatiserad massinsamling (scraping), vidareförsäljning av rådata i strid med datakällornas licenser eller för att skicka obehöriga SMS. Leverantören har rätt att omedelbart spärra eller begränsa SMS-utskick vid misstänkt missbruk.</Clause>

      <h2 id="priser">5. Priser, abonnemang och fakturering</h2>
      <Clause no="5.1">Aktuella medlemskapsnivåer, fastighetsgränser, inkluderade SMS-kvoter och priser anges på <SiteLink domain={domain} path="/priser" />. Samtliga priser anges i svenska kronor (SEK) <strong>exklusive moms</strong>.</Clause>
      <Clause no="5.2"><strong>Gratisnivå och provperiod:</strong> Leverantören kan erbjuda en kostnadsfri nivå eller tidsbegränsad provperiod med begränsade funktioner (t.ex. max antal fastigheter och SMS i testläge). Leverantören förbehåller sig rätten att ändra eller avsluta gratisnivån med 30 dagars förvarning.</Clause>
      <Clause no="5.3"><strong>Fakturering och betalningsvillkor:</strong> Betalda abonnemang faktureras i förskott per avtalad avtalsperiod (normalt årsvis) mot angivet organisationsnummer, med <strong>30 dagars betalningsvillkor</strong> från fakturadatum om inte annat avtalats. Kunden ansvarar för att ange korrekt fakturaadress, eventuell e-fakturaadress (Peppol) och fakturareferens.</Clause>
      <Clause no="5.4"><strong>Dröjsmål och paus av tjänst:</strong> Vid försenad betalning utgår lagstadgad påminnelseavgift, förseningsersättning (450 kr enligt lagen om ersättning för inkassokostnader) samt dröjsmålsränta enligt räntelagen. Om betalning inte inkommit inom 10 dagar efter skriftlig påminnelse har Leverantören rätt att tillfälligt pausa skarpa SMS-utskick och/eller begränsa åtkomsten till kontot tills full betalning skett.</Clause>
      <Clause no="5.5"><strong>Extra SMS-förbrukning:</strong> Om Kunden överskrider den SMS-kvot som ingår i vald prisplan gäller vid var tid angivet tilläggspris per SMS-del eller påfyllningspaket, alternativt pausas ytterligare utskick tills ny period inleds enligt Kundens kontoinställningar.</Clause>
      <Clause no="5.6"><strong>Prisjusteringar:</strong> Leverantören har rätt att justera priser inför nästkommande avtalsperiod genom skriftligt meddelande via e-post minst 30 dagar före förlängning.</Clause>

      <h2 id="avtalstid">6. Avtalstid och uppsägning</h2>
      <Clause no="6.1">Ett betalt abonnemang löper under den valda avtalsperioden (t.ex. 12 månader) och förlängs automatiskt med motsvarande period om det inte sägs upp senast <strong>30 dagar före periodens utgång</strong>.</Clause>
      <Clause no="6.2">Uppsägning sker skriftligen via e-post till <Email field="supportEmail" /> eller direkt i kontoinställningarna i Tjänsten. Redan erlagd eller fakturerad avgift för innevarande avtalsperiod återbetalas inte.</Clause>
      <Clause no="6.3">Efter avtalets upphörande raderas eller anonymiseras Kundens lagrade data inom rimlig tid (normalt inom 30–60 dagar), om inte lag kräver längre lagring (t.ex. bokföringsunderlag). Kunden ansvarar själv för att exportera eventuella PDF-rapporter över kvitteringar före avslut.</Clause>

      <h2 id="immateriella-rattigheter">7. Immateriella rättigheter</h2>
      <Clause no="7.1">Samtliga rättigheter till Tjänstens programvara, design, varumärke, riskmodeller och dokumentation tillhör <Ph field="companyName" /> eller dess licensgivare. Kunden erhåller en icke-exklusiv, tidsbegränsad rätt att använda Tjänsten under avtalstiden.</Clause>
      <Clause no="7.2">Kunden behåller full äganderätt till de uppgifter Kunden själv lägger in i Tjänsten (t.ex. fastighetslistor, egna namn, kvitteringar och regelkonfigurationer).</Clause>

      <h2 id="ansvarsbegransning">8. Ansvarsbegränsning</h2>
      <Clause no="8.1">Tjänsten tillhandahålls i befintligt skick (”as is”). Leverantören strävar efter hög tillgänglighet men garanterar inte avbrottsfri eller helt felfri drift.</Clause>
      <Clause no="8.2"><strong>Inga indirekta skador:</strong> Leverantören ansvarar under inga omständigheter för indirekta skador eller följdskador, inklusive men inte begränsat till fastighetsskador, vattenskador, stormskador, halkolyckor, utebliven vinst, produktionsbortfall, förlust av data eller krav från hyresgäster eller annan tredje part.</Clause>
      <Clause no="8.3"><strong>Beloppstak:</strong> Leverantörens sammanlagda skadeståndsansvar under ett kalenderår är begränsat till det totala belopp (exkl. moms) som Kunden faktiskt har betalat till Leverantören under de tolv (12) månader som närmast föregick den skadegörande händelsen. För användare på kostnadsfri nivå eller provperiod är Leverantörens skadeståndsansvar begränsat till 0 kr.</Clause>
      <Clause no="8.4">Ansvarsbegränsningarna gäller inte vid uppsåt eller grov vårdslöshet. Krav på skadestånd ska framställas skriftligen inom tre (3) månader från det att Kunden fick eller borde ha fått kännedom om grunden för kravet.</Clause>

      <h2 id="personuppgifter">9. Personuppgifter</h2>
      <Clause no="9.1">När Kunden registrerar användare och mobilnummer för SMS-aviseringar i sin organisation agerar Leverantören som personuppgiftsbiträde åt Kunden. Behandlingen regleras av vårt <Link href="/pub-avtal">personuppgiftsbiträdesavtal (PUB-avtal)</Link>, som utgör en integrerad del av dessa Villkor.</Clause>
      <Clause no="9.2">För de personuppgifter där Leverantören är personuppgiftsansvarig (t.ex. kundadministration och fakturering) gäller vår <Link href="/integritetspolicy">integritetspolicy</Link>.</Clause>

      <h2 id="force-majeure">10. Force majeure</h2>
      <p>Leverantören är befriad från påföljd för underlåtenhet att fullgöra förpliktelse enligt dessa Villkor om underlåtenheten beror på omständighet utanför Leverantörens rimliga kontroll, såsom driftstörningar hos myndigheter, el- eller teleavbrott, cyberattacker, myndighetsbeslut, naturkatastrofer eller arbetskonflikt.</p>

      <h2 id="andringar">11. Ändringar, tillämplig lag och tvist</h2>
      <Clause no="11.1">Leverantören får ändra dessa Villkor. Väsentliga ändringar meddelas via e-post eller i Tjänsten minst 30 dagar innan de träder i kraft. Fortsatt användning efter ikraftträdandet innebär att de nya Villkoren godkänns.</Clause>
      <Clause no="11.2">På dessa Villkor ska svensk lag tillämpas. Tvist med anledning av Villkoren ska i första hand lösas genom förhandling och i andra hand avgöras av svensk allmän domstol med <Ph field="seat" /> tingsrätt som första instans.</Clause>
    </>
  );
}
