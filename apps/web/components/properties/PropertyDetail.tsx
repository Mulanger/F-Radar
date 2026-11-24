'use client';

import { MeasuredRainPanel } from './MeasuredRainPanel';
import { NowcastPanel } from './NowcastPanel';
import { ForecastDays } from './ForecastDays';

import { useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { usePropertyDetail } from '@/lib/state/property-detail';
import { buildDetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO } from '@/lib/design/tokens';
import { usePropertyEditor } from './PropertyEditorHost';
import { IconSliders } from '../ui/icons';
import { PropertySwitcher } from './PropertySwitcher';
import { PropertyHero3D } from './PropertyHero3D';
import { PropertyRiskPanel } from './PropertyRiskPanel';
import { OfficialWarnings } from './OfficialWarnings';
import { EnvironmentalMetrics } from './EnvironmentalMetrics';
import { WeatherCharts } from './WeatherCharts';
import { WaterRiskPanel } from './WaterRiskPanel';
import { LocalEvents } from './LocalEvents';
import { PropertyTimeline } from './PropertyTimeline';
import { SMSRulesPanel } from './SMSRulesPanel';
import { useMobileDashboard } from '@/lib/design/use-mobile-dashboard';
import { DashboardBackLink, DashboardLink } from '../shell/DashboardLink';
import { dashboardSection, propertySmsHref, sectionTarget } from '@/lib/navigation/dashboard';
import { MobilePropertyDetail } from '../mobile/MobilePropertyDetail';

/**
 * Page 2 – Property Detail (`/properties/[propertyId]`).
 *
 * Rendered from `properties/layout.tsx` so this component (and its WebGL scene and
 * Leaflet map) stays mounted while switching properties: the scene is updated in place
 * and the map flies to the new location, exactly like the prototype.
 */
export function PropertyDetail() {
  const from = dashboardSection(useSearchParams().get('via'));
  const params = useParams<{ propertyId?: string }>();
  const ds = useDashboard();
  const smsRef = useRef<HTMLDivElement>(null);
  const editor = usePropertyEditor();
  const mobile = useMobileDashboard();
  const id = params?.propertyId ? decodeURIComponent(params.propertyId) : undefined;
  // The page's full snapshot; the portfolio list entry only as a fallback when it could not be loaded.
  const detail = usePropertyDetail(id);
  const s = detail?.snapshot ?? ds.property(id);
  const detailMissing = detail && !detail.snapshot ? detail.reason ?? 'Fastighetens detaljer kunde inte hämtas.' : null;
  const smsOn = s ? ds.isSmsOn(s) : false;
  // buildDetailVM sorts the whole portfolio for prev/next; build it once per input change (S-03).
  const { portfolio, ready, metric, isRuleOn } = ds;
  const d = useMemo(() => (s ? buildDetailVM(portfolio, s, { ready, metric, smsOn, isRuleOn }) : null), [portfolio, s, ready, metric, smsOn, isRuleOn]);
  if (!s || !d) return null;

  const isDemo = ds.mode === 'demo';
  const target = sectionTarget(ds.basePath, from ?? 'properties');
  const smsHref = propertySmsHref(s.property.id, from);
  const switchTo = (pid: string) => ds.openProperty(pid, { replace: true, from });
  const configure = () => {
    const el = smsRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 24, behavior: 'smooth' });
  };

  const missingNote = detailMissing && (
    <div role="status" style={{ padding: '12px 16px', borderRadius: 14, background: 'oklch(0.96 0.03 85)', color: C.text2, fontSize: 13 }}>
      {detailMissing} Prognoser och mätningar visas inte just nu; uppgifterna nedan kommer från översikten.
    </div>
  );

  if (mobile) return <MobilePropertyDetail d={d} onSwitch={switchTo} target={target} smsHref={smsHref} notice={missingNote} />;

  return (
    <div className="fr-desktop-dashboard-view" data-screen-label="02 Property Detail" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 20, animation: 'frFade .45s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <nav aria-label="Brödsmulor" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text4 }}>
            <DashboardBackLink target={target} />
            <span aria-hidden="true">/</span>
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

          {isDemo
            ? <button onClick={configure} className="fr-dashboard-action"><IconSliders size={15} />Konfigurera larm</button>
            : <DashboardLink href={smsHref} className="fr-dashboard-action"><IconSliders size={15} />Konfigurera larm</DashboardLink>}
        </div>
      </div>

      {missingNote}

      <div className="fr-property-summary">
        <div className="fr-property-summary-grid">
          <PropertyHero3D d={d} isDemo={isDemo} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <PropertyRiskPanel d={d} isDemo={isDemo} />
            <OfficialWarnings d={d} />
          </div>
          <EnvironmentalMetrics d={d} isDemo={isDemo} />
        </div>
      </div>

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <WeatherCharts d={d} isDemo={isDemo} onMetric={ds.setMetric} />
        <WaterRiskPanel d={d} />
      </div>

      <NowcastPanel d={d} />
      <ForecastDays d={d} />

      <MeasuredRainPanel d={d} />

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <LocalEvents d={d} layout="desktop" />
      </div>

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <PropertyTimeline d={d} />
        <SMSRulesPanel ref={smsRef} d={d} smsHref={smsHref} onToggleSms={() => ds.toggleSms(s)} onToggleRule={ds.toggleRule} />
      </div>
    </div>
  );
}
