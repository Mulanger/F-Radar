'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C, monoChip } from '@/lib/design/tokens';
import { formatClock } from '@fastighetsradar/domain';
import { IconAlert, IconAnalytics, IconBuilding, IconDashboard, IconMap, IconMessage, IconSliders } from '../ui/icons';

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
  const { portfolio, selectedId, mode, basePath, openProperty, goOverview } = useDashboard();
  const nav = (fn: () => void) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    fn();
  };
  const isSms = pathname === '/sms-rules';
  const isOverview = !isSms && !pathname.startsWith(`${basePath}/properties`);
  const totalAlerts = portfolio.properties.reduce((a, s) => a + s.activeAlertCount, 0);
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
    <aside
      style={{
        width: 236, flexShrink: 0, position: 'sticky', top: 0, height: '100vh', boxSizing: 'border-box', padding: '22px 16px',
        display: 'flex', flexDirection: 'column', gap: 28, borderRight: '1px solid rgba(20,23,26,0.06)', background: C.sidebar,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: C.ink, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.9)', boxSizing: 'border-box', display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'oklch(0.78 0.11 215)' }} />
          </div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>FastighetsRadar</div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }} aria-label="Huvudmeny">
        <div style={sectionLabel}>Bevakning</div>
        <Link href={`${basePath}/overview`} onClick={nav(goOverview)} aria-current={isOverview ? 'page' : undefined} style={{ ...navItem, ...(isOverview ? navOn : navOff) }}>
          <IconDashboard />
          Översikt
        </Link>
        <Link
          href={selectedId ? `${basePath}/properties/${encodeURIComponent(selectedId)}` : `${basePath}/overview`}
          onClick={nav(() => (selectedId ? openProperty(selectedId) : goOverview()))}
          aria-current={!isOverview && !isSms ? 'page' : undefined}
          style={{ ...navItem, ...(!isOverview && !isSms ? navOn : navOff) }}
        >
          <IconBuilding />
          Fastigheter
          <span style={{ marginLeft: 'auto', fontSize: 12, color: C.text4 }}>{portfolio.properties.length}</span>
        </Link>
        <PendingLink
          icon={<IconAlert />}
          label="Larm"
          badge={totalAlerts > 0 ? <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#fff', background: 'oklch(0.6 0.18 28)', borderRadius: 20, padding: '2px 7px' }}>{totalAlerts}</span> : undefined}
        />
        <PendingLink icon={<IconMap />} label="Kartvy" />
        <PendingLink icon={<IconAnalytics />} label="Analys" />
        <div style={{ ...sectionLabel, padding: '22px 12px 8px' }}>Konfiguration</div>
        {isDemo ? <PendingLink icon={<IconMessage />} label="SMS-regler" /> : <Link href="/sms-rules" aria-current={isSms?'page':undefined} style={{...navItem,...(isSms?navOn:navOff)}}><IconMessage/>SMS Rules</Link>}
        <PendingLink icon={<IconSliders />} label="Inställningar" />
      </nav>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
  );
}

