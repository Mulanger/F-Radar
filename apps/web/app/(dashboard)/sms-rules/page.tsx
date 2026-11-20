import { SmsManagement } from '@/components/notifications/SmsManagement';
import { DashboardBackLink } from '@/components/shell/DashboardLink';
import { dashboardSection, propertyHref, sectionTarget } from '@/lib/navigation/dashboard';
import { internalApiJson } from '@/lib/server/internal-api';
import type { NotificationDashboard } from '@fastighetsradar/domain';

export const metadata = { title: 'SMS-regler · FastighetsRadar' };

export default async function SmsRulesPage({ searchParams }: {
  searchParams: Promise<{ property?: string; via?: string; propertyVia?: string }>;
}) {
  const [data, { property, via, propertyVia }] = await Promise.all([
    internalApiJson<NotificationDashboard>('/v1/notifications'),
    searchParams,
  ]);
  const selected = data.properties.find(p => p.id === property);
  const fromProperty = via === 'property' && selected;
  const target = fromProperty
    ? { href: propertyHref('', selected.id, dashboardSection(propertyVia)), label: 'fastigheten' }
    : sectionTarget('', 'profile');
  return <SmsManagement initial={data} propertyId={selected?.id} back={<DashboardBackLink target={target}
    className={fromProperty ? undefined : 'fr-dashboard-back fr-profile-back'} />} />;
}
