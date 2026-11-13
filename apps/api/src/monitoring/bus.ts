import { EventEmitter } from 'node:events';
import type { SourceId } from '@fastighetsradar/domain';

/**
 * In-process change bus for the live stream (SSE).
 *
 * The API runs as a single process on the Build pod, so an EventEmitter is sufficient – no Redis.
 * Messages carry only HINTS (which sources/properties changed); clients refetch through the
 * authenticated, tenant-scoped API. `organizationIds: 'all'` is used for central sources whose
 * refresh affects every organization (forecasts, observations).
 */
export interface MonitoringUpdate {
  at: string;
  sources: SourceId[];
  organizationIds: 'all' | string[];
  propertyIds: string[];
  changes: number;
}

export class MonitoringBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(500);
  }
  publish(u: MonitoringUpdate) {
    this.emitter.emit('update', u);
  }
  subscribe(organizationId: string, fn: (u: Omit<MonitoringUpdate, 'organizationIds'>) => void): () => void {
    const listener = (u: MonitoringUpdate) => {
      if (u.organizationIds !== 'all' && !u.organizationIds.includes(organizationId)) return;
      // Never leak other tenants' property ids.
      fn({ at: u.at, sources: u.sources, propertyIds: u.organizationIds === 'all' ? [] : u.propertyIds, changes: u.changes });
    };
    this.emitter.on('update', listener);
    return () => this.emitter.off('update', listener);
  }
  listenerCount() {
    return this.emitter.listenerCount('update');
  }
}
