export interface AcknowledgementHistoryEntry {
  id: string;
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  source: string;
  title: string;
  description: string | null;
  area: string | null;
  severity: string;
  eventAt: string;
  acknowledgedAt: string;
  undoneAt: string | null;
  imported: boolean;
  isUpdate?: boolean;
}

export interface AcknowledgementHistoryFilters {
  from?: string;
  to?: string;
  property?: string;
  /** Properties currently in this group (S-20). */
  group?: string;
  cursor?: string;
}

export interface AcknowledgementHistoryPage {
  entries: AcknowledgementHistoryEntry[];
  nextCursor: string | null;
  properties: { id: string; name: string; address: string }[];
}

export const ACKNOWLEDGEMENT_PAGE_SIZE = 30;

/** The whole selection for the report (PDF/CSV) in one response, at most this many entries. */
export const ACKNOWLEDGEMENT_EXPORT_MAX = 10_000;

export interface AcknowledgementExport {
  entries: AcknowledgementHistoryEntry[];
  /** More entries match the selection than `ACKNOWLEDGEMENT_EXPORT_MAX`; the newest are included. */
  truncated: boolean;
}

/** One event in the report: its text once, and every property it was acknowledged for. */
export interface AcknowledgementEventGroup {
  key: string;
  title: string;
  source: string;
  severity: string;
  area: string | null;
  description: string | null;
  eventAt: string;
  isUpdate: boolean;
  /** Newest acknowledgement first. */
  entries: AcknowledgementHistoryEntry[];
}

/**
 * Groups acknowledgements by event (docs/plans/skalning.md, Fas 2 / S-08): a county warning
 * acknowledged for 300 properties is one section with the warning text once, not 300 copies.
 * The history has no event id; the same source, title, event time and text identify the event.
 * Groups keep the order of their newest acknowledgement.
 */
export function groupAcknowledgements(entries: AcknowledgementHistoryEntry[]): AcknowledgementEventGroup[] {
  const groups = new Map<string, AcknowledgementEventGroup>();
  for (const e of entries) {
    const key = JSON.stringify([e.source, e.title, e.eventAt, e.description ?? '', e.isUpdate === true]);
    let g = groups.get(key);
    if (!g) {
      g = { key, title: e.title, source: e.source, severity: e.severity, area: e.area, description: e.description, eventAt: e.eventAt, isUpdate: e.isUpdate === true, entries: [] };
      groups.set(key, g);
    }
    g.entries.push(e);
  }
  return [...groups.values()];
}

