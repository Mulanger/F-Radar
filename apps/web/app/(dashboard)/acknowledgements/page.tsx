import { DashboardBackLink } from '@/components/shell/DashboardLink';
import { sectionTarget } from '@/lib/navigation/dashboard';
import { AcknowledgementHistory } from '@/components/acknowledgements/AcknowledgementHistory';

export const metadata = { title: 'Kvitteringar · FastighetsRadar' };

export default async function AcknowledgementsPage({ searchParams }: { searchParams: Promise<{ via?: string }> }) {
  const { via } = await searchParams;
  return <AcknowledgementHistory back={<DashboardBackLink target={sectionTarget('', via === 'profile' ? 'profile' : 'alerts')}
    className={via === 'profile' ? 'fr-dashboard-back fr-profile-back' : undefined} />} />;
}
