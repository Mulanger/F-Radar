import {
  PropertyHistorySchema,
  historyPeriod,
  type HistoryQuery,
  type PropertyHistory,
} from '@fastighetsradar/domain';

export type HistoryLoadResult =
  | { status: 'ok'; history: PropertyHistory }
  | { status: 'unavailable'; reason: string };

/** Loaded only by the history view. Live failures never fall back to demo values. */
export async function loadHistory(
  mode: 'live' | 'demo',
  propertyId: string,
  query: HistoryQuery,
  referenceTime: string,
  signal?: AbortSignal,
  demoExample: 'complete' | 'gaps' | 'empty' = 'complete',
): Promise<HistoryLoadResult> {
  try {
    if (mode === 'demo') {
      const { buildDemoHistory } = await import('@fastighetsradar/domain/fixtures');
      return {
        status: 'ok',
        history: buildDemoHistory(propertyId, historyPeriod(query, new Date(referenceTime)), demoExample),
      };
    }
    const search = new URLSearchParams({ range: query.range });
    if (query.from) search.set('from', query.from);
    if (query.to) search.set('to', query.to);
    const response = await fetch(`/api/app/properties/${encodeURIComponent(propertyId)}/history?${search}`, {
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return { status: 'unavailable', reason: 'Historiken kunde inte hämtas.' };
    const parsed = PropertyHistorySchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.propertyId !== propertyId) {
      return { status: 'unavailable', reason: 'Historiktjänsten returnerade ett oväntat svar.' };
    }
    return { status: 'ok', history: parsed.data };
  } catch {
    return { status: 'unavailable', reason: 'Historiken går inte att nå just nu.' };
  }
}
