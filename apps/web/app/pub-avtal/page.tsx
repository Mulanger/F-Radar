import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { LegalPage } from '@/components/legal/LegalPage';
import { DpaDocument } from '@/components/legal/documents/DpaDocument';

export const metadata: Metadata = {
  title: 'Personuppgiftsbiträdesavtal (PUB-avtal) – FastighetsRadar',
  description: 'Personuppgiftsbiträdesavtal för kunder i FastighetsRadar – bilaga till Användarvillkoren.',
};

export default async function PubAvtal() {
  const { userId } = await auth();
  return (
    <LegalPage
      signedIn={Boolean(userId)}
      eyebrow="Juridik"
      title="PUB-avtal"
      lead="Personuppgiftsbiträdesavtal – bilaga till Användarvillkoren för er organisation."
      updatedLabel="Version"
      printable
    >
      <DpaDocument />
    </LegalPage>
  );
}
