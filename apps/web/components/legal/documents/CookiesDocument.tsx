import Link from 'next/link';
import { Code, LegalTable } from '../LegalText';

/**
 * Dokument C – Cookie-information, variant A: the site only uses strictly necessary cookies and
 * storage (Clerk sign-in, the "Kom ihåg mig" choice, view preferences). No analytics or marketing
 * scripts are loaded, so no consent banner is shown. Switch to variant B in
 * docs/legal/README.md before adding any tracking.
 */
export function CookiesDocument({ domain }: { domain: string }) {
  return (
    <>
      <p>
        FastighetsRadar värnar om din integritet. Vi använder <strong>inga reklam-, marknadsförings- eller tredjeparts spårningscookies</strong> på {domain}.
      </p>
      <p>Vi använder endast <strong>strikt nödvändiga cookies och lokal lagring</strong> som krävs för att webbplatsen och inloggningen ska fungera säkert:</p>
      <LegalTable
        caption="Cookies och lokal lagring"
        columns={['Namn / leverantör', 'Syfte', 'Typ', 'Lagringstid']}
        rows={[
          [<><Code>__session</Code>, <Code>__client_uat</Code> m.fl. (Clerk)</>, 'Håller dig inloggad, verifierar din session och skyddar mot obehörig åtkomst (CSRF)', 'Strikt nödvändig', 'Session / upp till 7–30 dagar'],
          [<><Code>fr_session_alive</Code> (FastighetsRadar)</>, 'Sätts när du väljer att inte bli ihågkommen vid inloggning, så att du loggas ut när webbläsaren stängs', 'Strikt nödvändig', 'Tills webbläsaren stängs'],
          ['Lokala UI-inställningar (localStorage och sessionStorage)', 'Sparar t.ex. valda filter och vyer, ditt val av ”Kom ihåg mig” och e-postadressen du skrev på startsidan inför registreringen', 'Funktionell / nödvändig', 'Tills fliken stängs eller du rensar webbläsardata'],
        ]}
      />
      <p>
        Eftersom vi enbart använder strikt nödvändiga cookies krävs enligt lagen om elektronisk kommunikation (LEK) inget aktivt cookie-samtycke,
        och därför visar vi ingen cookie-banner. Du kan när som helst blockera eller radera cookies i din webbläsares inställningar, men
        inloggningen i FastighetsRadar kommer då inte att fungera.
      </p>
      <p>
        Kartbilder hämtas från Geoapify när du visar en karta. Läs mer om vilka uppgifter som då skickas i vår <Link href="/integritetspolicy#underbitraden">integritetspolicy</Link>.
      </p>
    </>
  );
}
