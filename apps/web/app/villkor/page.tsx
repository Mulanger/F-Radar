import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { LegalPage } from '@/components/legal/LegalPage';
import { TermsDocument } from '@/components/legal/documents/TermsDocument';
import { legalDomain } from '@/lib/legal/company';

export const metadata: Metadata = {
  title: 'Användarvillkor – FastighetsRadar',
  description: 'Villkor för företag och organisationer som använder FastighetsRadar (B2B).',
};

export default async function Villkor() {
  const { userId } = await auth();
  return (
    <LegalPage signedIn={Boolean(userId)} eyebrow="Juridik" title="Användarvillkor" lead="För företag, bostadsrättsföreningar och andra organisationer som använder FastighetsRadar.">
      <TermsDocument domain={legalDomain()} />
    </LegalPage>
  );
}
