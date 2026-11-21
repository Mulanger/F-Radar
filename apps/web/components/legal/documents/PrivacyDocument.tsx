import Link from 'next/link';
import { Email, LegalTable, Ph } from '../LegalText';

/** Dokument B – Integritetspolicy (GDPR). */
export function PrivacyDocument({ domain }: { domain: string }) {
  return (
    <>
      <p>
        Denna integritetspolicy förklarar hur <Ph field="companyName" />, org.nr <Ph field="orgNumber" /> (”vi”, ”oss”) samlar in och behandlar
        personuppgifter när du besöker {domain}, skapar ett konto eller kontaktar oss.
      </p>

      <h2 id="ansvarig">1. Vem är personuppgiftsansvarig?</h2>
      <ul>
        <li>
          <strong>För kundrelation, kontoadministration, support, fakturering och webbplats</strong> är <Ph field="companyName" /> personuppgiftsansvarig.
          Adress: <Ph field="streetAddress" />, <Ph field="postalTown" />. E-post för integritetsfrågor: <Email field="legalEmail" />.
        </li>
        <li>
          <strong>För uppgifter som Kunden lägger in i sin arbetsyta</strong>, till exempel när en organisation lägger in anställdas, förvaltares
          eller styrelsemedlemmars mobilnummer och användarkonton, är <strong>Kunden</strong> personuppgiftsansvarig och vi agerar
          {' '}<strong>personuppgiftsbiträde</strong> enligt vårt <Link href="/pub-avtal">PUB-avtal</Link>.
        </li>
      </ul>

      <h2 id="behandlingar">2. Vilka personuppgifter behandlar vi, varför och hur länge?</h2>
      <LegalTable
        caption="Behandlingar av personuppgifter"
        columns={['Ändamål', 'Uppgifter', 'Rättslig grund', 'Lagringstid']}
        rows={[
          ['Skapa och administrera konto', 'Namn, e-postadress, krypterat lösenord/inloggnings-ID, organisationstillhörighet, tidpunkt och version för godkända villkor', 'Fullgörande av avtal / berättigat intresse (B2B-kontaktperson)', 'Så länge kontot är aktivt samt upp till 60 dagar efter avslut'],
          ['Skicka SMS-aviseringar och föra logg', 'Verifierat svenskt mobilnummer, samtyckesmarkering (tidpunkt och vem som lade till numret), aviseringslogg (tidpunkt, regel, status)', 'Fullgörande av avtal (enligt Kundens instruktion)', <>Mobilnummer tills det tas bort av Kunden. <strong>Aviseringsloggen (senaste 50 poster) gallras automatiskt efter 30 dagar.</strong></>],
          ['Kvitteringar av larm', 'Användarnamn/ID och tidsstämpel vid kvittering', 'Fullgörande av avtal', 'Under aktivt abonnemang tills Kunden raderar eller avslutar kontot'],
          ['Fakturering och bokföring', 'Organisationsnummer, företagsnamn, referensperson, faktura-e-post, transaktionshistorik', 'Rättslig förpliktelse (bokföringslagen)', '7 år efter utgången av räkenskapsåret'],
          ['Support och felrapportering', 'E-postadress, korrespondens och teknisk felsökningsdata', 'Berättigat intresse', 'Upp till 12 månader efter avslutat supportärende'],
          ['Säkerhet och drift', 'IP-adress, tekniska felloggar och sessionsdata', 'Berättigat intresse (IT-säkerhet)', 'Normalt 30–90 dagar i rullande säkerhetsloggar'],
        ]}
      />

      <h2 id="underbitraden">3. Underbiträden och tredjepartsleverantörer</h2>
      <p>Vi säljer aldrig personuppgifter. För att kunna leverera Tjänsten använder vi noggrant utvalda tekniska leverantörer (underbiträden):</p>
      <ul>
        <li><strong>Inloggning och kontohantering:</strong> Clerk, Inc. (USA) – hanterar autentisering och sessioner.</li>
        <li><strong>Drift, databas och hosting:</strong> <Ph field="hostingProvider" />.</li>
        <li><strong>SMS-utskick:</strong> <Ph field="smsProvider" /> – tar emot mobilnummer och meddelandetext för leverans av larm-SMS.</li>
        <li>
          <strong>Kartor och adressökning:</strong> Geoapify GmbH (Tyskland, EU) – används för adressökning och kartvisning. Inga uppgifter om
          SMS-mottagare skickas dit, endast sökta adresser och koordinater. Kartbilderna hämtas direkt av din webbläsare, vilket innebär att din
          IP-adress blir synlig för Geoapify.
        </li>
        <li><strong>Fakturering och bokföring:</strong> <Ph field="billingProvider" /> (Sverige/EU).</li>
      </ul>

      <h2 id="tredjeland">4. Överföring till länder utanför EU/EES</h2>
      <p>
        Vi strävar efter att lagra och behandla data inom EU/EES. Vissa underleverantörer (såsom Clerk, Inc. för inloggning) har säte i USA.
        När personuppgifter överförs utanför EU/EES säkerställer vi att en laglig överföringsmekanism finns på plats, i första hand certifiering
        enligt <strong>EU–US Data Privacy Framework (DPF)</strong> och/eller EU-kommissionens <strong>standardavtalsklausuler (SCC)</strong>
        {' '}kompletterat med tekniska skyddsåtgärder (kryptering under överföring och i vila).
      </p>

      <h2 id="cookies">5. Cookies</h2>
      <p>
        Vi använder endast cookies och lokal lagring som krävs för att inloggningen och webbplatsen ska fungera – inga spårnings- eller
        reklamcookies. Se <Link href="/cookies">Cookies i FastighetsRadar</Link>.
      </p>

      <h2 id="rattigheter">6. Dina rättigheter enligt GDPR</h2>
      <p>Du har rätt att:</p>
      <ul>
        <li>begära tillgång till de personuppgifter vi behandlar om dig (registerutdrag),</li>
        <li>begära rättelse av felaktiga eller ofullständiga uppgifter,</li>
        <li>begära radering av uppgifter (”rätten att bli bortglömd”) i de fall vi inte har laglig skyldighet att spara dem (t.ex. enligt bokföringslagen),</li>
        <li>begära begränsning av behandling eller invända mot behandling som grundas på berättigat intresse,</li>
        <li>få ut uppgifter du lämnat till oss i ett strukturerat format (dataportabilitet).</li>
      </ul>
      <p>
        För att utöva dina rättigheter, kontakta oss på <Email field="legalEmail" />. Om du är anställd eller SMS-mottagare hos en av våra kunder
        ber vi dig i första hand kontakta din arbetsgivare eller organisation (som är personuppgiftsansvarig).
      </p>
      <p>
        Du har även alltid rätt att lämna klagomål till tillsynsmyndigheten <strong>Integritetsskyddsmyndigheten (IMY)</strong> på
        {' '}<a href="https://www.imy.se" target="_blank" rel="noopener noreferrer">imy.se</a>.
      </p>
    </>
  );
}
