'use client';

import { formatClock } from '@fastighetsradar/domain';
import { C } from '@/lib/design/tokens';
import { useLiveUpdates } from '@/lib/live/use-live-updates';

/** Live status pill; the live stream itself is `useLiveUpdates` (row patches, docs/plans/skalning.md S-12). */
export function LiveStatus({ generatedAt }: { generatedAt: string }) {
  const mode = useLiveUpdates();
  const dot = mode === 'live' ? 'oklch(0.62 0.14 155)' : mode === 'polling' ? 'oklch(0.72 0.14 75)' : '#B4BAC0';
  const label = mode === 'live' ? 'Live' : mode === 'polling' ? 'Uppdateras var 5:e min' : 'Ansluter…';
  return (
    <div
      role="status"
      aria-live="polite"
      title="Data hämtas centralt enligt schema; sidan uppdateras när nya data finns."
      style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderRadius: 22, background: C.white, border: '1px solid rgba(20,23,26,0.06)', fontSize: 12.5, color: C.text4 }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
      <span style={{ color: C.ink }}>{label}</span>
      <span>· {formatClock(generatedAt)}</span>
    </div>
  );
}
