'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { dashboardSection, propertyHref, propertySmsHref, recordDashboardDeparture, type DashboardSection } from '@/lib/navigation/dashboard';
import type { Portfolio, PropertySnapshot } from '@fastighetsradar/domain';

export type ChartMetric = 'temp' | 'rain' | 'wind' | 'hum';
export type DataMode = 'demo' | 'live';

/**
 * Client UI state shared by both dashboard pages (ported from the prototype's
 * component state). SMS toggles are LOCAL UI state in demo mode only; in live mode the
 * persisted notification preferences are updated through the authenticated BFF in live mode.
 */
interface DashboardState {
  mode: DataMode;
  /** Route prefix: '' for the live dashboard, '/demo' for the fixture dashboard. */
  basePath: string;
  /** Live customer properties can be added/edited; demo fixtures cannot. */
  canEdit: boolean;
  /** Live writes require an organization administrator; demo toggles stay local. */
  smsInteractive: boolean;
  /** Re-fetches server data after a mutation. */
  refresh: () => void;
  portfolio: Portfolio;
  unseenAlarmCount: number;
  /** Becomes true shortly after mount so bars/gauges animate in (prototype `ready`). */
  ready: boolean;
  group: string;
  setGroup: (g: string) => void;
  layers: { weather: boolean; flood: boolean };
  toggleLayer: (k: 'weather' | 'flood') => void;
  metric: ChartMetric;
  setMetric: (m: ChartMetric) => void;
  isSmsOn: (s: PropertySnapshot) => boolean;
  toggleSms: (s: PropertySnapshot) => void;
  isRuleOn: (ruleId: string, fallback: boolean) => boolean;
  toggleRule: (ruleId: string, current: boolean) => void;
  openProperty: (id: string, opts?: { replace?: boolean; from?: DashboardSection }) => void;
  goProperties: () => void;
  property: (id: string | undefined) => PropertySnapshot | undefined;
}

const Ctx = createContext<DashboardState | null>(null);

export function DashboardStateProvider({
  mode,
  basePath,
  portfolio,
  children,
}: {
  mode: DataMode;
  basePath: string;
  portfolio: Portfolio;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [group, setGroup] = useState('all');
  const [layers, setLayers] = useState({ weather: false, flood: true });
  const [metric, setMetric] = useState<ChartMetric>('temp');
  const [smsOff, setSmsOff] = useState<Record<string, boolean>>({});
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [seenAlarms, setSeenAlarms] = useState(() => new Set<string>());
  const viewedAlertsPage = useRef(false);
  const alarmIds = useMemo(() => mode === 'demo'
    ? portfolio.feed.filter((item) => item.ackRequired).map((item) => item.id)
    : (portfolio.activeAlarms ?? []).flatMap((item) => item.unreadAlarmId ? [item.unreadAlarmId] : []),
  [mode, portfolio.activeAlarms, portfolio.feed]);

  useEffect(() => {
    if (pathname !== `${basePath}/alerts`) {
      viewedAlertsPage.current = false;
      return;
    }
    const markDisplayedAlarms = () => {
      if (document.visibilityState === 'hidden' || viewedAlertsPage.current || (mode === 'live' && !portfolio.activeAlarms)) return;
      viewedAlertsPage.current = true;
      if (!alarmIds.length) return;
      setSeenAlarms((seen) => new Set([...seen, ...alarmIds]));
      if (mode !== 'live') return;

      // A visit clears only the revisions already rendered on that visit. Later data keeps its badge.
      const batches = Array.from({ length: Math.ceil(alarmIds.length / 500) }, (_, i) => alarmIds.slice(i * 500, (i + 1) * 500));
      void Promise.allSettled(batches.map(async (changeIds) => {
        const response = await fetch('/api/app/feed/alarm-reads', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changeIds }),
        });
        if (!response.ok) throw new Error('Alarm reads could not be saved');
      })).then((results) => {
        const failed = new Set(batches.flatMap((batch, i) => results[i]?.status === 'rejected' ? batch : []));
        if (failed.size) setSeenAlarms((seen) => new Set([...seen].filter((id) => !failed.has(id))));
        router.refresh();
      });
    };
    markDisplayedAlarms();
    document.addEventListener('visibilitychange', markDisplayedAlarms);
    return () => document.removeEventListener('visibilitychange', markDisplayedAlarms);
  }, [alarmIds, basePath, mode, pathname, portfolio.activeAlarms, router]);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 120);
    return () => clearTimeout(t);
  }, []);

  const byId = useMemo(() => new Map(portfolio.properties.map((p) => [p.property.id, p])), [portfolio]);

  const openProperty = useCallback(
    (id: string, opts: { replace?: boolean; from?: DashboardSection } = {}) => {
      const origin = opts.replace ? opts.from : dashboardSection(pathname?.slice(basePath.length + 1));
      const href = propertyHref(basePath, id, origin);
      if (pathname === propertyHref(basePath, id)) return;
      recordDashboardDeparture(href, opts.replace);
      if (opts.replace) router.replace(href, { scroll: false });
      else router.push(href);
    },
    [router, basePath, pathname],
  );

  const goProperties = useCallback(() => {
    router.replace(`${basePath}/properties`);
  }, [router, basePath]);

  const smsInteractive = mode === 'demo' || portfolio.viewer.role === 'org:admin';
  const value: DashboardState = {
    mode,
    basePath,
    canEdit: mode === 'live',
    smsInteractive,
    refresh: () => router.refresh(),
    portfolio,
    unseenAlarmCount: alarmIds.filter((id) => !seenAlarms.has(id)).length,
    ready,
    group,
    setGroup,
    layers,
    toggleLayer: (k) => setLayers((l) => ({ ...l, [k]: !l[k] })),
    metric,
    setMetric,
    isSmsOn: (s) => (s.property.id in smsOff ? !smsOff[s.property.id] : s.sms.enabled),
    toggleSms: (s) => {
      if (!smsInteractive) return;
      if (mode === 'live') {
        if (!s.alertRules.some(r=>r.enabled)) { const href = propertySmsHref(s.property.id, dashboardSection(new URLSearchParams(window.location.search).get('via'))); recordDashboardDeparture(href); router.push(href); return; }
        void fetch(`/api/app/notifications/properties/${s.property.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!s.sms.enabled})}).then(async r=>{if(!r.ok)throw new Error((await r.json()).detail??'Inställningen kunde inte sparas');router.refresh();}).catch(e=>window.alert(e.message));
        return;
      }
      setSmsOff((prev) => {
        const on = s.property.id in prev ? !prev[s.property.id] : s.sms.enabled;
        return { ...prev, [s.property.id]: on };
      });
    },
    isRuleOn: (ruleId, fallback) => (ruleId in rules ? rules[ruleId]! : fallback),
    toggleRule: (ruleId, current) => {
      if (!smsInteractive) return;
      if (mode === 'live') { void fetch(`/api/app/notifications/rules/${ruleId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!current})}).then(async r=>{if(!r.ok)throw new Error((await r.json()).detail??'Regeln kunde inte sparas');router.refresh();}).catch(e=>window.alert(e.message)); }
      else setRules((r) => ({ ...r, [ruleId]: !current }));
    },
    openProperty,
    goProperties,
    property: (id) => (id ? byId.get(id) : undefined),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboard(): DashboardState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboard must be used inside <DashboardStateProvider>');
  return v;
}
