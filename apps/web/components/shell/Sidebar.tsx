'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { useOrganization, useUser } from '@clerk/nextjs';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C } from '@/lib/design/tokens';
import { IconAcknowledgements, IconAlert, IconBuilding, IconDashboard, IconMessage, IconSliders, IconUser } from '../ui/icons';
import { MobileNavigation } from '../mobile/MobileNavigation';

const navItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 12,
  fontSize: 14,
};
const navOn: React.CSSProperties = { background: C.white, color: C.ink, boxShadow: '0 1px 2px rgba(20,23,26,0.05),0 6px 16px -10px rgba(20,23,26,0.2)' };
const navOff: React.CSSProperties = { background: 'transparent', color: C.text2, boxShadow: 'none' };
const sectionLabel: React.CSSProperties = { fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.text4, padding: '0 12px 8px' };

/** Placeholder nav entries from the design that have no page yet (kept, not removed). */
function PendingLink({ icon, label, badge }: { icon: React.ReactNode; label: string; badge?: React.ReactNode }) {
  return (
    <a href="#" onClick={(e) => e.preventDefault()} aria-disabled="true" title={`${label} – inte tillgängligt än`} style={{ ...navItem, color: C.text2 }}>
      {icon}
      {label}
      {badge}
    </a>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? '';
  const { portfolio, mode, basePath, unseenAlarmCount } = useDashboard();
  const isSms = pathname === '/sms-rules';
  const isSettings = pathname === '/settings';
  const isAlerts = pathname === `${basePath}/alerts`;
  const isAcknowledgements = pathname === `${basePath}/acknowledgements`;
  const isProperties = pathname === `${basePath}/properties` || pathname.startsWith(`${basePath}/properties/`);
  const isOverview = pathname === `${basePath}/overview`;
  const isDemo = mode === 'demo';

  return (
    <>
      <div className={`fr-mobilebar${pathname.startsWith(`${basePath}/properties/`) ? ' fr-mobilebar-detail' : ''}`}>
        <Link href={`${basePath}/overview`} className="fr-mobile-brand" aria-label="FastighetsRadar – översikt"><span>FastighetsRadar</span></Link>
      </div>
      <aside
        className="fr-sidebar"
        style={{
          width: 236, flexShrink: 0, position: 'sticky', top: 0, height: '100vh', boxSizing: 'border-box', padding: '22px 16px',
          display: 'flex', flexDirection: 'column', gap: 28, borderRight: '1px solid rgba(20,23,26,0.06)', background: C.sidebar,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <Logo />
        </div>
  
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }} aria-label="Huvudmeny">
          <div style={sectionLabel}>Bevakning</div>
          <Link href={`${basePath}/overview`} aria-current={isOverview ? 'page' : undefined} style={{ ...navItem, ...(isOverview ? navOn : navOff) }}>
            <IconDashboard />
            Översikt
          </Link>
          <Link
            href={`${basePath}/properties`}
            aria-current={isProperties ? (pathname === `${basePath}/properties` ? 'page' : 'location') : undefined}
            style={{ ...navItem, ...(isProperties ? navOn : navOff) }}
          >
            <IconBuilding />
            Fastigheter
            <span style={{ marginLeft: 'auto', fontSize: 12, color: C.text4 }}>{portfolio.properties.length}</span>
          </Link>
          <Link href={`${basePath}/alerts`} aria-current={isAlerts ? 'page' : undefined} style={{ ...navItem, ...(isAlerts ? navOn : navOff) }}><IconAlert />Larm{unseenAlarmCount > 0 && <span aria-label={`${unseenAlarmCount} olästa larm`} style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#fff', background: 'oklch(0.6 0.18 28)', borderRadius: 20, padding: '2px 7px' }}>{unseenAlarmCount}</span>}</Link>
          <Link href={`${basePath}/acknowledgements`} aria-current={isAcknowledgements ? 'page' : undefined} style={{ ...navItem, ...(isAcknowledgements ? navOn : navOff) }}><IconAcknowledgements />Kvitteringar</Link>
          <div style={{ ...sectionLabel, padding: '22px 12px 8px' }}>Konfiguration</div>
          {isDemo ? <PendingLink icon={<IconMessage />} label="SMS-regler" /> : <Link href="/sms-rules" aria-current={isSms?'page':undefined} style={{...navItem,...(isSms?navOn:navOff)}}><IconMessage/>SMS-regler</Link>}
          {isDemo ? <PendingLink icon={<IconSliders />} label="Inställningar" /> : <Link href="/settings" aria-current={isSettings ? 'page' : undefined} style={{ ...navItem, ...(isSettings ? navOn : navOff) }}><IconSliders />Inställningar</Link>}
        </nav>
  
        {isDemo
          ? <SidebarIdentity name={portfolio.viewer.displayName} organization={portfolio.organizationName} />
          : <LiveSidebarIdentity />}
      </aside>
      <Suspense><MobileNavigation /></Suspense>
    </>
  );
}

function LiveSidebarIdentity() {
  const { user } = useUser();
  const { organization } = useOrganization();
  const name = user?.fullName?.trim() || user?.username;

  return <SidebarIdentity name={name} organization={organization?.name} />;
}

function SidebarIdentity({ name, organization = 'Organisation' }: { name?: string | null; organization?: string }) {
  const initials = name?.split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('sv-SE');

  return (
    <div className="fr-sidebar-identity" style={{
      marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px',
      borderRadius: 14, border: '1px solid #14171a12', background: C.white,
    }}>
      <span aria-hidden="true" style={{
        flex: '0 0 34px', height: 34, display: 'grid', placeItems: 'center',
        borderRadius: '50%', background: '#e2ece5', color: '#29483d', fontSize: 11, fontWeight: 650,
      }}>
        {initials || <IconUser size={16} />}
      </span>
      <div style={{ minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.3 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{name || 'Ditt konto'}</div>
        <div style={{ fontSize: 11.5, color: C.text2, marginTop: 2 }}>{organization}</div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>FastighetsRadar</div>
    </div>
  );
}

