import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { LegalPage } from '@/components/legal/LegalPage';
import { PrivacyDocument } from '@/components/legal/documents/PrivacyDocument';
import { legalDomain } from '@/lib/legal/company';

export const metadata: Metadata = {
  title: 'Integritetspolicy – FastighetsRadar',
  description: 'Hur FastighetsRadar behandlar personuppgifter enligt GDPR.',
};

export default async function Integritetspolicy() {
  const { userId } = await auth();
  return (
    <LegalPage signedIn={Boolean(userId)} eyebrow="Juridik" title="Integritetspolicy" lead="Vilka personuppgifter vi behandlar, varför, hur länge – och dina rättigheter.">
      <PrivacyDocument domain={legalDomain()} />
    </LegalPage>
  );
}
