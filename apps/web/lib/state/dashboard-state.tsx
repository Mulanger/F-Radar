'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { DataMode } from '@fastighetsradar/config';
import type { Portfolio, PropertySnapshot } from '@fastighetsradar/domain';

export type ChartMetric = 'temp' | 'rain' | 'wind' | 'hum';

/**
 * Client UI state shared by both dashboard pages (ported from the prototype's
 * component state). SMS toggles here are LOCAL UI state only – nothing is persisted
 * or sent. Persisting rules belongs to the alert-rules API (Agent 2).
 */
interface DashboardState {
  mode: DataMode;
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
  portfolio,
  children,
}: {
  mode: DataMode;
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
  const [selectedId, setSelectedId] = useState(portfolio.properties[0]?.property.id ?? '');

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 120);
    return () => clearTimeout(t);
  }, []);

  // Keep "last selected" in sync with the URL (also covers direct links / back button).
  useEffect(() => {
    const m = /^\/properties\/([^/]+)/.exec(pathname ?? '');
    if (m?.[1]) setSelectedId(decodeURIComponent(m[1]));
  }, [pathname]);

  const byId = useMemo(() => new Map(portfolio.properties.map((p) => [p.property.id, p])), [portfolio]);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const openProperty = useCallback(
    (id: string, opts: { scroll?: boolean } = {}) => {
      setSelectedId(id);
      router.push(`/properties/${encodeURIComponent(id)}`, { scroll: false });
      if (opts.scroll !== false) scrollTop();
    },
    [router],
  );

  const goOverview = useCallback(() => {
    router.push('/overview', { scroll: false });
    scrollTop();
  }, [router]);

  const value: DashboardState = {
    mode,
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
    toggleSms: (s) =>
      setSmsOff((prev) => {
        const on = s.property.id in prev ? !prev[s.property.id] : s.sms.enabled;
        return { ...prev, [s.property.id]: on };
      }),
    isRuleOn: (ruleId, fallback) => (ruleId in rules ? rules[ruleId]! : fallback),
    toggleRule: (ruleId, current) => setRules((r) => ({ ...r, [ruleId]: !current })),
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
