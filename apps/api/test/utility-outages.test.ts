import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import type { JobRow, OrgUtilityOutageRow } from '@fastighetsradar/db';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { inReminderWindow, outageSmsPhase, type OutageCandidate } from '../src/notifications/engine';
import {
  aggregateUtilityJob,
  buildUtilityOutageJobs,
  propertyUtilityStatus,
  resolveOperatorStatuses,
  withUtilityOutages,
  type OperatorStatus,
} from '../src/monitoring/utility-outages';

const NOW = new Date('2026-11-14T13:30:00Z');
const ACTIVATED = new Date('2026-11-14T10:00:00Z');
const all = { category: 'power_outage' as const, utilities: ['electricity' as const], unplanned: true, planned: true, plannedReminder: true, restored: true, changes: true };
const cand = (o: Partial<OutageCandidate> = {}): OutageCandidate => ({
  change_type: 'new',
  created_at: new Date(NOW.getTime() - 60_000),
  last_seen_at: new Date(NOW.getTime() - 60_000),
  source_updated_at: null,
  match_method: 'outage_polygon',
  geocode_precision: 'building',
  position_source: 'geocoded',
  utility: 'electricity',
  kind: 'unplanned',
  state: 'ongoing',
  planned_start: null,
  ...o,
});

describe('outage SMS phase (anti-spam, docs/plans/stromavbrott.md §2.1, §7)', () => {
  it('unplanned ongoing inside the polygon → start SMS', () => {
    expect(outageSmsPhase(all, cand(), NOW, ACTIVATED)).toBe('start');
  });
  it('never for area, near or point matches, or an approximate position', () => {
    for (const m of ['outage_postal_area', 'outage_area', 'outage_adjacent', 'outage_point', 'outage_street', null])
      expect(outageSmsPhase(all, cand({ match_method: m }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand({ geocode_precision: 'street' }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand({ geocode_precision: 'street', position_source: 'manual_pin' }), NOW, ACTIVATED)).toBe('start');
  });
  it('never for unknown kind, stale data, old changes or before the rule was activated', () => {
    expect(outageSmsPhase(all, cand({ kind: 'unknown' }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand({ last_seen_at: new Date(NOW.getTime() - 21 * 60_000) }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand({ created_at: new Date(NOW.getTime() - 31 * 60_000) }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand(), NOW, new Date(NOW.getTime()))).toBeNull();
  });
  it('planned: only when published, at least 2 h before start, and only if selected', () => {
    const planned = cand({ kind: 'planned', state: 'upcoming', planned_start: new Date(NOW.getTime() + 3 * 3600_000) });
    expect(outageSmsPhase(all, planned, NOW, ACTIVATED)).toBe('planned');
    expect(outageSmsPhase({ ...all, planned: false }, planned, NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, { ...planned, planned_start: new Date(NOW.getTime() + 3600_000) }, NOW, ACTIVATED)).toBeNull();
    // Planned work that has started is not announced again.
    expect(outageSmsPhase(all, cand({ kind: 'planned', state: 'ongoing' }), NOW, ACTIVATED)).toBeNull();
    // Customer-count-only updates of a fault never produce an SMS.
    expect(outageSmsPhase(all, cand({ change_type: 'updated' }), NOW, ACTIVATED)).toBeNull();
  });
  it('restored and changes depend on the rule (and, when enqueuing, on an earlier SMS)', () => {
    expect(outageSmsPhase(all, cand({ change_type: 'ended', state: 'restored' }), NOW, ACTIVATED)).toBe('restored');
    expect(outageSmsPhase({ ...all, restored: false }, cand({ change_type: 'ended', state: 'restored' }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand({ change_type: 'ended', kind: 'planned', state: 'withdrawn' }), NOW, ACTIVATED)).toBe('change');
    // A fault that vanished from the operator's list is not known to be over: no SMS at all.
    expect(outageSmsPhase(all, cand({ change_type: 'ended', kind: 'unplanned', state: 'withdrawn' }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand({ change_type: 'ended', kind: 'unknown', state: 'withdrawn' }), NOW, ACTIVATED)).toBeNull();
    expect(outageSmsPhase(all, cand({ change_type: 'updated', kind: 'planned', state: 'upcoming' }), NOW, ACTIVATED)).toBe('change');
    expect(outageSmsPhase({ ...all, changes: false }, cand({ change_type: 'updated', kind: 'planned', state: 'upcoming' }), NOW, ACTIVATED)).toBeNull();
  });
  it('reminder window is 18:00–21:00 Stockholm time on the day before start (DST-safe)', () => {
    const start = new Date('2026-11-17T08:00:00Z'); // 09:00 local
    expect(inReminderWindow(start, new Date('2026-11-16T17:00:00Z'))).toBe(true); // 18:00
    expect(inReminderWindow(start, new Date('2026-11-16T19:59:00Z'))).toBe(true); // 20:59
    expect(inReminderWindow(start, new Date('2026-11-16T20:00:00Z'))).toBe(false); // 21:00
    expect(inReminderWindow(start, new Date('2026-11-16T16:59:00Z'))).toBe(false); // 17:59
    expect(inReminderWindow(start, new Date('2026-11-15T18:00:00Z'))).toBe(false); // two days before
    // Night of the DST change (25 Oct 2026): evening before still works.
    expect(inReminderWindow(new Date('2026-10-25T08:00:00Z'), new Date('2026-10-24T17:30:00Z'))).toBe(true);
  });
});

const job = (id: string, o: Partial<JobRow> = {}): JobRow =>
  ({
    job_id: id,
    source_id: 'utility_outages',
    interval_seconds: 300,
    enabled: true,
    next_run_at: NOW,
    lease_owner: null,
    lease_until: null,
    last_started_at: NOW,
    last_finished_at: NOW,
    last_success_at: new Date(NOW.getTime() - 60_000),
    last_status: 'ok',
    last_error_code: null,
    last_error_detail: null,
    last_items: 1,
    last_duration_ms: 100,
    consecutive_failures: 0,
    source_updated_at: null,
    ...o,
  }) as JobRow;

describe('collector jobs and health', () => {
  it('new operators need their own opt-in and old Ei placeholders resolve without a production data rewrite', () => {
    const env = loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true', SOURCE_UTILITY_KRAFTRINGEN_ENABLED: 'true' });
    const inputs = { outages: [], concessions: [{ property_id: 'p', operator_id: 'ei:Kraftringen Nät AB', operator_name: 'Kraftringen Nät AB' }], operators: resolveOperatorStatuses(env, [job('utility_outages:kraftringen_elnat')], NOW) };
    expect(propertyUtilityStatus('p', inputs)).toMatchObject({ coverage: 'monitored', operator: { id: 'kraftringen_elnat' } });
    const off = { ...inputs, operators: resolveOperatorStatuses(loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true' }), [job('utility_outages:kraftringen_elnat')], NOW) };
    expect(propertyUtilityStatus('p', off).coverage).toBe('not_monitored');
  });
  it('one job per operator, all disabled unless SOURCE_UTILITY_OUTAGES_ENABLED', () => {
    const off = buildUtilityOutageJobs(loadServerEnv({}));
    expect(off.length).toBeGreaterThan(10);
    expect(off.every((j) => !j.enabled)).toBe(true);
    const on = buildUtilityOutageJobs(loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true', UTILITY_OUTAGE_OPERATORS: 'vattenfall,digpro:fev' }));
    expect(on.filter((j) => j.enabled).map((j) => j.jobId).sort()).toEqual(['utility_concessions:digpro:fev', 'utility_concessions:ei', 'utility_outages:digpro:fev', 'utility_outages:vattenfall']);
    expect(on.every((j) => j.intervalSeconds === 300 || ['utility_outages:solor', 'utility_outages:svoa'].includes(j.jobId) && j.intervalSeconds === 900 || j.jobId.startsWith('utility_concessions:'))).toBe(true);
  });
  it('poll interval cannot go below 120 s', () => {
    expect(() => loadServerEnv({ UTILITY_OUTAGE_POLL_SECONDS: '60' })).toThrow();
  });
  it('source health = oldest operator success, error if any operator fails', () => {
    const agg = aggregateUtilityJob([
      job('utility_outages:vattenfall'),
      job('utility_outages:digpro:fev', { last_success_at: new Date(NOW.getTime() - 3600_000), last_status: 'error', last_error_code: 'timeout' }),
      job('utility_outages:digpro:vax', { enabled: false, last_success_at: null }),
    ])!;
    expect(agg.job_id).toBe('utility_outages');
    // One failing operator does not fail the source: it is reported per operator and per property.
    expect(agg.last_success_at!.getTime()).toBe(job('x').last_success_at!.getTime());
    expect(agg.last_status).toBe('ok');
    expect(agg.last_error_code).toBeNull();
    // An operator that never succeeded (blocked host) does not make the source "never succeeded".
    const blocked = aggregateUtilityJob([job('utility_outages:vattenfall'), job('utility_outages:digpro:hem', { last_success_at: null, last_status: 'error', last_error_code: 'network' })])!;
    expect(blocked.last_status).toBe('ok');
    expect(blocked.last_success_at).not.toBeNull();
    // Nothing delivering → the source fails.
    const down = aggregateUtilityJob([
      job('utility_outages:vattenfall', { last_status: 'error', last_error_code: 'timeout' }),
      job('utility_outages:digpro:hem', { last_success_at: null, last_status: 'error', last_error_code: 'network' }),
    ])!;
    expect(down.last_status).toBe('error');
    expect(down.last_error_code).toBe('timeout');
    expect(aggregateUtilityJob([job('smhi_warnings')])).toBeNull();
  });
  it('keeps the source current while noting operators that could not be checked', async () => {
    const { resolveRuntimeStatuses } = await import('../src/monitoring/status');
    const env = loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true' });
    const s = resolveRuntimeStatuses(env, [
      job('utility_outages:vattenfall'),
      job('utility_outages:digpro:hem', { last_success_at: null, last_status: 'error', last_error_code: 'network' }),
    ], NOW).find((x) => x.sourceId === 'utility_outages')!;
    expect(s.status).toBe('ok');
    expect(s.note).toMatch(/^1 av \d+ nätbolag kunde inte kontrolleras/);
  });
  it('flags a feed that keeps failing to parse as "format_changed", other repeated failures as "unreachable"', () => {
    const env = loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true' });
    const st = resolveOperatorStatuses(env, [
      job('utility_outages:vattenfall', { last_status: 'error', last_error_code: 'invalid_payload', consecutive_failures: 3 }),
      job('utility_outages:digpro:fev', { last_status: 'error', last_error_code: 'timeout', consecutive_failures: 6 }),
      job('utility_outages:digpro:vax', { last_status: 'error', last_error_code: 'invalid_payload', consecutive_failures: 2 }),
    ], NOW);
    expect(st.find((o) => o.operatorId === 'vattenfall')!.attention).toBe('format_changed');
    expect(st.find((o) => o.operatorId === 'digpro:fev')!.attention).toBe('unreachable');
    expect(st.find((o) => o.operatorId === 'digpro:vax')!.attention).toBeNull();
  });

  it('operator is current only with a recent success and no failing last run', () => {
    const env = loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true' });
    const st = resolveOperatorStatuses(env, [job('utility_outages:vattenfall'), job('utility_outages:digpro:fev', { last_success_at: new Date(NOW.getTime() - 25 * 60_000) })], NOW);
    expect(st.find((o) => o.operatorId === 'vattenfall')).toMatchObject({ enabled: true, current: true });
    expect(st.find((o) => o.operatorId === 'digpro:fev')).toMatchObject({ enabled: true, current: false });
    expect(st.find((o) => o.operatorId === 'digpro:vax')).toMatchObject({ enabled: false, current: false });
    for (const last_status of ['partial', 'error', null] as const) {
      expect(resolveOperatorStatuses(env, [job('utility_outages:vattenfall', { last_status })], NOW).find((o) => o.operatorId === 'vattenfall')!.current).toBe(false);
    }
    expect(resolveOperatorStatuses(env, [job('utility_outages:vattenfall', { last_status: 'partial' })], NOW).find((o) => o.operatorId === 'vattenfall')!.attention).toBe('format_changed');
    expect(resolveOperatorStatuses(env, [job('utility_outages:vattenfall', { last_success_at: null })], NOW).find((o) => o.operatorId === 'vattenfall')!.current).toBe(false);
  });
});

const PID = '11111111-1111-4111-8111-111111111111';
const row = (o: Partial<OrgUtilityOutageRow> = {}): OrgUtilityOutageRow => ({
  property_id: PID,
  event_id: 'e1',
  match_method: 'outage_polygon',
  distance_m: '0',
  effective_severity: 'critical',
  operator_id: 'vattenfall',
  operator_name: 'Vattenfall Eldistribution',
  utility: 'electricity',
  kind: 'unplanned',
  state: 'ongoing',
  affected_customers: 120,
  area_customer_total: null,
  reported_at: null,
  planned_start: null,
  planned_end: null,
  actual_start: new Date('2026-11-14T13:05:00Z'),
  estimated_restore: new Date('2026-11-14T16:00:00Z'),
  restored_at: null,
  restored_inferred: false,
  ended_at: null,
  place_label: 'INGARÖ',
  operator_text: 'Felsökning pågår',
  cause: null,
  source_url: 'https://www.vattenfalleldistribution.se/stromavbrott/pagaende-stromavbrott/',
  geometry: null,
  geocode_precision: 'building',
  position_source: 'geocoded',
  ...o,
});
const op = (o: Partial<OperatorStatus> = {}): OperatorStatus => ({
  operatorId: 'vattenfall',
  name: 'Vattenfall Eldistribution',
  mapUrl: 'https://x',
  enabled: true,
  current: true,
  lastSuccessAt: NOW.toISOString(),
  lastStatus: 'ok',
  errorCode: null,
  attention: null,
  ...o,
});
const snap = (status: PropertySnapshot['property']['status'] = 'normal') =>
  ({
    property: { id: PID, status, statusReason: 'Inga aktiva officiella varningar för fastighetens läge' },
    activeAlertCount: 0,
    monitoring: { statusMethod: 'highest_official_warning' },
  }) as unknown as PropertySnapshot;

describe('property outage section and status', () => {
  it('coverage: "Inga registrerade avbrott" only inside a monitored, current grid', () => {
    const inputs = (operators: OperatorStatus[], concessions = [{ property_id: PID, operator_id: 'vattenfall' }]) => ({ outages: [], concessions, operators });
    expect(propertyUtilityStatus(PID, inputs([op()])).coverage).toBe('monitored');
    expect(propertyUtilityStatus(PID, inputs([op({ current: false })])).coverage).toBe('stale');
    expect(propertyUtilityStatus(PID, inputs([op({ enabled: false })])).coverage).toBe('not_monitored');
    expect(propertyUtilityStatus(PID, inputs([op()], [])).coverage).toBe('unknown');
  });

  it('national concession areas name operators we do not monitor; two operators mean a boundary case', () => {
    const notMon = propertyUtilityStatus(PID, { outages: [], concessions: [{ property_id: PID, operator_id: 'ei:Kraftringen Nät AB', operator_name: 'Kraftringen Nät AB' }], operators: [op()] });
    expect(notMon).toMatchObject({ coverage: 'not_monitored', operator: { id: 'kraftringen_elnat', name: 'Kraftringen Nät AB', mapUrl: null } });
    // Same operator from two sources (Ei + operator feed) is still one operator.
    const dup = propertyUtilityStatus(PID, { outages: [], concessions: [{ property_id: PID, operator_id: 'vattenfall', operator_name: 'Vattenfall Eldistribution AB' }, { property_id: PID, operator_id: 'vattenfall' }], operators: [op()] });
    expect(dup.coverage).toBe('monitored');
    const border = propertyUtilityStatus(PID, { outages: [], concessions: [{ property_id: PID, operator_id: 'vattenfall' }, { property_id: PID, operator_id: 'ei:Kraftringen Nät AB', operator_name: 'Kraftringen Nät AB' }], operators: [op()] });
    expect(border).toMatchObject({ coverage: 'unknown', operator: null, operatorCandidates: ['Vattenfall Eldistribution', 'Kraftringen Nät AB'] });
  });

  it('an unplanned outage covering the address makes the property red with a descriptive reason', () => {
    const s = withUtilityOutages(snap(), { outages: [row()], concessions: [], operators: [op()] });
    expect(s.property.status).toBe('critical');
    expect(s.property.statusReason).toBe('Oplanerat strömavbrott registrerat av Vattenfall Eldistribution');
    expect(s.activeAlertCount).toBe(1);
    expect(s.utilityOutages![0]!.current).toHaveLength(1);
    expect(s.monitoring!.statusMethod).toBe('highest_official_warning_or_outage');
  });

  it('upcoming planned work is listed but does not change today’s status', () => {
    const s = withUtilityOutages(snap(), { outages: [row({ kind: 'planned', state: 'upcoming', planned_start: new Date('2026-11-30T08:00:00Z'), actual_start: null })], concessions: [], operators: [op()] });
    expect(s.property.status).toBe('normal');
    expect(s.utilityOutages![0]!.upcoming).toHaveLength(1);
    expect(s.utilityOutages![0]!.upcoming[0]!.severity).toBe('monitor');
  });

  it('an unplanned outage in the postal area gives Info with a caveat; small area and near matches never raise status', () => {
    const area = withUtilityOutages(snap(), { outages: [row({ match_method: 'outage_postal_area', affected_customers: 60 })], concessions: [], operators: [op()] });
    expect(area.property.status).toBe('monitor');
    expect(area.property.statusReason).toBe('Oplanerat strömavbrott – Vattenfall Eldistribution – i fastighetens postnummerområde');
    expect(area.activeAlertCount).toBe(0);
    expect(area.utilityOutages![0]!.current[0]!.severity).toBe('monitor');
    expect(area.utilityOutages![0]!.current[0]!.precisionLabel).toBe('I fastighetens postnummerområde – inte säkert att fastigheten berörs');
    const plannedArea = withUtilityOutages(snap(), { outages: [row({ match_method: 'outage_postal_area', affected_customers: 60, kind: 'planned' })], concessions: [], operators: [op()] });
    expect(plannedArea.property.status).toBe('normal');
    const small = withUtilityOutages(snap(), { outages: [row({ match_method: 'outage_postal_area', affected_customers: 8 })], concessions: [], operators: [op()] });
    expect(small.property.status).toBe('normal');
    expect(small.utilityOutages![0]!.nearby).toHaveLength(1);
    expect(small.utilityOutages![0]!.current).toHaveLength(0);
    const near = withUtilityOutages(snap(), { outages: [row({ match_method: 'outage_adjacent', distance_m: '12' })], concessions: [], operators: [op()] });
    expect(near.property.status).toBe('normal');
    expect(near.utilityOutages![0]!.nearby).toHaveLength(1);
    expect(near.utilityOutages![0]!.current).toHaveLength(0);
  });

  it('district heating outages get their own section and wording; electricity section is always there', () => {
    const s = withUtilityOutages(snap(), { outages: [row({ utility: 'district_heating', match_method: 'outage_address', geocode_precision: 'street' })], concessions: [], operators: [op()] });
    expect(s.utilityOutages!.map((u) => u.utility)).toEqual(['electricity', 'district_heating']);
    expect(s.utilityOutages![1]!.current[0]).toMatchObject({ precisionLevel: 'high', severity: 'critical' });
    expect(s.property.statusReason).toBe('Oplanerat fjärrvärmeavbrott registrerat av Vattenfall Eldistribution');
    expect(withUtilityOutages(snap(), { outages: [], concessions: [], operators: [op()] }).utilityOutages!.map((u) => u.utility)).toEqual(['electricity']);
  });

  it('riskindex gets "El och värme": unplanned outage at the address → Förhöjd, never Hög', () => {
    const risk = { method: 'fr_risk_index_v1' as const, score: 0, level: 'low' as const, summary: '', assessedFactors: 5, factors: [] };
    const s = withUtilityOutages({ ...snap(), riskIndex: risk } as PropertySnapshot, { outages: [row()], concessions: [{ property_id: PID, operator_id: 'vattenfall' }], operators: [op()] });
    const f = s.riskIndex!.factors.find((x) => x.key === 'power')!;
    expect(f).toMatchObject({ assessed: true, points: 55, ceiling: 60 });
    expect(s.riskIndex!.level).toBe('elevated');
    const quiet = withUtilityOutages({ ...snap(), riskIndex: risk } as PropertySnapshot, { outages: [], concessions: [{ property_id: PID, operator_id: 'vattenfall' }], operators: [op()] });
    expect(quiet.riskIndex!.factors.find((x) => x.key === 'power')).toMatchObject({ assessed: true, points: 0 });
    const unmonitored = withUtilityOutages({ ...snap(), riskIndex: risk } as PropertySnapshot, { outages: [], concessions: [], operators: [op()] });
    expect(unmonitored.riskIndex!.factors.find((x) => x.key === 'power')!.assessed).toBe(false);
    const planned = withUtilityOutages({ ...snap(), riskIndex: risk } as PropertySnapshot, { outages: [row({ kind: 'planned' })], concessions: [], operators: [op()] });
    expect(planned.riskIndex!.level).toBe('low');
    const notAssessed = withUtilityOutages({ ...snap(), riskIndex: { ...risk, score: null, level: null } } as PropertySnapshot, { outages: [row()], concessions: [], operators: [op()] });
    expect(notAssessed.riskIndex!.score).toBeNull(); // warnings not current → still "Ej bedömd"
  });

  it('a red official warning is not lowered by a smaller outage', () => {
    const s = withUtilityOutages(snap('critical'), { outages: [row({ kind: 'planned', state: 'ongoing' })], concessions: [], operators: [op()] });
    expect(s.property.status).toBe('critical');
    expect(s.property.statusReason).toBe('Inga aktiva officiella varningar för fastighetens läge');
  });
});
