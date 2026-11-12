'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Portfolio, PropertySnapshot } from '@fastighetsradar/domain';

export type ChartMetric = 'temp' | 'rain' | 'wind' | 'hum';
export type DataMode = 'demo' | 'live';

/**
 * Client UI state shared by both dashboard pages (ported from the prototype's
 * component state). SMS toggles are LOCAL UI state in demo mode only; in live mode the
 * SMS engine does not exist yet (Phase 8), so toggles are disabled and nothing is sent.
 */
interface DashboardState {
  mode: DataMode;
  /** Route prefix: '' for the live dashboard, '/demo' for the fixture dashboard. */
  basePath: string;
  /** Live customer properties can be added/edited; demo fixtures cannot. */
  canEdit: boolean;
  /** SMS toggles are interactive only in demo mode (no SMS engine yet). */
  smsInteractive: boolean;
  /** Re-fetches server data after a mutation. */
  refresh: () => void;
  portfolio: Portfolio;
  /** Becomes true shortly after mount so bars/gauges animate in (prototype `ready`). */
  ready: boolean;
  group: string;
  setGroup: (g: string) => void;
  layers: { weather: boolean; flood: boolean };
  toggleLayer: (k: 'weather' | 'flood') => void;
  metric: ChartMetric;
  setMetric: (m: ChartMetric) => void;
  /** Last property opened – target of the sidebar "Properties" link. */
  selectedId: string;
  isSmsOn: (s: PropertySnapshot) => boolean;
  toggleSms: (s: PropertySnapshot) => void;
  isRuleOn: (ruleId: string, fallback: boolean) => boolean;
  toggleRule: (ruleId: string, current: boolean) => void;
  openProperty: (id: string, opts?: { scroll?: boolean }) => void;
  goOverview: () => void;
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
  const [lastId, setLastId] = useState(portfolio.properties[0]?.property.id ?? '');

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 120);
    return () => clearTimeout(t);
  }, []);

  // Keep "last selected" in sync with the URL (also covers direct links / back button).
  useEffect(() => {
    const m = /\/properties\/([^/]+)/.exec(pathname ?? '');
    if (m?.[1]) setLastId(decodeURIComponent(m[1]));
  }, [pathname]);

  const byId = useMemo(() => new Map(portfolio.properties.map((p) => [p.property.id, p])), [portfolio]);
  // Fall back to the first property if the remembered one was deleted.
  const selectedId = byId.has(lastId) ? lastId : (portfolio.properties[0]?.property.id ?? '');

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const openProperty = useCallback(
    (id: string, opts: { scroll?: boolean } = {}) => {
      setLastId(id);
      router.push(`${basePath}/properties/${encodeURIComponent(id)}`, { scroll: false });
      if (opts.scroll !== false) scrollTop();
    },
    [router, basePath],
  );

  const goOverview = useCallback(() => {
    router.push(`${basePath}/overview`, { scroll: false });
    scrollTop();
  }, [router, basePath]);

  const smsInteractive = mode === 'demo';
  const value: DashboardState = {
    mode,
    basePath,
    canEdit: mode === 'live',
    smsInteractive,
    refresh: () => router.refresh(),
    portfolio,
    ready,
    group,
    setGroup,
    layers,
    toggleLayer: (k) => setLayers((l) => ({ ...l, [k]: !l[k] })),
    metric,
    setMetric,
    selectedId,
    isSmsOn: (s) => (s.property.id in smsOff ? !smsOff[s.property.id] : s.sms.enabled),
    toggleSms: (s) => {
      if (!smsInteractive) return;
      setSmsOff((prev) => {
        const on = s.property.id in prev ? !prev[s.property.id] : s.sms.enabled;
        return { ...prev, [s.property.id]: on };
      });
    },
    isRuleOn: (ruleId, fallback) => (ruleId in rules ? rules[ruleId]! : fallback),
    toggleRule: (ruleId, current) => {
      if (smsInteractive) setRules((r) => ({ ...r, [ruleId]: !current }));
    },
    openProperty,
    goOverview,
    property: (id) => (id ? byId.get(id) : undefined),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboard(): DashboardState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboard must be used inside <DashboardStateProvider>');
  return v;
}
