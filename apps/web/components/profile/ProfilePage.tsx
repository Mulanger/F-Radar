'use client';

import Link from 'next/link';
import { DashboardLink } from '../shell/DashboardLink';
import type { ReactNode } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import { SourceStatus } from '../shell/SourceStatus';
import {
  IconAcknowledgements, IconBuilding, IconChevronDown, IconChevronRight,
  IconMessage, IconShield, IconSliders, IconUser,
} from '../ui/icons';
import s from './ProfilePage.module.css';

export function ProfilePage({
  name, email, organization, role, access, account, organizationActions, signOut,
}: {
  name: string;
  email?: string;
  organization?: string;
  role: string;
  access?: string;
  account: ReactNode;
  organizationActions?: ReactNode;
  signOut?: ReactNode;
}) {
  const { mode, basePath } = useDashboard();
  const demo = mode === 'demo';

  return <>
    <div className={s.page}>
      <header className={s.header}>
        <h1>Profil</h1>
        {demo && <span className={s.demo}>Demoläge</span>}
      </header>

      <div className={s.identity}>
        <div className={s.avatar}><IconUser size={29} /></div>
        <div className={s.identityText}>
          <p className={s.name}>{name}</p>
          {email && <p className={s.email}>{email}</p>}
          {organization && <p className={s.organization}><IconBuilding size={14} />{organization}</p>}
        </div>
      </div>

      <ProfileSection id="profile-account" title="Mitt konto">{account}</ProfileSection>

      <ProfileSection id="profile-monitoring" title="Bevakning">
        <ProfileLink href={`${basePath}/sms-rules?via=profile`} icon={<IconMessage />} title="SMS-regler och mottagare"
          description={demo ? 'Prova regler med demodata' : 'Regler, telefonnummer och SMS-historik'} />
        <ProfileLink href={`${basePath}/acknowledgements?via=profile`} icon={<IconAcknowledgements />} title="Kvitteringar"
          description="Historik och PDF-export" />
        <ProfileLink href={demo ? undefined : '/settings?via=profile'} icon={<IconSliders />} title="Bevakningsinställningar"
          description={demo ? 'Tillgängligt i inloggat läge' : 'Organisationens bevakningsavstånd för Trafikverket'} />
      </ProfileSection>

      <ProfileSection id="profile-organization" title="Organisation">
        <ProfileRow icon={<IconBuilding />} title={role || 'Aktiv organisation'} description={access} />
        {organizationActions}
      </ProfileSection>

      <ProfileSection id="profile-help" title="Hjälp">
        <a className={s.row} href="https://github.com/Mulanger/F-Radar/issues" target="_blank" rel="noreferrer">
          <RowContent icon={<IconMessage />} title="Rapportera fel" description="Öppnar GitHub, där rapporter är offentliga" />
          <IconChevronRight size={16} />
        </a>
        <details className={s.sources}>
          <summary className={s.row}>
            <RowContent icon={<IconShield />} title="Datakällor" />
            <IconChevronDown className={s.chevron} size={16} />
          </summary>
          <div className={s.sourceStatus}><SourceStatus /></div>
        </details>
      </ProfileSection>

      {signOut}
    </div>
    <div className={s.desktop}>
      <Link href={demo ? `${basePath}/overview` : '/settings'}>{demo ? 'Till översikten' : 'Till inställningar'}</Link>
    </div>
  </>;
}

export function DemoProfile() {
  const { portfolio } = useDashboard();
  return <ProfilePage name={portfolio.viewer.displayName} email="elin@example.com" organization="Demoportföljen"
    role={portfolio.viewer.role}
    account={<>
      <ProfileRow icon={<IconUser />} title="Ändra namn" description="Tillgängligt i inloggat läge" />
      <ProfileRow icon={<IconShield />} title="Ändra lösenord" description="Tillgängligt i inloggat läge" />
    </>} />;
}

function ProfileSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={id}>
    <h2 id={id} className={s.sectionTitle}>{title}</h2>
    <div className={s.card}>{children}</div>
  </section>;
}

function ProfileLink({ href, icon, title, description }: { href?: string; icon: ReactNode; title: string; description: string }) {
  if (!href) return <ProfileRow icon={icon} title={title} description={description} />;
  return <DashboardLink className={s.row} href={href}>
    <RowContent icon={icon} title={title} description={description} />
    <IconChevronRight size={16} />
  </DashboardLink>;
}

export function ProfileRow({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return <div className={s.row}><RowContent icon={icon} title={title} description={description} /></div>;
}

export function RowContent({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return <>
    <span className={s.rowIcon}>{icon}</span>
    <span className={s.rowText}>
      <span className={s.rowTitle}>{title}</span>
      {description && <span className={s.rowDescription}>{description}</span>}
    </span>
  </>;
}
