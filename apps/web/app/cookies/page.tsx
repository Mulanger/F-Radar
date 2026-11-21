import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { LegalPage } from '@/components/legal/LegalPage';
import { CookiesDocument } from '@/components/legal/documents/CookiesDocument';
import { legalDomain } from '@/lib/legal/company';

export const metadata: Metadata = {
  title: 'Cookies – FastighetsRadar',
  description: 'FastighetsRadar använder endast strikt nödvändiga cookies – inga spårnings- eller reklamcookies.',
};

export default async function Cookies() {
  const { userId } = await auth();
  return (
    <LegalPage signedIn={Boolean(userId)} eyebrow="Juridik" title="Cookies i FastighetsRadar" lead="Bara det som krävs för att inloggningen ska fungera – ingen spårning.">
      <CookiesDocument domain={legalDomain()} />
    </LegalPage>
  );
}
