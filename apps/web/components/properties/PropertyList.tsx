'use client';

import { useDashboard } from '@/lib/state/dashboard-state';
import { C, FONT_MONO, SEV } from '@/lib/design/tokens';
import { riskScore, show } from '@/lib/view-models/snapshot';

/**
 * Property picker rows used by the header "Quick switch" (`variant="status"`) and the
 * detail-page switcher (`variant="risk"`, highlights the current property).
 */
export function PropertyList({
  variant,
  currentId,
  onSelect,
}: {
  variant: 'status' | 'risk';
  currentId?: string;
  onSelect: (id: string) => void;
}) {
  const { portfolio } = useDashboard();
  return (
    <div role="listbox" aria-label="Fastigheter">
      {portfolio.properties.map((s) => {
        const p = s.property;
        const st = SEV[p.status] ?? SEV.unknown;
        const selected = p.id === currentId;
        return (
          <div
            key={p.id}
            role="option"
            aria-selected={selected}
            tabIndex={0}
            className="fr-hover-soft"
            onClick={() => onSelect(p.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(p.id))}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
              background: variant === 'risk' && selected ? C.page : 'transparent',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.c }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: C.text4 }}>{p.area}</div>
            </div>
            {variant === 'status' ? (
              <span style={{ fontSize: 11.5, color: st.c }}>{st.label}</span>
            ) : (
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.text3 }}>Risk {show(riskScore(s))}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
