import Link from 'next/link';
import type { ReactNode } from 'react';
import { AUTH_LINKS } from '@/lib/auth/links';

function NewTabLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return <Link href={href} className={className} target="_blank" rel="noopener noreferrer">{children}</Link>;
}

/**
 * Del 4.2 of the legal package – the B2B declaration and acceptance of Användarvillkor, PUB-avtal
 * and Integritetspolicy. Shared by sign-up and the dashboard's acceptance dialog.
 */
export function LegalConsentText({ linkClassName }: { linkClassName?: string }) {
  return (
    <>
      Jag intygar att jag registrerar kontot för ett företag, en bostadsrättsförening eller annan organisation (ej privatperson) samt godkänner
      FastighetsRadars <NewTabLink href={AUTH_LINKS.terms} className={linkClassName}>Användarvillkor</NewTabLink> och{' '}
      <NewTabLink href={AUTH_LINKS.dpa} className={linkClassName}>PUB-avtal</NewTabLink>. Jag har tagit del av{' '}
      <NewTabLink href={AUTH_LINKS.privacy} className={linkClassName}>Integritetspolicyn</NewTabLink>.
    </>
  );
}
