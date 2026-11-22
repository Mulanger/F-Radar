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
  /** "Kvittera alla" / "Ångra" for an event over many properties: one history entry per property. */
  toggleMany: (changeIds: string[], next: string | null) => void;
  undo: (id: string, undoneAt: string) => void;
};
const DemoAcknowledgementContext = createContext<DemoHistory | null>(null);

export const useDemoAcknowledgements = () => useContext(DemoAcknowledgementContext);

export function DemoAcknowledgementProvider({ portfolio, children }: { portfolio: Portfolio; children: ReactNode }) {
  const [{ entries, overrides }, setHistory] = useState<Omit<DemoHistory, 'toggle' | 'toggleMany' | 'undo'>>({ entries: demoAcknowledgements, overrides: {} });

  function toggleMany(changeIds: string[], next: string | null) {
    const feedById = new Map(portfolio.feed.map((item) => [item.id, item]));
    const byProperty = new Map(portfolio.properties.map((s) => [s.property.id, s]));
    const added: DemoEntry[] = [];
    const ids = new Set<string>();
    for (const changeId of changeIds) {
      const feed = feedById.get(changeId);
      const snapshot = feed && byProperty.get(feed.propertyId);
      if (!feed || !snapshot) continue;
      ids.add(changeId);
      if (!next) continue;
      const { property } = snapshot;
      const warning = snapshot.warnings.find(({ type, sourceId }) => sourceId === feed.sourceId && feed.title.includes(type));
      added.push({
        id: `${changeId}-${next}`, changeId, propertyId: property.id, propertyName: property.name, propertyAddress: property.address,
        title: feed.title, description: warning?.summary ?? null, area: warning?.region ?? property.area,
        source: feed.sourceLabel, severity: feed.severity, eventAt: feed.publishedAt, acknowledgedAt: next,
        undoneAt: null, imported: false, isUpdate: feed.acknowledgementUpdate,
      });
    }
    if (!ids.size) return;
    const undoneAt = new Date().toISOString();
    setHistory((current) => ({
      overrides: { ...current.overrides, ...Object.fromEntries([...ids].map((id) => [id, next])) },
      entries: next ? [...added, ...current.entries] : current.entries.map((entry) => entry.changeId && ids.has(entry.changeId) && !entry.undoneAt
        ? { ...entry, undoneAt } : entry),
    }));
  }

  function toggle(changeId: string, next: string | null) {
    toggleMany([changeId], next);
  }

  function undo(id: string, undoneAt: string) {
    setHistory((current) => {
      const entry = current.entries.find((item) => item.id === id);
      if (!entry || entry.undoneAt) return current;
      const changeId = entry.changeId;
      return {
        entries: current.entries.map((item) => item.id === id ? { ...item, undoneAt } : item),
        overrides: changeId && current.overrides[changeId] === entry.acknowledgedAt
          ? { ...current.overrides, [changeId]: null } : current.overrides,
      };
    });
  }

  return <DemoAcknowledgementContext.Provider value={{ entries, overrides, toggle, toggleMany, undo }}>{children}</DemoAcknowledgementContext.Provider>;
}

export function DemoAcknowledgementHistory({ back }: { back?: React.ReactNode }) {
  const history = useDemoAcknowledgements();
  return <AcknowledgementHistory back={back} demoEntries={history?.entries ?? demoAcknowledgements} onDemoUndo={history?.undo} />;
}
