import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/landing/SiteChrome';
import landing from '@/components/landing/landing.module.css';
import { SALES_CONTACT_HREF } from '@/lib/pricing/plans';
import { PricingFaq } from './PricingFaq';
import { PricingPlans } from './PricingPlans';
import css from './pricing.module.css';

/**
 * Public pricing page (`/priser`) – ported from the approved design "Prissida – desktop och mobil".
 * Shares the header and footer with the landing page. Ordering is front end only for now.
 */
export function PricingPage({ signedIn }: { signedIn: boolean }) {
  return (
    <div className={landing.root}>
      <a href="#innehall" className="fr-sr-only">Hoppa till innehållet</a>
      <SiteHeader signedIn={signedIn} page="pricing" />
      <main id="innehall" className={css.content}>
        <PricingPlans signedIn={signedIn} />
        <PricingFaq />
        <section id="kontakt" className={css.ctaWrap} aria-labelledby="kom-igang-rubrik" style={{ scrollMarginTop: 90 }}>
          <div className={css.cta}>
            <h2 id="kom-igang-rubrik" className={css.ctaTitle}>Börja bevaka din första fastighet på två minuter.</h2>
            <p className={css.ctaLead}>Skapa konto gratis, lägg in din adress och se aktuella varningar, översvämningszoner och riskindex direkt.</p>
            <div className={css.ctaActions}>
              <Link href={signedIn ? '/overview' : '/sign-up'} className={css.btnPrimary}>
                {signedIn ? 'Öppna översikten' : 'Skapa gratiskonto'} <span aria-hidden="true">→</span>
              </Link>
              <a href={SALES_CONTACT_HREF} className={css.btnSecondary}>Kontakta oss för offert</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter page="pricing" />
    </div>
  );
}
