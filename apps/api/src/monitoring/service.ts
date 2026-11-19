import type { ServerEnv } from '@fastighetsradar/config';
import type { DataSourceStatus, Portfolio, PropertyRecord, PropertySnapshot } from '@fastighetsradar/domain';
import { buildUtilityCoverageReport, utilityCoverageLogEntries, UTILITY_KINDS } from '@fastighetsradar/domain';
import {
  getProperty,
  recordUtilityCoverageGaps,
  listJobs,
  listOrgPropertyConcessions,
  listOrgUtilityOutages,
  listProperties,
  listRecentChangesForOrg,
  listActiveAlarmChangesForOrg,
  listPropertyActivity,
  listPropertyEventMap,
  getPropertyEventMapEvent,
  getOrganizationSettings,
  loadOrgMonitoring,
  rematchEvents,
  rematchUtilityOutages,
  requestJobRun,
  type OrgContext,
  type Queryable,
} from '@fastighetsradar/db';
import { isWaterOutageEnabled, operatorById, resolveSourceStatuses } from '@fastighetsradar/integrations';
import { buildLivePortfolio } from '../portfolio';
import type { MonitoringBus } from './bus';
import { PER_PROPERTY_JOBS } from './jobs';
import { buildActiveAlarmFeed, buildFeed, buildPropertySnapshot, buildUpcoming } from './snapshot';
import { resolveRuntimeStatuses } from './status';
import { notificationSnapshots } from '../notifications/snapshots';
import { propertyUtilityStatus, resolveOperatorStatuses, withUtilityOutages, type OperatorStatus, type UtilityInputs } from './utility-outages';

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
  private operatorCache: { at: number; value: OperatorStatus[] } | null = null;

  constructor(
    private readonly db: Queryable,
    private readonly env: ServerEnv,
    readonly bus: MonitoringBus,
    private readonly logger?: { warn(obj: object, message: string): void },
  ) {}

  private coverageReports(properties: PropertyRecord[], inputs: UtilityInputs | null) {
    return UTILITY_KINDS.map((utility) => ({
      ...buildUtilityCoverageReport(properties.map((p) => ({ id: p.id, geocodePrecision: p.geocode.precision, positionSource: p.positionSource, statuses: inputs ? [propertyUtilityStatus(p.id, inputs, utility)] : [] })), utility),
      sources: (inputs?.operators ?? []).filter((o) => o.utilities?.includes(utility)).map((o) => ({
        operatorId: o.operatorId, name: o.name, enabled: o.enabled && (o.enabledUtilities?.includes(utility) ?? false), current: o.current,
        lastSuccessAt: o.lastSuccessAt, lastStatus: o.lastStatus, attention: o.attention,
      })),
    }));
  }

  async utilityCoverage(organizationId: string, now = new Date(), requireInputs = false) {
    const [properties, inputs] = await Promise.all([listProperties(this.db, { organizationId }), this.utilityInputs(organizationId, now)]);
    if (requireInputs && !inputs) throw new Error('Utility coverage unavailable');
    return this.coverageReports(properties, inputs);
  }

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

  /** Per grid-operator health (outage maps). */
  async operatorStatuses(now = new Date()): Promise<OperatorStatus[]> {
    if (this.operatorCache && now.getTime() - this.operatorCache.at < 5_000) return this.operatorCache.value;
    let value: OperatorStatus[];
    try {
      value = resolveOperatorStatuses(this.env, await listJobs(this.db), now);
    } catch {
      value = resolveOperatorStatuses(this.env, [], now);
    }
    this.operatorCache = { at: now.getTime(), value };
    return value;
  }

  /** Outage inputs for an organization. Missing tables (migration not applied) → no outage section. */
  private async utilityInputs(organizationId: string, now: Date): Promise<UtilityInputs | null> {
    try {
      const [outages, concessions, operators, municipalities] = await Promise.all([
        listOrgUtilityOutages(this.db, organizationId),
        listOrgPropertyConcessions(this.db, organizationId),
        this.operatorStatuses(now),
        this.db.query<{ property_id: string; municipality: string | null }>('SELECT id AS property_id, municipality FROM properties WHERE organization_id=$1', [organizationId]),
      ]);
      return { outages: outages.filter((o) => {
        const op = operatorById(o.operator_id);
        return (o.utility !== 'water' || isWaterOutageEnabled(o.operator_id, this.env)) && (o.utility !== 'gas' || this.env.SOURCE_UTILITY_GAS_ENABLED)
          && (!op?.enableFlag || this.env[op.enableFlag] === true) && (!op?.utilityFlags?.[o.utility] || this.env[op.utilityFlags[o.utility]!] === true);
      }), concessions, operators, municipalities: municipalities.rows };
    } catch {
      return null;
    }
  }

  async portfolio(t: TenantContext, now = new Date()): Promise<Portfolio> {
    const [properties, data, statuses, changes, activeAlarms, utility, settings] = await Promise.all([
      listProperties(this.db, t),
      loadOrgMonitoring(this.db, t.organizationId),
      this.statuses(now),
      listRecentChangesForOrg(this.db, t.organizationId, 60, t.userId),
      listActiveAlarmChangesForOrg(this.db, t.organizationId, t.userId),
      this.utilityInputs(t.organizationId, now),
      getOrganizationSettings(this.db, t.organizationId),
    ]);
    const base = buildLivePortfolio({ clerkOrgId: t.clerkOrgId, orgSlug: t.orgSlug, properties, sources: statuses, now });
    const snapshots = await notificationSnapshots(this.db,t.organizationId,properties.map((p) => {
      const s = buildPropertySnapshot(p, t.clerkOrgId, data, statuses, now);
      return utility ? withUtilityOutages(s, utility) : s;
    }));
    return {
      ...base,
      regionLabel: 'Sverige',
      properties: snapshots,
      utilityCoverage: this.coverageReports(properties, utility),
      feed: buildFeed(changes, new Set(properties.map((p) => p.id))),
      activeAlarms: buildActiveAlarmFeed(activeAlarms, snapshots),
      upcoming: buildUpcoming(snapshots, data.forecasts, now, this.env.UTILITY_OUTAGE_UPCOMING_ENABLED),
      settings: { trafficRadiusM: settings.trafficRadiusM },
    };
  }

  async property(t: TenantContext, id: string, now = new Date()): Promise<{ record: PropertyRecord; snapshot: PropertySnapshot; statuses: DataSourceStatus[] } | null> {
    const record = await getProperty(this.db, t, id);
    if (!record) return null;
    const [data, statuses, utility] = await Promise.all([loadOrgMonitoring(this.db, t.organizationId, id), this.statuses(now), this.utilityInputs(t.organizationId, now)]);
    const base = buildPropertySnapshot(record, t.clerkOrgId, data, statuses, now);
    return { record, snapshot: (await notificationSnapshots(this.db, t.organizationId, [utility ? withUtilityOutages(base, utility) : base]))[0]!, statuses };
  }

  async changes(t: TenantContext, limit: number) {
    return listRecentChangesForOrg(this.db, t.organizationId, limit);
  }

  /** Short activity log for one property; null when the property is not in the organization. */
  async activity(t: TenantContext, id: string) {
    if (!(await getProperty(this.db, t, id))) return null;
    return listPropertyActivity(this.db, t.organizationId, id);
  }

  /** Published geometry of the property's nearby traffic events ("Visa på karta"); null when the property is not in the organization. */
  async eventMap(t: TenantContext, id: string) {
    if (!(await getProperty(this.db, t, id))) return null;
    return listPropertyEventMap(this.db, t.organizationId, id);
  }

  /** One feed event on the map, also after it ended (null when unknown to this org/property). */
  async eventMapEvent(t: TenantContext, id: string, eventId: string) {
    return getPropertyEventMapEvent(this.db, t.organizationId, id, eventId);
  }

  /** Property created/moved/deleted: re-match events now, schedule per-property collectors. */
  async propertyChanged(organizationId: string): Promise<void> {
    try {
      const report = await this.utilityCoverage(organizationId, new Date(), true);
      await recordUtilityCoverageGaps(this.db, organizationId, report);
      for (const entry of utilityCoverageLogEntries(report)) this.logger?.warn(entry, 'utility coverage gap');
    } catch {
      // Missing migration/read failure cannot prevent saving a property; never log raw DB errors.
    }
    try {
      await requestJobRun(this.db, PER_PROPERTY_JOBS);
      const changes = [...(await rematchEvents(this.db)), ...(await rematchUtilityOutages(this.db).catch(() => []))];
      const props = changes.filter((c) => c.organizationId === organizationId).map((c) => c.propertyId);
      this.bus.publish({ at: new Date().toISOString(), sources: ['smhi_warnings'], organizationIds: [organizationId], propertyIds: props, changes: props.length });
    } catch {
      /* monitoring tables missing or DB hiccup – the next scheduled run re-matches */
    }
  }
}
