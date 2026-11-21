import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/landing/SiteChrome';
import landing from '@/components/landing/landing.module.css';
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal/company';
import { formatLegalDate } from './LegalText';
import { PrintButton } from './PrintButton';
import css from './legal.module.css';

/** Shell of the public legal pages: site header and footer, a short hero and the document card. */
export function LegalPage({ signedIn, eyebrow, title, lead, updatedLabel = 'Senast uppdaterad', printable, children }: {
  signedIn: boolean;
  eyebrow: string;
  title: string;
  lead?: string;
  /** Label for the effective date ("Version" for the DPA); `null` hides it. */
  updatedLabel?: string | null;
  printable?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`${landing.root} ${css.page}`}>
      <a href="#innehall" className="fr-sr-only">Hoppa till innehållet</a>
      <SiteHeader signedIn={signedIn} page="legal" />
      <main id="innehall" className={css.main}>
        <div className={css.hero}>
          <span className={css.eyebrow}>{eyebrow}</span>
          <h1 className={css.title}>{title}</h1>
          {lead ? <p className={css.lead}>{lead}</p> : null}
          {updatedLabel || printable ? (
            <div className={css.meta}>
              {updatedLabel ? <span className={css.pill}>{updatedLabel}: {formatLegalDate(LEGAL_EFFECTIVE_DATE)}</span> : null}
              {printable ? <PrintButton /> : null}
            </div>
          ) : null}
        </div>
        <article className={css.article}>{children}</article>
      </main>
      <SiteFooter page="legal" />
    </div>
  );
}
