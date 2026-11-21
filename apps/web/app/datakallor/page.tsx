import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { LegalPage } from '@/components/legal/LegalPage';
import { DataSourcesDocument } from '@/components/legal/documents/DataSourcesDocument';

export const metadata: Metadata = {
  title: 'Datakällor och licenser – FastighetsRadar',
  description: 'Vilka myndighetsdata FastighetsRadar bygger på, under vilka licenser, och hur Riskindex räknas.',
};

export default async function Datakallor() {
  const { userId } = await auth();
  return (
    <LegalPage signedIn={Boolean(userId)} eyebrow="Transparens" title="Datakällor, licenser och metod" lead="Varifrån varje värde kommer och hur vi väger ihop det." updatedLabel={null}>
      <DataSourcesDocument />
    </LegalPage>
  );
}
