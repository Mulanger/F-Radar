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
}

export interface AcknowledgementHistoryFilters {
  from?: string;
  to?: string;
  property?: string;
  cursor?: string;
}

export interface AcknowledgementHistoryPage {
  entries: AcknowledgementHistoryEntry[];
  nextCursor: string | null;
  properties: { id: string; name: string; address: string }[];
}

export const ACKNOWLEDGEMENT_PAGE_SIZE = 30;
