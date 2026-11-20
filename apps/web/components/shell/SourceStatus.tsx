'use client';

import { formatClock } from '@fastighetsradar/domain';
import { C, monoChip } from '@/lib/design/tokens';
import { useDashboard } from '@/lib/state/dashboard-state';

/** Swedish labels for source runtime statuses (tooltips). */
const SOURCE_STATUS_SV: Record<string, string> = {
  ok: 'aktuell', degraded: 'väntar/fel', stale: 'inaktuell', source_unavailable: 'otillgänglig', access_required: 'åtkomst krävs',
  pending_access: 'väntar på åtkomst', disabled: 'avstängd', not_implemented: 'ej implementerad', demo: 'demo',
};

export function SourceStatus() {
  const { portfolio, mode } = useDashboard();
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
  );
}
