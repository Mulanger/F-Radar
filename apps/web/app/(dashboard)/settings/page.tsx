import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { DashboardBackLink } from '@/components/shell/DashboardLink';
import { sectionTarget } from '@/lib/navigation/dashboard';
import type { OrganizationSettingsResponse } from '@fastighetsradar/domain';
import { SettingsPage } from '@/components/settings/SettingsPage';
import s from '@/components/settings/SettingsPage.module.css';
import { card, cardTitle } from '@/lib/design/tokens';
import { internalApiJson } from '@/lib/server/internal-api';

export const metadata = { title: 'Inställningar · FastighetsRadar' };

export default async function Settings() {
  const settings = await internalApiJson<OrganizationSettingsResponse>('/v1/settings');
  return <SettingsPage
    initial={settings}
    back={<DashboardBackLink target={sectionTarget('', 'profile')} className="fr-dashboard-back fr-profile-back" />}
    account={<section className={s.desktopAccount} style={{ ...card, padding: 24 }} aria-labelledby="desktop-account-title">
      <h2 id="desktop-account-title" style={{ ...cardTitle, margin: 0 }}>Konto och organisation</h2>
      <div className={s.accountRow}>
        <span>Konto och utloggning</span>
        <UserButton />
      </div>
      <div className={s.accountRow}>
        <span>Organisation</span>
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/overview"
          afterCreateOrganizationUrl="/overview"
          afterLeaveOrganizationUrl="/onboarding"
        />
      </div>
    </section>}
  />;
}
