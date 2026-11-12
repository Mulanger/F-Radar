import type { AdapterResult } from './types';

/** Shared stub result for adapters whose implementation belongs to a later phase. */
export async function notImplemented<T>(sourceId: string): Promise<AdapterResult<T>> {
  return { ok: false, error: 'not_implemented', detail: `${sourceId} adapter is not implemented yet` };
}
