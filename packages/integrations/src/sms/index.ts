import { resolveSmsMode, type ServerEnv } from '@fastighetsradar/config';
import type { SmsMessage, SmsProvider, SmsSendResult } from '../types';

/**
 * SMS provider factory (IMPLEMENTATION.md §12.4).
 *
 * Phase 1 guarantees: NO real SMS can be sent.
 *  - `disabled`: every send is blocked.
 *  - `dry_run`: messages are recorded in memory only; no network request is made.
 *  - `live`: not available in this phase – the factory refuses to create it.
 */

const GSM_BASIC = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const GSM_EXTENSION = new Set('\f^{}\\[~]|€');

/** Estimates SMS parts (GSM-7: 160/153, UCS-2: 70/67). */
export function estimateSmsParts(message: string): number {
  const gsm = [...message].every((c) => GSM_BASIC.has(c) || GSM_EXTENSION.has(c));
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  // GSM extension characters take two septets; UTF-16 counts astral characters twice.
  const len = gsm ? [...message].reduce((n, c) => n + (GSM_EXTENSION.has(c) ? 2 : 1), 0) : message.length;
  if (len === 0) return 0;
  return len <= single ? 1 : Math.ceil(len / multi);
}

export interface DryRunSmsProvider extends SmsProvider {
  readonly mode: 'dry_run';
  readonly outbox: ReadonlyArray<SmsMessage & { parts: number; at: string }>;
}

export function createSmsProvider(env: ServerEnv): SmsProvider {
  const mode = resolveSmsMode(env);
  if (mode === 'disabled') {
    return {
      mode: 'disabled',
      send: async (msg): Promise<SmsSendResult> => ({ status: 'blocked', parts: estimateSmsParts(msg.message), reason: 'SMS_ENABLED=false' }),
    };
  }
  if (mode === 'live') {
    throw new Error('Live SMS sending is not implemented in this phase (46elks adapter is Phase 8, live activation Phase 11).');
  }
  const outbox: Array<SmsMessage & { parts: number; at: string }> = [];
  const seen = new Set<string>();
  const provider: DryRunSmsProvider = {
    mode: 'dry_run',
    outbox,
    send: async (msg) => {
      const parts = estimateSmsParts(msg.message);
      if (seen.has(msg.dedupKey)) return { status: 'blocked', parts, reason: 'duplicate dedupKey' };
      seen.add(msg.dedupKey);
      outbox.push({ ...msg, parts, at: new Date().toISOString() });
      return { status: 'dry_run', parts };
    },
  };
  return provider;
}
