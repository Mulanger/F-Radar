import type { ServerEnv } from '@fastighetsradar/config';
import type { DataSourceStatus, EventPage, Portfolio, PortfolioNowcastPatch, PortfolioRowsPatch, PropertyRecord, PropertySnapshot, SourceId } from '@fastighetsradar/domain';
import { buildUtilityCoverageReport, feedNeedsAck, listSnapshot, utilityCoverageLogEntries, UTILITY_KINDS, WarningLevelSchema } from '@fastighetsradar/domain';
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
  loadOrgEvent,
  findOrgEventByLinkKey,
  loadOrgNowcasts,
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
import { alarmFeedItems, buildActiveAlarmFeed, buildFeed, buildNowcast, buildPropertySnapshot, buildUpcoming, indexMonitoring, SOURCE_LABEL, statusOfSeverity } from './snapshot';
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
/** The organization-wide part of the portfolio list: the same for every user of the organization. */
export interface OrganizationList {
  base: ReturnType<typeof buildLivePortfolio>;
  propertyIds: Set<string>;
  /** List rows (`listSnapshot`). */
  properties: PropertySnapshot[];
  utilityCoverage: Portfolio['utilityCoverage'];
  upcoming: Portfolio['upcoming'];
  settings: Portfolio['settings'];
}

/** Property saves for one organization within this window are matched once (docs/plans/skalning.md, S-29). */
export const PROPERTY_CHANGE_DEBOUNCE_MS = 2_000;
/** After this many coalesced property changes (an import), refresh the planner's statistics. */
export const ANALYZE_AFTER_CHANGES = 20;

export class MonitoringService {
  private statusCache: { at: number; value: DataSourceStatus[] } | null = null;
  private operatorCache: { at: number; value: OperatorStatus[] } | null = null;
  /** Organization lists being built: concurrent requests share one build (docs/plans/skalning.md, S-33). */
  private readonly building = new Map<string, Promise<OrganizationList>>();

  /** Pending re-matches per organization: one run after the last save in the window. */
  private readonly pendingChanges = new Map<string, { timer: ReturnType<typeof setTimeout>; count: number; done: Array<() => void> }>();

  constructor(
    private readonly db: Queryable,
    private readonly env: ServerEnv,
    readonly bus: MonitoringBus,
    private readonly logger?: { warn(obj: object, message: string): void; info?(obj: object, message: string): void },
    private readonly options: { propertyChangeDebounceMs?: number } = {},
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

  /**
   * The portfolio LIST (docs/plans/skalning.md, Fas 3): what `/v1/portfolio` serves. Only the data the
   * list reads is loaded (`LoadMonitoringOptions.list`), the organization-wide part is built at most
   * once at a time per organization, and only the feed and alarms (read state) are per user.
   * Equals `listPortfolio(portfolio())`.
   */
  async list(t: TenantContext, now = new Date()): Promise<Portfolio> {
    const [org, changes, alarmChanges] = await Promise.all([
      this.organizationList(t, now),
      listRecentChangesForOrg(this.db, t.organizationId, 60, t.userId),
      listActiveAlarmChangesForOrg(this.db, t.organizationId, t.userId),
    ]);
    return {
      ...org.base,
      regionLabel: 'Sverige',
      properties: org.properties,
      utilityCoverage: org.utilityCoverage,
      feed: buildFeed(changes, org.propertyIds),
      activeAlarms: buildActiveAlarmFeed(alarmChanges, org.properties),
      upcoming: org.upcoming,
      settings: org.settings,
    };
  }

  /** The organization-wide part of the list; a request during a build waits for that build. */
  organizationList(t: TenantContext, now = new Date()): Promise<OrganizationList> {
    const running = this.building.get(t.organizationId);
    if (running) return running;
    const build = this.buildOrganizationList(t, now).finally(() => this.building.delete(t.organizationId));
    this.building.set(t.organizationId, build);
    return build;
  }

  private async buildOrganizationList(t: TenantContext, now: Date): Promise<OrganizationList> {
    const [properties, data, statuses, utility, settings] = await Promise.all([
      listProperties(this.db, t),
      loadOrgMonitoring(this.db, t.organizationId, undefined, { list: { now } }),
      this.statuses(now),
      this.utilityInputs(t.organizationId, now),
      getOrganizationSettings(this.db, t.organizationId),
    ]);
    const index = indexMonitoring(data);
    const snapshots = await notificationSnapshots(this.db, t.organizationId, properties.map((p) => {
      const s = buildPropertySnapshot(p, t.clerkOrgId, data, statuses, now, index, { list: true });
      return utility ? withUtilityOutages(s, utility) : s;
    }));
    return {
      base: buildLivePortfolio({ clerkOrgId: t.clerkOrgId, orgSlug: t.orgSlug, properties, sources: statuses, now }),
      propertyIds: new Set(properties.map((p) => p.id)),
      properties: snapshots.map(listSnapshot),
      utilityCoverage: this.coverageReports(properties, utility),
      upcoming: buildUpcoming(snapshots, data.forecasts, now, this.env.UTILITY_OUTAGE_UPCOMING_ENABLED),
      settings: { trafficRadiusM: settings.trafficRadiusM },
    };
  }

  /** The FULL portfolio (every property's full snapshot). Not served; the reference for `list()` in tests and measurements. */
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
    const index = indexMonitoring(data);
    const snapshots = await notificationSnapshots(this.db,t.organizationId,properties.map((p) => {
      const s = buildPropertySnapshot(p, t.clerkOrgId, data, statuses, now, index);
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

  /**
   * List rows of some properties, plus the portfolio parts that change with them (feed, alarm
   * candidates, their upcoming conditions, source status). The live stream patches these into an
   * open dashboard instead of reloading the portfolio (docs/plans/skalning.md, Fas 3 / S-12).
   * Built exactly like `portfolio()`, but monitoring data is loaded for these properties only.
   */
  async rows(t: TenantContext, ids: string[], now = new Date()): Promise<PortfolioRowsPatch> {
    const [properties, data, statuses, changes, alarmChanges, utility] = await Promise.all([
      listProperties(this.db, t),
      loadOrgMonitoring(this.db, t.organizationId, ids, { list: { now } }),
      this.statuses(now),
      listRecentChangesForOrg(this.db, t.organizationId, 60, t.userId),
      listActiveAlarmChangesForOrg(this.db, t.organizationId, t.userId),
      this.utilityInputs(t.organizationId, now),
    ]);
    const wanted = new Set(ids);
    const records = properties.filter((p) => wanted.has(p.id));
    const index = indexMonitoring(data);
    const snapshots = await notificationSnapshots(this.db, t.organizationId, records.map((p) => {
      const s = buildPropertySnapshot(p, t.clerkOrgId, data, statuses, now, index, { list: true });
      return utility ? withUtilityOutages(s, utility) : s;
    }));
    const found = new Set(records.map((p) => p.id));
    return {
      generatedAt: now.toISOString(),
      properties: snapshots.map(listSnapshot),
      missing: ids.filter((id) => !found.has(id)),
      feed: buildFeed(changes, new Set(properties.map((p) => p.id))),
      alarmCandidates: alarmFeedItems(alarmChanges),
      upcoming: buildUpcoming(snapshots, data.forecasts, now, this.env.UTILITY_OUTAGE_UPCOMING_ENABLED, Number.POSITIVE_INFINITY),
      sources: statuses,
    };
  }

  /** Only the radar nowcast (refreshed every few minutes for most properties): one small query. */
  async nowcasts(t: TenantContext, ids: string[] | undefined, now = new Date()): Promise<PortfolioNowcastPatch> {
    const [rows, statuses] = await Promise.all([loadOrgNowcasts(this.db, t.organizationId, ids), this.statuses(now)]);
    return {
      generatedAt: now.toISOString(),
      nowcasts: rows.map((r) => ({ propertyId: r.property_id, nowcast: buildNowcast(r, now) })),
      sources: statuses,
    };
  }

  async property(t: TenantContext, id: string, now = new Date()): Promise<{ record: PropertyRecord; snapshot: PropertySnapshot; statuses: DataSourceStatus[] } | null> {
    const record = await getProperty(this.db, t, id);
    if (!record) return null;
    const [data, statuses, utility] = await Promise.all([loadOrgMonitoring(this.db, t.organizationId, id), this.statuses(now), this.utilityInputs(t.organizationId, now)]);
    const base = buildPropertySnapshot(record, t.clerkOrgId, data, statuses, now);
    return { record, snapshot: (await notificationSnapshots(this.db, t.organizationId, [utility ? withUtilityOutages(base, utility) : base]))[0]!, statuses };
  }

  /**
   * One event over the organization's properties (docs/plans/skalning.md, Fas 2 / S-09): the official
   * text once, every property it reaches with the feed row to acknowledge. Null when the event never
   * reached the organization.
   */
  async event(t: TenantContext, eventId: string, now = new Date()): Promise<EventPage | null> {
    const r = await loadOrgEvent(this.db, t.organizationId, eventId);
    if (!r) return null;
    const e = r.event;
    const active = e.status === 'active';
    const level = WarningLevelSchema.safeParse(e.level);
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      generatedAt: now.toISOString(),
      event: {
        id: e.id,
        sourceId: e.source_id as SourceId,
        sourceLabel: e.source_id === 'utility_outages' && typeof e.extra?.operatorName === 'string' ? e.extra.operatorName : SOURCE_LABEL[e.source_id as SourceId] ?? e.source_id,
        title: e.headline,
        level: level.success ? level.data : null,
        severity: statusOfSeverity(e.severity),
        description: e.description,
        areaLabel: e.area_label,
        publishedAt: iso(e.published_at),
        validFrom: iso(e.valid_from),
        validTo: iso(e.valid_to),
        active,
        sourceUrl: e.source_url,
        origin: 'live',
      },
      properties: r.properties.map((p) => ({
        propertyId: p.property_id,
        name: p.name,
        address: p.address,
        location: { lat: Number(p.lat), lon: Number(p.lon) },
        changeId: p.change_id ? `chg-${p.change_id}` : null,
        changeType: p.change_type,
        matched: p.matched,
        ackRequired: !!p.change_id && feedNeedsAck({ sourceId: e.source_id, changeType: p.change_type ?? '', severity: p.change_severity ?? '', eventActive: active, superseded: false }),
        acknowledgedAt: iso(p.acknowledged_at),
      })),
    };
  }

  /** The event behind a grouped SMS link (`/h/<key>`); null when unknown to the organization. */
  async eventByLinkKey(t: TenantContext, key: string) {
    return findOrgEventByLinkKey(this.db, t.organizationId, key);
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

  /**
   * Property created/moved/deleted (docs/plans/skalning.md, Fas 6 / S-29): re-match this
   * organization's properties – not the whole platform – and schedule the per-property collectors.
   * Saves within PROPERTY_CHANGE_DEBOUNCE_MS are coalesced, so an import of 500 properties re-matches
   * once; after a larger batch the planner statistics are refreshed (a fresh import of 1000 made the
   * portfolio query take 6 s until PostgreSQL had analyzed the tables). Resolves when that run is done.
   *
   * An import (S-28) passes how many properties a batch created, and `settleMs` while more batches
   * follow: geocoding makes batches seconds apart, so the short window alone would re-match after each.
   * The last call decides when the run happens; `changes: 0` only moves a pending run, never starts one.
   */
  propertyChanged(organizationId: string, options: { changes?: number; settleMs?: number } = {}): Promise<void> {
    const changes = options.changes ?? 1;
    const pending = this.pendingChanges.get(organizationId);
    if (!pending && changes <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      if (pending) clearTimeout(pending.timer);
      const entry = pending ?? { timer: undefined as unknown as ReturnType<typeof setTimeout>, count: 0, done: [] };
      entry.count += changes;
      entry.done.push(resolve);
      entry.timer = setTimeout(() => {
        this.pendingChanges.delete(organizationId);
        void this.rematchOrganization(organizationId, entry.count).finally(() => entry.done.forEach((d) => d()));
      }, options.settleMs ?? this.options.propertyChangeDebounceMs ?? PROPERTY_CHANGE_DEBOUNCE_MS);
      this.pendingChanges.set(organizationId, entry);
    });
  }

  private async rematchOrganization(organizationId: string, changes: number): Promise<void> {
    if (changes >= ANALYZE_AFTER_CHANGES) {
      try {
        await this.db.query('ANALYZE properties, property_event_matches, property_forecasts, property_context');
      } catch {
        // Statistics refresh is an optimization; autovacuum catches up anyway.
      }
    }
    try {
      const report = await this.utilityCoverage(organizationId, new Date(), true);
      await recordUtilityCoverageGaps(this.db, organizationId, report);
      for (const entry of utilityCoverageLogEntries(report)) this.logger?.warn(entry, 'utility coverage gap');
    } catch {
      // Missing migration/read failure cannot prevent saving a property; never log raw DB errors.
    }
    try {
      await requestJobRun(this.db, PER_PROPERTY_JOBS);
      const changed = [
        ...(await rematchEvents(this.db, { organizationId })),
        ...(await rematchUtilityOutages(this.db, { organizationId }).catch(() => [])),
      ];
      const props = changed.filter((c) => c.organizationId === organizationId).map((c) => c.propertyId);
      // No property ids: the property list itself changed (added, moved, removed), so open dashboards
      // reload the portfolio instead of patching rows (docs/plans/skalning.md, S-12).
      this.bus.publish({ at: new Date().toISOString(), sources: ['smhi_warnings'], organizationIds: [organizationId], propertyIds: [], changes: props.length });
      this.logger?.info?.({ propertyChanges: changes, matchChanges: props.length }, 'organization re-matched');
    } catch {
      /* monitoring tables missing or DB hiccup – the next scheduled run re-matches */
    }
  }
}
