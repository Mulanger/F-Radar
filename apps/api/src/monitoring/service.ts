import type { ServerEnv } from '@fastighetsradar/config';
import type { DataSourceStatus, Portfolio, PropertyRecord, PropertySnapshot } from '@fastighetsradar/domain';
import { getProperty, listJobs, listProperties, listRecentChangesForOrg, loadOrgMonitoring, rematchEvents, requestJobRun, type OrgContext, type Queryable } from '@fastighetsradar/db';
import { resolveSourceStatuses } from '@fastighetsradar/integrations';
import { buildLivePortfolio } from '../portfolio';
import type { MonitoringBus } from './bus';
import { PER_PROPERTY_JOBS } from './jobs';
import { buildFeed, buildPropertySnapshot, buildUpcoming } from './snapshot';
import { resolveRuntimeStatuses } from './status';

export interface TenantContext extends OrgContext {
  clerkOrgId: string;
  orgSlug: string | null;
}

/**
 * Read side of monitoring: assembles tenant-scoped snapshots from stored data.
 * Never calls an external provider (the dashboard may be opened as often as users like).
 */
export class MonitoringService {
  private statusCache: { at: number; value: DataSourceStatus[] } | null = null;

  constructor(
    private readonly db: Queryable,
    private readonly env: ServerEnv,
    readonly bus: MonitoringBus,
  ) {}

  async statuses(now = new Date()): Promise<DataSourceStatus[]> {
    if (this.statusCache && now.getTime() - this.statusCache.at < 5_000) return this.statusCache.value;
    let value: DataSourceStatus[];
    try {
      value = resolveRuntimeStatuses(this.env, await listJobs(this.db), now);
    } catch {
      value = resolveSourceStatuses(this.env); // provider_jobs missing (migration not applied)
    }
    this.statusCache = { at: now.getTime(), value };
    return value;
  }

  async portfolio(t: TenantContext, now = new Date()): Promise<Portfolio> {
    const [properties, data, statuses, changes] = await Promise.all([
      listProperties(this.db, t),
      loadOrgMonitoring(this.db, t.organizationId),
      this.statuses(now),
      listRecentChangesForOrg(this.db, t.organizationId, 60),
    ]);
    const base = buildLivePortfolio({ clerkOrgId: t.clerkOrgId, orgSlug: t.orgSlug, properties, sources: statuses, now });
    const snapshots = properties.map((p) => buildPropertySnapshot(p, t.clerkOrgId, data, statuses, now));
    return {
      ...base,
      regionLabel: 'Sverige',
      properties: snapshots,
      feed: buildFeed(changes, new Set(properties.map((p) => p.id))),
      upcoming: buildUpcoming(snapshots, data.forecasts, now),
    };
  }

  async property(t: TenantContext, id: string, now = new Date()): Promise<{ record: PropertyRecord; snapshot: PropertySnapshot; statuses: DataSourceStatus[] } | null> {
    const record = await getProperty(this.db, t, id);
    if (!record) return null;
    const [data, statuses] = await Promise.all([loadOrgMonitoring(this.db, t.organizationId, id), this.statuses(now)]);
    return { record, snapshot: buildPropertySnapshot(record, t.clerkOrgId, data, statuses, now), statuses };
  }

  async changes(t: TenantContext, limit: number) {
    return listRecentChangesForOrg(this.db, t.organizationId, limit);
  }

  /** Property created/moved/deleted: re-match events now, schedule per-property collectors. */
  async propertyChanged(organizationId: string): Promise<void> {
    try {
      await requestJobRun(this.db, PER_PROPERTY_JOBS);
      const changes = await rematchEvents(this.db);
      const props = changes.filter((c) => c.organizationId === organizationId).map((c) => c.propertyId);
      this.bus.publish({ at: new Date().toISOString(), sources: ['smhi_warnings'], organizationIds: [organizationId], propertyIds: props, changes: props.length });
    } catch {
      /* monitoring tables missing or DB hiccup – the next scheduled run re-matches */
    }
  }
}
