import { EventEmitter } from 'node:events';
import type { SourceId } from '@fastighetsradar/domain';

/**
 * In-process change bus for the live stream (SSE).
 *
 * The API runs as a single process on the Build pod, so an EventEmitter is sufficient – no Redis.
 * Messages carry only HINTS (which sources/properties changed); clients refetch through the
 * authenticated, tenant-scoped API. Per-property jobs (forecast, nowcast, context) and event
 * matching publish the organizations and properties they changed. `organizationIds: 'all'` is
 * left for central sources every property may read (stations, areas); those are coalesced to at
 * most one hint per `centralGapMs`, so every open dashboard does not reload on each station run
 * (docs/plans/skalning.md, Fas 3 / S-12).
 */
export interface MonitoringUpdate {
  at: string;
  sources: SourceId[];
  organizationIds: 'all' | string[];
  propertyIds: string[];
  changes: number;
}

/** What a subscriber receives: never another tenant's property ids. `all` = central source. */
export type OrganizationUpdate = Omit<MonitoringUpdate, 'organizationIds'> & { all?: true };

export const CENTRAL_SIGNAL_GAP_MS = 5 * 60_000;

export class MonitoringBus {
  private readonly emitter = new EventEmitter();
  private readonly gapMs: number;
  private readonly now: () => number;
  private lastCentral = Number.NEGATIVE_INFINITY;
  private pendingSources: Set<SourceId> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { centralGapMs?: number; now?: () => number } = {}) {
    this.emitter.setMaxListeners(500);
    this.gapMs = options.centralGapMs ?? CENTRAL_SIGNAL_GAP_MS;
    this.now = options.now ?? Date.now;
  }

  publish(u: MonitoringUpdate) {
    if (u.organizationIds !== 'all') {
      this.emitter.emit('update', u);
      return;
    }
    const now = this.now();
    if (!this.pendingSources && now - this.lastCentral >= this.gapMs) {
      this.lastCentral = now;
      this.emitter.emit('update', { ...u, propertyIds: [] });
      return;
    }
    // Within the gap: one trailing hint at its end, naming every central source that changed.
    this.pendingSources ??= new Set();
    for (const s of u.sources) this.pendingSources.add(s);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flushCentral(), Math.max(0, this.lastCentral + this.gapMs - now));
      this.timer.unref?.();
    }
  }

  private flushCentral() {
    this.timer = null;
    const sources = this.pendingSources;
    this.pendingSources = null;
    if (!sources?.size) return;
    this.lastCentral = this.now();
    this.emitter.emit('update', { at: new Date(this.lastCentral).toISOString(), sources: [...sources], organizationIds: 'all', propertyIds: [], changes: 0 } satisfies MonitoringUpdate);
  }

  subscribe(organizationId: string, fn: (u: OrganizationUpdate) => void): () => void {
    const listener = (u: MonitoringUpdate) => {
      if (u.organizationIds !== 'all' && !u.organizationIds.includes(organizationId)) return;
      // Never leak other tenants' property ids.
      if (u.organizationIds === 'all') fn({ at: u.at, sources: u.sources, propertyIds: [], changes: u.changes, all: true });
      else fn({ at: u.at, sources: u.sources, propertyIds: u.propertyIds, changes: u.changes });
    };
    this.emitter.on('update', listener);
    return () => this.emitter.off('update', listener);
  }

  listenerCount() {
    return this.emitter.listenerCount('update');
  }

  /** Drops a pending central hint (shutdown, tests). */
  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingSources = null;
  }
}
