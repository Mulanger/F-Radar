import type { OrganizationSettingsResponse } from '@fastighetsradar/domain';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { internalApiJson } from '@/lib/server/internal-api';

export const metadata = { title: 'Inställningar · FastighetsRadar' };

export default async function Settings() {
  const settings = await internalApiJson<OrganizationSettingsResponse>('/v1/settings');
  return <SettingsPage initial={settings} />;
}
