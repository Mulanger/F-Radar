'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { AcknowledgementHistoryEntry, Portfolio } from '@fastighetsradar/domain';
import { demoAcknowledgements } from '@/lib/demo/acknowledgements';
import { AcknowledgementHistory } from './AcknowledgementHistory';

type DemoEntry = AcknowledgementHistoryEntry & { changeId?: string };
type DemoHistory = {
  entries: DemoEntry[];
  overrides: Record<string, string | null>;
  toggle: (changeId: string, next: string | null) => void;
};
const DemoAcknowledgementContext = createContext<DemoHistory | null>(null);

export const useDemoAcknowledgements = () => useContext(DemoAcknowledgementContext);

export function DemoAcknowledgementProvider({ portfolio, children }: { portfolio: Portfolio; children: ReactNode }) {
  const [{ entries, overrides }, setHistory] = useState<Omit<DemoHistory, 'toggle'>>({ entries: demoAcknowledgements, overrides: {} });

  function toggle(changeId: string, next: string | null) {
    const feed = portfolio.feed.find(({ id }) => id === changeId);
    const snapshot = portfolio.properties.find(({ property }) => property.id === feed?.propertyId);
    if (!feed || !snapshot) return;
    const { property } = snapshot;
    const warning = snapshot.warnings.find(({ type, sourceId }) => sourceId === feed.sourceId && feed.title.includes(type));
    const undoneAt = new Date().toISOString();

    setHistory((current) => ({
      overrides: { ...current.overrides, [changeId]: next },
      entries: next ? [{
        id: `${changeId}-${next}`, changeId, propertyId: property.id, propertyName: property.name, propertyAddress: property.address,
        title: feed.title, description: warning?.summary ?? null, area: warning?.region ?? property.area,
        source: feed.sourceLabel, severity: feed.severity, eventAt: feed.publishedAt, acknowledgedAt: next,
        undoneAt: null, imported: false,
      }, ...current.entries] : current.entries.map((entry) => entry.changeId === changeId && !entry.undoneAt
        ? { ...entry, undoneAt } : entry),
    }));
  }

  return <DemoAcknowledgementContext.Provider value={{ entries, overrides, toggle }}>{children}</DemoAcknowledgementContext.Provider>;
}

export function DemoAcknowledgementHistory() {
  return <AcknowledgementHistory demoEntries={useDemoAcknowledgements()?.entries ?? demoAcknowledgements} />;
}
