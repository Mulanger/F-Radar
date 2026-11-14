'use client';

import { MeasuredRainPanel } from './MeasuredRainPanel';
import { NowcastPanel } from './NowcastPanel';
import { ForecastDays } from './ForecastDays';

import { useRef } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildDetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO } from '@/lib/design/tokens';
import { usePropertyEditor } from './PropertyEditorHost';
import { IconArrowLeft, IconSliders } from '../ui/icons';
import { PropertySwitcher } from './PropertySwitcher';
import { PropertyHero3D } from './PropertyHero3D';
import { PropertyRiskPanel } from './PropertyRiskPanel';
import { OfficialWarnings } from './OfficialWarnings';
import { EnvironmentalMetrics } from './EnvironmentalMetrics';
import { WeatherCharts } from './WeatherCharts';
import { WaterRiskPanel } from './WaterRiskPanel';
import { LocalEventsPanel } from './LocalEventsPanel';
import { LocalEventsMap } from '../maps/LocalEventsMap';
import { PropertyTimeline } from './PropertyTimeline';
import { SMSRulesPanel } from './SMSRulesPanel';
import { MonitoringContextPanel } from './MonitoringContextPanel';

const HistoryView = dynamic(() => import('./HistoryView').then((module) => module.HistoryView));

/**
 * Page 2 – Property Detail (`/properties/[propertyId]`).
 *
 * Rendered from `properties/layout.tsx` so this component (and its WebGL scene and
 * Leaflet map) stays mounted while switching properties: the scene is updated in place
 * and the map flies to the new location, exactly like the prototype.
 */
export function PropertyDetail() {
  const router = useRouter();
  const params = useParams<{ propertyId?: string }>();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const historyOpen = searchParams.get('vy') === 'historik';
  const ds = useDashboard();
  const smsRef = useRef<HTMLDivElement>(null);
  const editor = usePropertyEditor();
  const id = params?.propertyId ? decodeURIComponent(params.propertyId) : undefined;
  const s = ds.property(id);
  if (!s) return null;

  const isDemo = ds.mode === 'demo';
  const d = buildDetailVM(ds.portfolio, s, { ready: ds.ready, metric: ds.metric, smsOn: ds.isSmsOn(s), isRuleOn: ds.isRuleOn });
  const switchTo = (pid: string) => {
    if (historyOpen) {
      router.push(`${ds.basePath}/properties/${encodeURIComponent(pid)}?${searchParams.toString()}`, { scroll: false });
      return;
    }
    ds.openProperty(pid, { scroll: false });
  };
  const configure = () => {
    if (!isDemo) { router.push(`/sms-rules?property=${encodeURIComponent(s.property.id)}`); return; }
    const el = smsRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 24, behavior: 'smooth' });
  };

  return (
    <div data-screen-label="02 Property Detail" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 20, animation: 'frFade .45s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <nav aria-label="Brödsmulor" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text4 }}>
            <a
              href="/overview"
              onClick={(e) => {
                e.preventDefault();
                ds.goOverview();
              }}
              style={{ color: C.text3 }}
            >
              Alla fastigheter
            </a>
            <span>/</span>
            <span style={{ color: C.ink }} aria-current="page">{d.name}</span>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.05, fontWeight: 500, letterSpacing: '-0.035em' }}>{d.name}</h1>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, padding: '6px 12px', borderRadius: 12, background: d.bg, color: d.c }}>
              <span style={{ position: 'relative', width: 7, height: 7 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'currentColor', animation: 'frPulse 2s ease-out infinite' }} />
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'currentColor' }} />
              </span>
              {d.status}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13.5, color: C.text3, flexWrap: 'wrap' }}>
            <span>{d.address}</span>
            <span style={{ color: C.sep }}>·</span>
            <span>{d.buildingLine}</span>
            <span style={{ color: C.sep }}>·</span>
            <span title={d.positionNote} style={{ fontFamily: FONT_MONO, fontSize: 12.5 }}>{d.lat.toFixed(5)}, {d.lon.toFixed(5)}</span>
            <span style={{ color: C.sep }}>·</span>
            <span>{isDemo ? 'Demoögonblick' : 'Uppdaterad'} {d.updatedAt}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <PropertySwitcher d={d} onSwitch={switchTo} />
          {editor.enabled && (
            <button
              onClick={() => editor.openEdit(s)}
              style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderRadius: 22, background: C.white, border: '1px solid rgba(20,23,26,0.08)', fontSize: 13.5, cursor: 'pointer', color: C.ink }}
            >
              Redigera fastighet
            </button>
          )}
          <button
            onClick={ds.goOverview}
            style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderRadius: 22, background: C.white, border: '1px solid rgba(20,23,26,0.08)', fontSize: 13.5, cursor: 'pointer', color: C.ink }}
          >
            <IconArrowLeft />
            Tillbaka till portföljen
          </button>
          <button
            onClick={configure}
            className="fr-hover-dark"
            style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', borderRadius: 22, background: C.ink, color: '#fff', border: 'none', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}
          >
            <IconSliders size={15} sw={1.8} />
            Konfigurera larm
          </button>
        </div>
      </div>

      <div role="group" aria-label="Fastighetsvy" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 24, background: '#E6E9E8', width: 'fit-content' }}>
        {['Nu', 'Historik'].map((label) => {
          const selected = (label === 'Historik') === historyOpen;
          return (
            <button
              key={label}
              aria-pressed={selected}
              onClick={() => {
            const query = new URLSearchParams(searchParams.toString());
            if (label === 'Historik') query.set('vy', 'historik');
            else query.delete('vy');
            router.replace(`${pathname}${query.size ? '?' + query.toString() : ''}`, { scroll: false });
              }}
              style={{
                border: 'none', borderRadius: 20, padding: '10px 24px',
                background: selected ? '#fff' : 'transparent', color: selected ? C.ink : C.text2,
                fontSize: 13, cursor: 'pointer', boxShadow: selected ? '0 1px 3px #14171a12' : undefined,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <PropertyHero3D d={d} isDemo={isDemo} />
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <PropertyRiskPanel d={d} isDemo={isDemo} />
          <OfficialWarnings d={d} />
        </div>
      </div>

      {historyOpen && <HistoryView key={s.property.id} propertyId={s.property.id} mode={ds.mode} referenceTime={ds.portfolio.generatedAt} />}

      {/* Leaflet needs non-zero layout dimensions even when a direct history link hides its panels. */}
      <div
        style={historyOpen ? {
          position: 'absolute', width: '100%', height: 0, overflow: 'hidden',
          visibility: 'hidden', pointerEvents: 'none',
        } : { display: 'contents' }}
        aria-hidden={historyOpen}
        inert={historyOpen}
      >
      <EnvironmentalMetrics d={d} isDemo={isDemo} />

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <WeatherCharts d={d} isDemo={isDemo} onMetric={ds.setMetric} />
        <WaterRiskPanel d={d} />
      </div>

      <NowcastPanel d={d} />
      <ForecastDays d={d} />

      <MeasuredRainPanel d={d} />
      {d.live && <MonitoringContextPanel d={d} />}

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <LocalEventsPanel d={d} />
        <LocalEventsMap d={d} />
      </div>

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <PropertyTimeline d={d} />
        <SMSRulesPanel ref={smsRef} d={d} onToggleSms={() => ds.toggleSms(s)} onToggleRule={ds.toggleRule} />
      </div>
      </div>
    </div>
  );
}
