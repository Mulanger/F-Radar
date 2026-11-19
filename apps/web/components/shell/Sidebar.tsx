'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C, monoChip } from '@/lib/design/tokens';
import { formatClock } from '@fastighetsradar/domain';
import { IconAcknowledgements, IconAlert, IconBuilding, IconClose, IconDashboard, IconMessage, IconSliders, IconBell } from '../ui/icons';
import { MobileNavigation } from '../mobile/MobileNavigation';
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';

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

/** Swedish labels for source runtime statuses (tooltips). */
const SOURCE_STATUS_SV: Record<string, string> = {
  ok: 'aktuell', degraded: 'väntar/fel', stale: 'inaktuell', source_unavailable: 'otillgänglig', access_required: 'åtkomst krävs',
  pending_access: 'väntar på åtkomst', disabled: 'avstängd', not_implemented: 'ej implementerad', demo: 'demo',
};

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
  const { portfolio, selectedId, mode, basePath, openProperty, goOverview, unseenAlarmCount } = useDashboard();
  // Below 900 px the sidebar becomes a slide-in drawer (see `.fr-sidebar` in globals.css);
  // on desktop this state has no visual effect.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (!menuOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const media = window.matchMedia('(max-width: 899.98px)');
    const onViewport = () => { if (!media.matches) setMenuOpen(false); };
    media.addEventListener('change', onViewport);
    menuRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Stäng meny"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setMenuOpen(false); }
      if (e.key !== 'Tab') return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); media.removeEventListener('change', onViewport); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [menuOpen]);
  const nav = (fn: () => void) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setMenuOpen(false);
    fn();
  };
  const isSms = pathname === '/sms-rules';
  const isSettings = pathname === '/settings';
  const isAlerts = pathname === `${basePath}/alerts`;
  const isAcknowledgements = pathname === `${basePath}/acknowledgements`;
  const isProperties = pathname.startsWith(`${basePath}/properties`);
  const isOverview = !isSms && !isSettings && !isAlerts && !isAcknowledgements && !isProperties;
  const isDemo = mode === 'demo';
  // Health is judged over ENABLED monitoring sources only; deliberately disabled / not-yet-implemented
  // sources (Lantmäteriet, Boverket, oceanography) are listed as such, never as failures.
  const INACTIVE = ['disabled', 'not_implemented', 'access_required', 'pending_access'];
  const lastSync = portfolio.sources.map((s) => s.lastSuccessAt).filter(Boolean).sort().pop() ?? null;
  // Live mode: list only sources that actually deliver data; never imply "live" otherwise.
  const NON_MONITORING = ['geoapify_geocoding', 'lantmateriet_address', 'sms_46elks'];
  const connected = portfolio.sources.filter((s) => !NON_MONITORING.includes(s.sourceId) && (s.status === 'ok' || s.status === 'degraded'));
  const chips = isDemo ? portfolio.sources : connected;
  const active = portfolio.sources.filter((s) => !NON_MONITORING.includes(s.sourceId) && !INACTIVE.includes(s.status));
  const problems = active.filter((s) => s.status !== 'ok');
  const allOk = !isDemo && active.length > 0 && problems.length === 0;
  const STATUS_SV: Record<string, string> = { degraded: 'väntar/fel', stale: 'inaktuell', source_unavailable: 'otillgänglig' };

  return (
    <>
      <div className={`fr-mobilebar${pathname.startsWith(`${basePath}/properties/`) ? ' fr-mobilebar-detail' : ''}`}>
        <Link href={`${basePath}/overview`} className="fr-mobile-brand" aria-label="FastighetsRadar – översikt"><span>FastighetsRadar</span></Link>
        <div className="fr-mobilebar-actions">
        <Link href={`${basePath}/alerts`} className="fr-mobilebar-bell" aria-label={unseenAlarmCount > 0 ? `Aviseringar, ${unseenAlarmCount} olästa larm` : 'Aviseringar'}><IconBell size={19} />{unseenAlarmCount > 0 && <span className="fr-mobilebar-bell-dot" />}</Link>
        {isDemo ? <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Öppna profil och meny"
          aria-expanded={menuOpen}
          aria-controls="fr-sidebar"
          className="fr-mobile-profile"
        >
          {portfolio.viewer.initials}
        </button> : <UserButton appearance={{ elements: { userButtonAvatarBox: { width: 44, height: 44 } } }} />}
        </div>
      </div>
      <div className={`fr-sidebar-backdrop${menuOpen ? ' fr-open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside
        ref={menuRef}
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen || undefined}
        aria-label={menuOpen ? 'Meny och inställningar' : undefined}
        id="fr-sidebar"
        className={`fr-sidebar${menuOpen ? ' fr-open' : ''}`}
        style={{
          width: 236, flexShrink: 0, position: 'sticky', top: 0, height: '100vh', boxSizing: 'border-box', padding: '22px 16px',
          display: 'flex', flexDirection: 'column', gap: 28, borderRight: '1px solid rgba(20,23,26,0.06)', background: C.sidebar,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <Logo />
          <button type="button" className="fr-only-compact" onClick={() => setMenuOpen(false)} aria-label="Stäng meny" style={menuBtn}>
            <IconClose />
          </button>
        </div>
  
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }} aria-label="Huvudmeny">
          <div style={sectionLabel}>Bevakning</div>
          <Link href={`${basePath}/overview`} onClick={nav(goOverview)} aria-current={isOverview ? 'page' : undefined} style={{ ...navItem, ...(isOverview ? navOn : navOff) }}>
            <IconDashboard />
            Översikt
          </Link>
          <Link
            href={menuOpen ? `${basePath}/properties` : selectedId ? `${basePath}/properties/${encodeURIComponent(selectedId)}` : `${basePath}/overview`}
            onClick={menuOpen ? () => setMenuOpen(false) : nav(() => (selectedId ? openProperty(selectedId) : goOverview()))}
            aria-current={isProperties ? 'page' : undefined}
            style={{ ...navItem, ...(isProperties ? navOn : navOff) }}
          >
            <IconBuilding />
            Fastigheter
            <span style={{ marginLeft: 'auto', fontSize: 12, color: C.text4 }}>{portfolio.properties.length}</span>
          </Link>
          <Link href={`${basePath}/alerts`} onClick={() => setMenuOpen(false)} aria-current={isAlerts ? 'page' : undefined} style={{ ...navItem, ...(isAlerts ? navOn : navOff) }}><IconAlert />Larm{unseenAlarmCount > 0 && <span aria-label={`${unseenAlarmCount} olästa larm`} style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#fff', background: 'oklch(0.6 0.18 28)', borderRadius: 20, padding: '2px 7px' }}>{unseenAlarmCount}</span>}</Link>
          <Link href={`${basePath}/acknowledgements`} onClick={() => setMenuOpen(false)} aria-current={isAcknowledgements ? 'page' : undefined} style={{ ...navItem, ...(isAcknowledgements ? navOn : navOff) }}><IconAcknowledgements />Kvitteringar</Link>
          <div style={{ ...sectionLabel, padding: '22px 12px 8px' }}>Konfiguration</div>
          {isDemo ? <PendingLink icon={<IconMessage />} label="SMS-regler" /> : <Link href="/sms-rules" aria-current={isSms?'page':undefined} style={{...navItem,...(isSms?navOn:navOff)}}><IconMessage/>SMS-regler</Link>}
          {isDemo ? <PendingLink icon={<IconSliders />} label="Inställningar" /> : <Link href="/settings" aria-current={isSettings ? 'page' : undefined} style={{ ...navItem, ...(isSettings ? navOn : navOff) }}><IconSliders />Inställningar</Link>}
        </nav>
  
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!isDemo && <div className="fr-mobile-account"><UserButton /><OrganizationSwitcher hidePersonal afterSelectOrganizationUrl={`${basePath}/overview`} afterCreateOrganizationUrl={`${basePath}/overview`} afterLeaveOrganizationUrl="/onboarding" /></div>}
          <div style={{ borderRadius: 18, padding: 14, background: C.white, border: '1px solid rgba(20,23,26,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: isDemo ? C.demo : allOk ? C.live : 'oklch(0.6 0.15 55)', animation: 'frBreath 2.4s ease-in-out infinite' }} />
              {isDemo ? 'Demodata · inte live' : allOk ? 'Alla källor aktuella' : connected.length ? `${problems.length} av ${active.length} källor ej aktuella` : 'Offentliga data ej anslutna'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {chips.length === 0 && <span style={{ fontSize: 11.5, color: C.text3 }}>Inga datakällor är anslutna ännu.</span>}
              {chips.map((s) => (
                <span key={s.sourceId} style={{ ...monoChip, ...(s.status !== 'ok' && !isDemo ? { color: 'oklch(0.55 0.13 55)' } : {}) }} title={`${s.label}: ${SOURCE_STATUS_SV[s.status] ?? s.status}${s.note ? ' – ' + s.note : ''}`}>
                  {s.label}
                </span>
              ))}
            </div>
            {!isDemo && problems.length > 0 && (
              <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.4 }}>
                {problems.map((s) => `${s.label}: ${STATUS_SV[s.status] ?? s.status}`).join(' · ')}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: C.text4 }}>
              {isDemo ? `Demoögonblick ${formatClock(portfolio.generatedAt)} · ingen synk` : lastSync ? `Senast synkad ${formatClock(lastSync)}` : 'Ingen data synkad ännu'}
            </div>
          </div>
        </div>
      </aside>
      <MobileNavigation onSettings={() => setMenuOpen(true)} />
    </>
  );
}

const menuBtn: React.CSSProperties = {
  marginLeft: 'auto', width: 40, height: 40, borderRadius: 12, border: '1px solid rgba(20,23,26,0.06)', background: C.white,
  display: 'grid', placeItems: 'center', cursor: 'pointer', color: C.ink, padding: 0,
};

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>FastighetsRadar</div>
    </div>
  );
}

