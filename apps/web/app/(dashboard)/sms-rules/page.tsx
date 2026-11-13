import { SmsManagement } from '@/components/notifications/SmsManagement';
import { internalApiJson } from '@/lib/server/internal-api';
import type { NotificationDashboard } from '@fastighetsradar/domain';
export default async function SmsRulesPage({searchParams}:{searchParams:Promise<{property?:string}>}) {
  const data=await internalApiJson<NotificationDashboard>('/v1/notifications');
  const {property}=await searchParams;
  return <SmsManagement initial={data} propertyId={data.properties.some(p=>p.id===property)?property:undefined}/>;
}
