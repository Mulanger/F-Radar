import {
  HISTORY,
  PropertyHistorySchema,
  frostWeeks,
  historyDates,
  historyGaps,
  historyKpis,
  historyMonths,
  monthlyFlowReference,
  selectHistoryStation,
  type HistoryPeriod,
  type HistorySeries,
  type HistoryStation,
  type PropertyHistory,
} from '@fastighetsradar/domain';
import {
  aggregateStoredHistory,
  getProperty,
  historyArchiveStartedAt,
  historyBackfillTargets,
  historyCatalogDue,
  markHistoryBackfill,
  propertyDailySeries,
  propertyFlowReferences,
  propertyHistoryEvents,
  propertyHistoryNormals,
  propertyHistoryStations,
  propertyHourlyHistory,
  saveHistoryCatalog,
  saveHistoryNormals,
  saveHistoryFlowReferences,
  saveStationDaily,
  type OrgContext,
  type Queryable,
} from '@fastighetsradar/db';
import { HISTORY_PARAMETERS, fetchHistoryCatalog, fetchHistorySeries } from '@fastighetsradar/integrations';
import type { JobContext, JobResult } from './jobs';

/** Read-only assembly. No external calls, and authorization precedes all history reads. */
export async function loadPropertyHistory(
  db: Queryable,
  org: OrgContext,
  id: string,
  period: HistoryPeriod,
): Promise<PropertyHistory | null> {
  const property = await getProperty(db, org, id);
  if (!property) return null;
  const [candidates, events, startedAt, hourly] = await Promise.all([
    propertyHistoryStations(db, org.organizationId, id, HISTORY_PARAMETERS),
    propertyHistoryEvents(db, org.organizationId, id, period),
    historyArchiveStartedAt(db),
    propertyHourlyHistory(db, org.organizationId, id, period),
  ]);
  const dates = historyDates(period);
  const stations: HistoryStation[] = [];
  const series: HistorySeries[] = [];
  for (const parameter of HISTORY_PARAMETERS) {
    const station = selectHistoryStation(
      candidates.filter((s) => s.sourceId === parameter.sourceId && s.parameter === parameter.key),
      parameter.distanceM,
    );
    if (!station) continue;
    const rows = await propertyDailySeries(db, org.organizationId, id, station, parameter.definition, period);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    stations.push(station);
    series.push({
      key: parameter.key,
      station: station.id,
      unit: parameter.unit,
      dayDefinition: parameter.definition,
      values: dates.map((date) => {
        const row = byDate.get(date);
        return row?.coverage === HISTORY.dailyCoverage ? row.value : null;
      }),
      coverage: dates.map((date) => byDate.get(date)?.coverage ?? 0),
      ...(parameter.key === 'sea_level'
        ? {
            min: dates.map((date) =>
              byDate.get(date)?.coverage === 1 ? (byDate.get(date)!.min ?? null) : null,
            ),
            max: dates.map((date) =>
              byDate.get(date)?.coverage === 1 ? (byDate.get(date)!.max ?? null) : null,
            ),
          }
        : {}),
      origins: [...new Set(rows.map((r) => r.origin))],
      originCodes: dates
        .map((date) => {
          const row = byDate.get(date);
          return !row ? '-' : row.origin === 'smhi_archive' ? 's' : 'o';
        })
        .join(''),
      since: station.since,
    });
  }
  const rainStation = stations.find((s) => s.parameter === 'precipitation');
  const flowStation = stations.find((s) => s.parameter === 'water_flow');
  const [normals, flowReferences] = await Promise.all([
    rainStation ? propertyHistoryNormals(db, org.organizationId, id, rainStation.stationId) : [],
    flowStation ? propertyFlowReferences(db, org.organizationId, id, flowStation.stationId) : [],
  ]);
  const monthly = historyMonths(
    dates,
    series.find((s) => s.key === 'precipitation'),
    normals,
  );
  const earliest = series.flatMap((s) => (s.since ? [s.since] : [])).sort()[0] ?? null;
  const eventsSince = new Date(Math.max(Date.parse(startedAt), Date.parse(property.createdAt))).toISOString();
  return PropertyHistorySchema.parse({
    propertyId: id,
    period,
    stations,
    daily: { dates, series },
    monthly,
    hourly,
    events,
    kpis: historyKpis(dates, series, monthly, events),
    gaps: historyGaps(dates, series),
    frostWeeks: frostWeeks(dates, series),
    flowReferences,
    since: { events: eventsSince, measurements: earliest },
    origin: 'live',
    attribution:
      'Källa: SMHI (CC BY 4.0). Händelser: respektive myndighet. Bearbetning: FastighetsRadar. Mätstationer beskriver omgivningen; uppgifter om skador i byggnaden saknas.',
  });
}

/** Small batches under the existing scheduler's database lease. Never invoked by page views. */
export async function runHistoryBackfill(ctx: JobContext): Promise<JobResult> {
  let items = 0;
  let failed = false;
  const enabled = HISTORY_PARAMETERS.filter((p) => {
    if (p.sourceId === 'smhi_oceanography') return ctx.adapter.env.SOURCE_SMHI_OCEANOGRAPHY_ENABLED;
    if (p.sourceId === 'smhi_hydrology') return ctx.adapter.env.SOURCE_SMHI_HYDROLOGY_ENABLED;
    return ctx.adapter.env.SOURCE_SMHI_OBSERVATIONS_ENABLED;
  });
  for (const parameter of enabled) {
    if (!(await historyCatalogDue(ctx.db, parameter.sourceId, parameter.key))) continue;
    const catalog = await fetchHistoryCatalog(parameter, ctx.adapter);
    if (!catalog.ok) {
      failed = true;
      if (catalog.error === 'rate_limited')
        return {
          status: 'error',
          items,
          errorCode: catalog.error,
          retryAfterSeconds: catalog.retryAfterSeconds,
        };
      continue;
    }
    await saveHistoryCatalog(ctx.db, parameter.sourceId, parameter.key, catalog.data);
  }
  const targets = await historyBackfillTargets(ctx.db, enabled);
  for (const target of targets) {
    const parameter = enabled.find((p) => p.sourceId === target.sourceId && p.key === target.parameter)!;
    let archiveFetched = target.archiveFetched;
    let success = true;
    if (!archiveFetched) {
      const archive = await fetchHistorySeries(parameter, target.stationId, 'corrected-archive', ctx.adapter);
      if (archive.ok) {
        items += await saveStationDaily(
          ctx.db,
          parameter.sourceId,
          target.stationId,
          parameter.key,
          parameter.definition,
          archive.data.days,
        );
        archiveFetched = true;
        if (parameter.key === 'water_flow') {
          const references = Array.from({ length: 12 }, (_, index) => {
            const days = archive.data.days.filter(
              (d) => Number(d.date.slice(5, 7)) === index + 1 && d.value !== null && d.coverage === 1,
            );
            const years = new Set(days.map((d) => d.date.slice(0, 4))).size;
            const reference = monthlyFlowReference(
              days.map((d) => d.value!),
              years,
              days.length,
            );
            return reference ? { month: index + 1, ...reference } : null;
          }).filter((r): r is NonNullable<typeof r> => r !== null);
          await saveHistoryFlowReferences(ctx.db, target.stationId, references);
        }
      } else {
        success = false;
        if (archive.error === 'rate_limited') {
          await markHistoryBackfill(ctx.db, target, false, archiveFetched);
          return {
            status: 'error',
            items,
            errorCode: archive.error,
            retryAfterSeconds: archive.retryAfterSeconds,
          };
        }
      }
    }
    // MetObs provides four recent months; water APIs expose latest-day only.
    const recent = await fetchHistorySeries(
      parameter,
      target.stationId,
      parameter.sourceId === 'smhi_observations' ? 'latest-months' : 'latest-day',
      ctx.adapter,
    );
    if (recent.ok) {
      items += await saveStationDaily(
        ctx.db,
        parameter.sourceId,
        target.stationId,
        parameter.key,
        parameter.definition,
        recent.data.days,
      );
    } else {
      success = false;
      if (recent.error === 'rate_limited') {
        await markHistoryBackfill(ctx.db, target, false, archiveFetched);
        return {
          status: 'error',
          items,
          errorCode: recent.error,
          retryAfterSeconds: recent.retryAfterSeconds,
        };
      }
    }
    if (parameter.key === 'precipitation' && target.normalDue) {
      const normals = await fetchHistorySeries(
        parameter,
        target.stationId,
        'corrected-archive',
        ctx.adapter,
        true,
      );
      await saveHistoryNormals(ctx.db, target.stationId, normals.ok ? normals.data.normals : [], normals.ok);
      if (!normals.ok) success = false;
      if (!normals.ok && normals.error === 'rate_limited') {
        await markHistoryBackfill(ctx.db, target, false, archiveFetched);
        return {
          status: 'error',
          items,
          errorCode: normals.error,
          retryAfterSeconds: normals.retryAfterSeconds,
        };
      }
    }
    await markHistoryBackfill(ctx.db, target, success, archiveFetched);
    if (!success) failed = true;
  }
  return {
    status: failed ? (items ? 'partial' : 'error') : 'ok',
    items,
    moreWork: targets.length === HISTORY.stationsPerRun,
  };
}

export async function runHistoryAggregation(ctx: JobContext): Promise<JobResult> {
  return { status: 'ok', items: await aggregateStoredHistory(ctx.db) };
}
