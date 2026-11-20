import { DashboardBackLink } from '@/components/shell/DashboardLink';
import { sectionTarget } from '@/lib/navigation/dashboard';
import { DemoAcknowledgementHistory } from '@/components/acknowledgements/DemoAcknowledgements';

export const metadata = { title: 'Demo · Kvitteringar · FastighetsRadar' };

export default async function DemoAcknowledgementsPage({ searchParams }: { searchParams: Promise<{ via?: string }> }) {
  const { via } = await searchParams;
  return <DemoAcknowledgementHistory back={<DashboardBackLink target={sectionTarget('/demo', via === 'profile' ? 'profile' : 'alerts')}
    className={via === 'profile' ? 'fr-dashboard-back fr-profile-back' : undefined} />} />;
}
