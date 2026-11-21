import Link from 'next/link';
import { Clause, Ph } from '../LegalText';

/** Dokument D – Personuppgiftsbiträdesavtal (PUB-avtal), bilaga till Användarvillkoren. */
export function DpaDocument() {
  return (
    <>
      <p>
        Detta personuppgiftsbiträdesavtal (”PUB-avtalet”) utgör en integrerad del av <Link href="/villkor">Användarvillkoren</Link> mellan
        Kunden (<strong>”Personuppgiftsansvarig”</strong>) och <Ph field="companyName" />, org.nr <Ph field="orgNumber" /> (<strong>”Personuppgiftsbiträdet”</strong>).
      </p>

      <h2 id="syfte">1. Syfte och behandlingens art</h2>
      <Clause no="1.1">För att tillhandahålla tjänsten FastighetsRadar behandlar Personuppgiftsbiträdet personuppgifter för den Personuppgiftsansvariges räkning.</Clause>
      <Clause no="1.2"><strong>Ändamål:</strong> Tillhandahålla inloggning i organisationens arbetsyta, visa kvitteringshistorik samt skicka konfigurerade aviseringar (inkl. SMS) om miljö-, väder-, vatten-, trafik- och samhällshändelser.</Clause>
      <Clause no="1.3"><strong>Kategorier av registrerade:</strong> Den Personuppgiftsansvariges anställda, fastighetsskötare, förvaltare, styrelsemedlemmar eller inbjudna entreprenörer.</Clause>
      <Clause no="1.4"><strong>Kategorier av personuppgifter:</strong> Namn, e-postadress, mobilnummer, roll i organisationen, tidsstämplar för kvitteringar samt teknisk logg över utskickade SMS (gallras automatiskt efter 30 dagar). Inga känsliga personuppgifter (artikel 9 GDPR) ska behandlas i Tjänsten.</Clause>

      <h2 id="instruktioner">2. Instruktioner och sekretess</h2>
      <Clause no="2.1">Personuppgiftsbiträdet får endast behandla personuppgifterna i enlighet med den Personuppgiftsansvariges dokumenterade instruktioner (vilka utgörs av Användarvillkoren samt Kundens aktiva inställningar i Tjänsten) om inte unionsrätt eller svensk lag kräver annat.</Clause>
      <Clause no="2.2">Personuppgiftsbiträdet säkerställer att all personal med tillgång till personuppgifterna omfattas av sekretessförbindelse.</Clause>

      <h2 id="sakerhet">3. Säkerhetsåtgärder</h2>
      <p>Personuppgiftsbiträdet ska vidta lämpliga tekniska och organisatoriska säkerhetsåtgärder enligt artikel 32 GDPR, däribland krypterad kommunikation (TLS/HTTPS), åtkomstkontroll och isolering mellan kundorganisationer, kryptering av data i vila, regelbundna säkerhetsuppdateringar samt automatisk gallring av aviseringsloggar.</p>

      <h2 id="underbitraden">4. Underbiträden och tredjelandsöverföring</h2>
      <Clause no="4.1">Den Personuppgiftsansvarige lämnar härmed ett generellt förhandstillstånd för Personuppgiftsbiträdet att anlita underbiträden för drift, autentisering och SMS-leverans. Aktuell förteckning över underbiträden finns i vår <Link href="/integritetspolicy#underbitraden">integritetspolicy</Link>.</Clause>
      <Clause no="4.2">Personuppgiftsbiträdet ska meddela den Personuppgiftsansvarige minst 14 dagar innan ett nytt underbiträde läggs till eller byts ut, varvid Kunden har rätt att invända på saklig grund.</Clause>
      <Clause no="4.3">Personuppgiftsbiträdet ansvarar för att underbiträden binds av motsvarande dataskyddsskyldigheter och att eventuell överföring utanför EU/EES sker med laglig överföringsgrund (DPF eller EU:s standardavtalsklausuler).</Clause>

      <h2 id="assistans">5. Assistans och personuppgiftsincidenter</h2>
      <Clause no="5.1">Personuppgiftsbiträdet ska bistå den Personuppgiftsansvarige vid förfrågningar från registrerade samt vid skyldigheter enligt artiklarna 32–36 GDPR.</Clause>
      <Clause no="5.2">Vid en konstaterad personuppgiftsincident som berör Kundens data ska Personuppgiftsbiträdet underrätta Kunden utan onödigt dröjsmål (och som mål inom 48 timmar från kännedom) med relevant information för Kundens bedömning och eventuell anmälan till IMY.</Clause>

      <h2 id="radering">6. Återlämnande, radering och granskning</h2>
      <Clause no="6.1">Vid avtalets upphörande ska Personuppgiftsbiträdet radera eller återlämna samtliga personuppgifter inom 60 dagar, om inte lag kräver fortsatt lagring.</Clause>
      <Clause no="6.2">Personuppgiftsbiträdet ska på begäran tillhandahålla den information som krävs för att visa att skyldigheterna i detta PUB-avtal efterlevs.</Clause>
    </>
  );
}
