import {
  PROPERTY_IMPORT_BATCH_MAX,
  type PropertyImportResponse,
  type PropertyImportResult,
  type PropertyImportRow,
} from '@fastighetsradar/domain';

/**
 * Sends an import's rows in batches (docs/plans/skalning.md, Fas 6 / S-28). Rows the API did not reach
 * (`pending`: time budget, a passing search error) go back to the front of the queue; three rounds in a
 * row without progress, or three failed requests, pause the import so the customer can continue later.
 */

export type SubmitBatch = (request: { rows: PropertyImportRow[]; final: boolean }, signal: AbortSignal) => Promise<PropertyImportResponse>;

export type ImportRunState = 'running' | 'stopped' | 'paused' | 'done';

export interface ImportRunProgress {
  state: ImportRunState;
  /** Rows with a final status. */
  done: number;
  total: number;
  results: ReadonlyMap<number, PropertyImportResult>;
  /** Why the run paused. */
  message?: string;
}

const STALLS_BEFORE_PAUSE = 3;
const THROTTLED_BEFORE_PAUSE = 30;
const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

export class ImportRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function runImport(
  rows: PropertyImportRow[],
  submit: SubmitBatch,
  options: {
    signal: AbortSignal;
    onProgress: (p: ImportRunProgress) => void;
    /** Results of an earlier, interrupted run of the same rows. */
    results?: Map<number, PropertyImportResult>;
    batchSize?: number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<ImportRunProgress> {
  const results = options.results ?? new Map<number, PropertyImportResult>();
  const sleep = options.sleep ?? sleepFor;
  const batchSize = options.batchSize ?? PROPERTY_IMPORT_BATCH_MAX;
  const queue = rows.filter((r) => !results.has(r.row) || results.get(r.row)!.status === 'pending');
  const total = rows.length;
  const progress = (state: ImportRunState, message?: string): ImportRunProgress => {
    const p = { state, done: [...results.values()].filter((r) => r.status !== 'pending').length, total, results, message };
    options.onProgress(p);
    return p;
  };
  let stalls = 0;
  let failures = 0;
  let throttled = 0;
  progress('running');
  while (queue.length) {
    if (options.signal.aborted) return progress('stopped');
    const batch = queue.splice(0, batchSize);
    let response: PropertyImportResponse;
    try {
      response = await submit({ rows: batch, final: queue.length === 0 }, options.signal);
    } catch (err) {
      queue.unshift(...batch);
      if (options.signal.aborted) return progress('stopped');
      // Too many batches at once: wait and send again – it is not a failure.
      if (err instanceof ImportRequestError && err.status === 429 && ++throttled < THROTTLED_BEFORE_PAUSE) {
        await sleep(2_000, options.signal);
        continue;
      }
      // A rejected request (validation, no access) will not get better by sending it again.
      if (err instanceof ImportRequestError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        return progress('paused', err.message);
      }
      if (++failures >= STALLS_BEFORE_PAUSE) return progress('paused', 'Importen fick inget svar från servern. Försök igen om en stund – redan importerade rader hoppas över.');
      await sleep(2_000 * failures, options.signal);
      continue;
    }
    failures = 0;
    throttled = 0;
    const byRow = new Map(batch.map((r) => [r.row, r]));
    const retry: PropertyImportRow[] = [];
    for (const result of response.results) {
      const row = byRow.get(result.row);
      if (!row) continue;
      results.set(result.row, result);
      if (result.status === 'pending') retry.push(row);
    }
    queue.unshift(...retry);
    if (retry.length === batch.length) {
      if (++stalls >= STALLS_BEFORE_PAUSE) {
        return progress('paused', 'Adressökningen svarar inte just nu. Försök igen om en stund – redan importerade rader hoppas över.');
      }
      progress('running');
      await sleep(2_000 * stalls, options.signal);
      continue;
    }
    stalls = 0;
    progress('running');
  }
  return progress('done');
}

/** The live API through the app's proxy. */
export const submitToApi: SubmitBatch = async (request, signal) => {
  const res = await fetch('/api/app/properties/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) {
    const message =
      res.status === 401 ? 'Din inloggning har gått ut – logga in igen och importera filen på nytt.'
      : res.status === 403 ? 'Du saknar behörighet att lägga till fastigheter.'
      : res.status === 400 ? 'Servern godtog inte raderna.'
      : `Importen misslyckades (${res.status}).`;
    throw new ImportRequestError(res.status, message);
  }
  return (await res.json()) as PropertyImportResponse;
};
