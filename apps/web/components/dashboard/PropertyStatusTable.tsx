'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';
import { Toggle } from '../ui/Toggle';
import { IconChevronRight } from '../ui/icons';

const COLS = 'minmax(210px,1.8fr) 112px minmax(190px,1.3fr) 150px 96px 130px 92px 60px 128px 56px 24px';

export function PropertyStatusTable({
  vm,
  smsInteractive,
  onOpen,
  onToggleSms,
}: {
  vm: OverviewVM;
  smsInteractive: boolean;
  onOpen: (id: string) => void;
  onToggleSms: (s: PropertySnapshot) => void;
}) {
  return (
    <div style={{ ...card, padding: '20px 20px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={cardTitle}>Bevakningsstatus</div>
          <div style={cardSub}>Aktuella värden per fastighet · sorterat efter status</div>
        </div>
        <div style={{ fontSize: 12, color: C.text4 }}>Uppdaterad {vm.updatedAt}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1180 }} role="table" aria-label="Bevakningsstatus per fastighet">
          <div
            role="row"
            style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 12px', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.text4, borderBottom: '1px solid rgba(20,23,26,0.06)' }}
          >
            {['Fastighet', 'Status', 'Väder nu', 'Officiell varning', 'Översvämning', 'I närheten', 'Luft', 'Larm', 'Riskpoäng', 'SMS', ''].map((h, i) => (
              <div key={i} role="columnheader">{h}</div>
            ))}
          </div>
          {vm.rows.map((r) => (
            <div
              key={r.id}
              role="row"
              tabIndex={0}
              className="fr-hover-row"
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(r.id)}
              style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '14px 12px', borderBottom: '1px solid rgba(20,23,26,0.05)', cursor: 'pointer', borderRadius: 14, transition: 'background .2s' }}
            >
              <div role="cell" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: C.text4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.address}</div>
              </div>
              <div role="cell">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 10, background: r.bg, color: r.c }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                  {r.status}
                </span>
              </div>
              <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>{r.temp}°</span>
                <span style={{ fontSize: 12, color: C.text3 }}>{r.rain} mm · {r.wind} m/s · {r.hum}%</span>
              </div>
              <div role="cell">
                <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: r.wBg, color: r.wFg }}>{vm.avail.warnings ? r.warn : '—'}</span>
              </div>
              <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  <span style={{ width: 4, height: 12, borderRadius: 2, background: r.f1 }} />
                  <span style={{ width: 4, height: 12, borderRadius: 2, background: r.f2 }} />
                  <span style={{ width: 4, height: 12, borderRadius: 2, background: r.f3 }} />
                </span>
                {r.flood}
              </div>
              <div role="cell" style={{ fontSize: 12.5, color: C.text2 }}>{vm.avail.events ? r.nearby : '—'}</div>
              <div role="cell" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.aqC }} />
                {r.aq}
              </div>
              <div role="cell" style={{ fontSize: 14, fontWeight: 500 }}>{r.alerts}</div>
              <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.chip, overflow: 'hidden' }}>
                  <div style={{ height: 5, borderRadius: 3, width: r.riskW, background: r.c, transition: 'width 1s' }} />
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, width: 22, textAlign: 'right' }}>{r.risk}</span>
              </div>
              <div role="cell">
                <Toggle on={r.smsOn} disabled={!smsInteractive} onToggle={() => onToggleSms(r.snapshot)} label={`SMS-larm för ${r.name}`} />
              </div>
              <IconChevronRight stroke={C.text4} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
