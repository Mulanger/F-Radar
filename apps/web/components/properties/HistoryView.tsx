'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  HISTORY,
  HistoryQuerySchema,
  formatClock,
  formatDistance,
  formatShortDate,
  historyPeriod,
  type HistoryEvent,
  type HistoryQuery,
  type PropertyHistory,
} from '@fastighetsradar/domain';
import { card, smallCard, WL } from '@/lib/design/tokens';
import { loadHistory, type HistoryLoadResult } from '@/lib/data/history';
import {
  HISTORY_CATEGORIES,
  HISTORY_DEFINITIONS,
  groupHistoryEvents,
  historyCsv,
  historyMatchLabel,
  historyStationLabel,
  historyValue,
} from '@/lib/view-models/history';
import { HistoryBandChart, HistoryRainChart } from './HistoryCharts';
import styles from './HistoryView.module.css';

const RANGES = [
  { id: '30d', label: '30 dagar' },
  { id: '90d', label: '90 dagar' },
  { id: '12m', label: '12 månader' },
  { id: 'custom', label: 'Välj period' },
] as const;

function HistorySkeleton() {
  return (
    <div className={styles.view} role="status" aria-label="Laddar historik">
      <div className={styles.tiles}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} style={{ ...smallCard, height: 130 }}>
            <div className={styles.skeleton} style={{ height: 16, width: '70%' }} />
            <div className={styles.skeleton} style={{ height: 32, marginTop: 20 }} />
          </div>
        ))}
      </div>
      <div style={{ ...card, padding: 24 }}>
        <div className={styles.skeleton} style={{ height: 18, width: '30%' }} />
        <div className={styles.skeleton} style={{ height: 260, marginTop: 24 }} />
      </div>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className={styles.tile} style={smallCard}>
      <span className={styles.tileLabel}>{label}</span>
      <div className={styles.tileValue}>{value}</div>
      <div className={styles.tileNote}>{note}</div>
    </div>
  );
}

function HistoryKpis({ history }: { history: PropertyHistory }) {
  const { kpis } = history;
  const rain = history.daily.series.find((s) => s.key === 'precipitation');
  const water = history.daily.series.find((s) => s.key === kpis.waterMax?.series);
  const days = history.daily.dates.length;
  const eventCoverage = history.period.from >= history.since.events.slice(0, 10);
  return (
    <div className={styles.tiles}>
      <Kpi
        label="Nederbörd under perioden"
        value={
          <>
            {historyValue(kpis.rainMm)} <small>mm</small>
          </>
        }
        note={
          <>
            {!kpis.rainComplete ? 'Ofullständig mätserie. ' : ''}
            {kpis.normalPercent !== null && `${kpis.normalPercent} % av normalt. `}
            {historyStationLabel(history, rain)}
          </>
        }
      />
      <Kpi
        label="Blötaste uppmätta dygnet"
        value={
          <>
            {historyValue(kpis.wettest?.mm)} <small>mm</small>
          </>
        }
        note={
          <>
            {kpis.wettest ? formatShortDate(kpis.wettest.date + 'T12:00:00Z') : 'Mätvärden saknas.'} ·{' '}
            {historyStationLabel(history, rain)}
            {!kpis.rainComplete && ' · ofullständig period'}
          </>
        }
      />
      <Kpi
        label="Dygn med officiell varning"
        value={
          <>
            {eventCoverage ? kpis.warningDays : '—'} <small>dygn</small>
          </>
        }
        note={
          <>
            <span className={styles.levels}>
              {(['Yellow', 'Orange', 'Red', 'VMA'] as const)
                .filter((l) => kpis.warningDaysByLevel[l] > 0)
                .map((l) => (
                  <span key={l} className={styles.level} style={{ background: WL[l].bg, color: WL[l].fg }}>
                    {kpis.warningDaysByLevel[l]} {WL[l].label.toLowerCase()}
                  </span>
                ))}
            </span>
            {eventCoverage
              ? 'SMHI och VMA. Ett dygn kan ha flera nivåer.'
              : 'Händelsearkivet täcker inte hela perioden.'}
          </>
        }
      />
      {water && (
        <Kpi
          label={water.key === 'sea_level' ? 'Högsta uppmätta havsvattenstånd' : 'Högsta dygnsmedelflöde'}
          value={
            <>
              {historyValue(kpis.waterMax?.value)} <small>{water.unit}</small>
            </>
          }
          note={
            <>
              {historyStationLabel(history, water)} ·{' '}
              {kpis.waterMax && formatShortDate(kpis.waterMax.date + 'T12:00:00Z')}
              {water.key === 'sea_level' && ' · timvärde'}
            </>
          }
        />
      )}
      <Kpi
        label={`Dygn med minst ${HISTORY.wetDayMm} mm`}
        value={
          <>
            {kpis.wetDays ?? '—'} <small>dygn</small>
          </>
        }
        note={
          <>
            {days} dygn i vald period{!kpis.rainComplete ? ' · ofullständig mätserie' : ''}.{' '}
            {historyStationLabel(history, rain)}
          </>
        }
      />
    </div>
  );
}

function EventRow({ event, demo }: { event: HistoryEvent; demo: boolean }) {
  const latest = event.versions.at(-1)!;
  const level = WL[latest.level];
  const period = (date: string | null) =>
    date ? `${formatShortDate(date)} ${formatClock(date)}` : 'Tills vidare';
  return (
    <article className={styles.event}>
      <div className={styles.eventHeading}>
        <span className={styles.level} style={{ background: level.bg, color: level.fg }}>
          {event.official ? level.label : 'Information'}
        </span>
        <h4>{latest.title}</h4>
      </div>
      <div className={styles.eventMeta}>
        {period(latest.validFrom ?? latest.publishedAt)} –{' '}
        {period(latest.matchedUntil ?? latest.validTo ?? latest.endedAt)}
        <br />
        {event.sourceLabel} · {historyMatchLabel(latest.matchMethod, latest.distanceMeters)}
        {latest.area && ` · ${latest.area}`}
        {latest.endType === 'cancelled' && ' · återkallad'}
      </div>
      {event.versions.length > 1 && (
        <div className={styles.versions}>
          {event.versions.slice(1).map((v, i) => {
            const previous = event.versions[i];
            const rank = { Info: 0, Yellow: 1, Orange: 2, Red: 3, VMA: 3 };
            const change =
              rank[v.level] > rank[previous.level]
                ? 'Uppgraderad'
                : rank[v.level] < rank[previous.level]
                  ? 'Ändrad nivå'
                  : 'Uppdaterad';
            return (
              <div key={v.version} className={styles.eventMeta}>
                {change}
                {v.level !== previous.level
                  ? ` från ${WL[previous.level].label.toLowerCase()} till ${WL[v.level].label.toLowerCase()}`
                  : ''}{' '}
                · {formatShortDate(v.changedAt)} kl {formatClock(v.changedAt)}
              </div>
            );
          })}
        </div>
      )}
      <details className={styles.official}>
        <summary>{demo ? 'Visa demotext och versioner' : 'Visa officiell text'}</summary>
        {event.versions.map((v) => (
          <div key={v.version}>
            <strong>
              Version {v.version} · {WL[v.level].label} · {period(v.publishedAt ?? v.changedAt)}
            </strong>
            <p>{v.text ?? 'Källan innehöll ingen beskrivande text.'}</p>
          </div>
        ))}
        <p>{event.attribution}</p>
        {latest.sourceUrl && (
          <a href={latest.sourceUrl} target="_blank" rel="noreferrer">
            Öppna källan
          </a>
        )}
      </details>
    </article>
  );
}

function HistoryTimeline({ history }: { history: PropertyHistory }) {
  const [filter, setFilter] = useState<string | null>(null);
  const groups = groupHistoryEvents(history.events, filter);
  const official = history.events.filter((e) => e.official);
  return (
    <section className={styles.panel} style={card} aria-label="Händelsetidslinje">
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.title}>Händelser vid adressen</h2>
          <p className={styles.subtitle}>Matchade områden och information från myndigheternas källor.</p>
        </div>
      </div>
      <div className={styles.chips}>
        <button className={styles.chip} aria-pressed={filter === null} onClick={() => setFilter(null)}>
          Alla
        </button>
        {HISTORY_CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={styles.chip}
            aria-pressed={filter === c.id}
            onClick={() => setFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {official.length === 0 && (
        <p className={styles.empty}>
          Inga officiella varningar har träffat fastigheten under perioden
          {history.period.from < history.since.events.slice(0, 10) ? ' som täcks av arkivet' : ''}.
        </p>
      )}
      {groups.map((group) => (
        <div key={group.month}>
          <h3 className={styles.month}>{group.label}</h3>
          {group.events.map((e) => (
            <EventRow key={e.id} event={e} demo={history.origin === 'demo_fixture'} />
          ))}
        </div>
      ))}
      {groups.length === 0 && official.length > 0 && (
        <p className={styles.empty}>Inga händelser i valt filter under perioden.</p>
      )}
      <p className={styles.note}>
        Händelser sparas sedan {formatShortDate(history.since.events)} {history.since.events.slice(0, 4)}.
        Äldre händelser kan saknas; SMHI:s öppna varningsflöde innehåller aktuella varningar.
      </p>
    </section>
  );
}

function HistoryMeasurements({ history, mobile }: { history: PropertyHistory; mobile: boolean }) {
  const { dates, series } = history.daily;
  const sea = series.find((s) => s.key === 'sea_level');
  const flow = series.find((s) => s.key === 'water_flow');
  const min = series.find((s) => s.key === 'temperature_min');
  const max = series.find((s) => s.key === 'temperature_max');
  const gust = series.find((s) => s.key === 'wind_gust');
  const crossings = series.find((s) => s.key === 'temperature_crossings');
  const pairedTemperature =
    min &&
    max &&
    min.station.split(':').slice(0, 2).join(':') === max.station.split(':').slice(0, 2).join(':');
  const temperatureMidpoint = pairedTemperature
    ? min.values.map((v, i) => (v !== null && max.values[i] !== null ? (v + max.values[i]!) / 2 : null))
    : [];
  return (
    <>
      {(sea || flow) && (
        <div className={sea && flow ? styles.twoColumns : undefined}>
          {sea && (
            <section className={styles.panel} style={card}>
              <h2 className={styles.title}>Havsvattenstånd</h2>
              <p className={styles.subtitle}>
                Dygnets min, max och medel av timvärden i cm RW · {historyStationLabel(history, sea)}
              </p>
              <HistoryBandChart
                mobile={mobile}
                dates={dates}
                values={sea.values}
                min={sea.min}
                max={sea.max}
                label="Havsvattenstånd"
                unit="cm RW"
                zero
              />
              <p className={styles.note}>
                0 RW är årets beräknade medelvattenstånd. {HISTORY_DEFINITIONS[sea.dayDefinition]} Källa:
                SMHI.
              </p>
            </section>
          )}
          {flow && (
            <section className={styles.panel} style={card}>
              <h2 className={styles.title}>Vattenföring</h2>
              <p className={styles.subtitle}>Dygnsmedel · {historyStationLabel(history, flow)}</p>
              <HistoryBandChart
                mobile={mobile}
                dates={dates}
                values={flow.values}
                label="Vattenföring"
                unit="m³/s"
                references={history.flowReferences}
              />
              <p className={styles.note}>
                {history.flowReferences.length > 0
                  ? 'Referensband P75–P95: högt för årstiden. Under P75: normalt för årstiden. Referensen bygger på stationens dygnsvärden.'
                  : 'Referensunderlag saknas. Ingen jämförelse med årstiden visas.'}{' '}
                Stationen kan ligga i ett annat vattendrag. {HISTORY_DEFINITIONS[flow.dayDefinition]} Källa:
                SMHI.
              </p>
            </section>
          )}
        </div>
      )}
      {(min || max || crossings) && (
        <section className={styles.panel} style={card}>
          <h2 className={styles.title}>Temperatur och frost</h2>
          {pairedTemperature ? (
            <>
              <p className={styles.subtitle}>Dygnets min och max · {historyStationLabel(history, min)}</p>
              <HistoryBandChart
                mobile={mobile}
                dates={dates}
                values={temperatureMidpoint}
                min={min.values}
                max={max.values}
                label="Temperaturens min och max; linjen visar mitten av intervallet"
                unit="°C"
              />
              <p className={styles.note}>
                {HISTORY_DEFINITIONS[min.dayDefinition]} Bandet visar intervallet; linjen är mitten mellan min
                och max, inte dygnsmedel. Källa: SMHI.
              </p>
            </>
          ) : (
            <>
              <p className={styles.subtitle}>
                {min && max
                  ? 'Min och max kommer från olika stationer och visas separat.'
                  : 'Tillgängliga temperaturmätningar visas per station.'}
              </p>
              {[min, max]
                .flatMap((s) => (s ? [s] : []))
                .map((s) => (
                  <div key={s.key}>
                    <p className={styles.subtitle}>
                      {s.key === 'temperature_min'
                        ? 'Dygnets lägsta temperatur'
                        : 'Dygnets högsta temperatur'}{' '}
                      · {historyStationLabel(history, s)}
                    </p>
                    <HistoryBandChart
                      mobile={mobile}
                      dates={dates}
                      values={s.values}
                      label={
                        s.key === 'temperature_min'
                          ? 'Dygnets lägsta temperatur'
                          : 'Dygnets högsta temperatur'
                      }
                      unit="°C"
                    />
                    <p className={styles.note}>{HISTORY_DEFINITIONS[s.dayDefinition]} Källa: SMHI.</p>
                  </div>
                ))}
            </>
          )}
          <details className={styles.official}>
            <summary>Växlingar mellan plus och minus per vecka</summary>
            <p>
              Växlande grader kan ge is och istappar på tak. Observerade passager i timvärden{' '}
              {historyStationLabel(history, crossings)}. Hela veckan måste ha komplett timserie. Förändringar
              mellan mättillfällena kan saknas.
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Vecka från</th>
                  <th>Observerade passager</th>
                </tr>
              </thead>
              <tbody>
                {history.frostWeeks.map((w) => (
                  <tr key={w.from}>
                    <td>{w.from}</td>
                    <td>
                      {w.crossings ?? '—'}
                      {!w.complete && ' · ofullständig'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}
      {gust && (
        <section className={styles.panel} style={card}>
          <h2 className={styles.title}>Byvind</h2>
          <p className={styles.subtitle}>Högsta timvärdet per dygn · {historyStationLabel(history, gust)}</p>
          <HistoryBandChart
            mobile={mobile}
            dates={dates}
            values={gust.values}
            label="Dygnets högsta byvind"
            unit="m/s"
          />
          <p className={styles.note}>{HISTORY_DEFINITIONS[gust.dayDefinition]} Källa: SMHI.</p>
        </section>
      )}
    </>
  );
}

export function HistoryView({
  propertyId,
  mode,
  referenceTime,
}: {
  propertyId: string;
  mode: 'live' | 'demo';
  referenceTime: string;
}) {
  const [range, setRange] = useState<HistoryQuery['range']>('12m');
  const search = useSearchParams();
  const example = mode === 'demo' ? search.get('historikexempel') : null;
  const demoExample = example === 'luckor' ? 'gaps' : example === 'tom' ? 'empty' : 'complete';
  const initial = historyPeriod({ range: '30d' }, new Date(referenceTime));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [inputError, setInputError] = useState('');
  const [result, setResult] = useState<HistoryLoadResult | null>(null);
  const [retry, setRetry] = useState(0);
  const [mobile, setMobile] = useState(false);
  const query = useMemo<HistoryQuery>(
    () =>
      range === 'custom' && custom ? { range, ...custom } : { range: range === 'custom' ? '12m' : range },
    [range, custom],
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void loadHistory(mode, propertyId, query, referenceTime, controller.signal, demoExample).then((value) => {
      if (!controller.signal.aborted) setResult(value);
    });
    return () => controller.abort();
  }, [mode, propertyId, query, referenceTime, retry, demoExample]);

  const history = result?.status === 'ok' && result.history.propertyId === propertyId ? result.history : null;
  const rain = history?.daily.series.find((s) => s.key === 'precipitation');
  function exportCsv() {
    if (!history) return;
    const url = URL.createObjectURL(new Blob([historyCsv(history)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `fastighetsradar-historik-${history.propertyId}-${history.period.from}-${history.period.to}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function applyCustom() {
    const parsed = HistoryQuerySchema.safeParse({ range: 'custom', from, to });
    if (!parsed.success) {
      setInputError('Ange en giltig period på högst 24 månader.');
      return;
    }
    try {
      historyPeriod(parsed.data, new Date(referenceTime));
    } catch {
      setInputError('Välj ett slutdatum senast idag.');
      return;
    }
    setInputError('');
    setCustom({ from, to });
  }

  return (
    <div className={styles.view} aria-label="Fastighetens historik">
      <div className={styles.toolbar}>
        <div className={styles.chips} aria-label="Historikperiod">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={styles.chip}
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button className={styles.export} onClick={exportCsv} disabled={!history}>
          ↓ Ladda ner som CSV
        </button>
      </div>
      {range === 'custom' && (
        <form
          className={styles.custom}
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}
        >
          <label>
            Från
            <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Till
            <input
              type="date"
              required
              value={to}
              max={referenceTime.slice(0, 10)}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button type="submit" className={styles.chip}>
            Visa perioden
          </button>
          {inputError && (
            <p role="alert" className={styles.note}>
              {inputError}
            </p>
          )}
        </form>
      )}
      {!result || (result.status === 'ok' && !history) ? (
        <HistorySkeleton />
      ) : result.status === 'unavailable' ? (
        <div className={styles.panel} style={card}>
          <p className={styles.note} role="status">
            {result.reason}
          </p>
          <button className={styles.textButton} onClick={() => setRetry((n) => n + 1)}>
            Försök igen
          </button>
        </div>
      ) : null}
      {history && (
        <>
          {history.origin === 'demo_fixture' && (
            <div className={styles.demo}>
              Demo
              {demoExample === 'gaps'
                ? ' med mätluckor'
                : demoExample === 'empty'
                  ? ' utan mätningar och händelser'
                  : ''}{' '}
              · syntetiska mätvärden, normaler och händelser. Ingen faktisk väder- eller händelsehistorik.
            </div>
          )}
          <p className={styles.note}>
            {history.period.from} – {history.period.to} · Stationernas mätvärden beskriver omgivningen.
            Uppgifter om vad som hänt i byggnaden saknas.
          </p>
          <HistoryKpis history={history} />
          <section className={styles.panel} style={card}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.title}>Nederbörd och varningar</h2>
                <p className={styles.subtitle}>Nederbörd {historyStationLabel(history, rain)}</p>
              </div>
            </div>
            <HistoryRainChart
              history={history}
              monthly={query.range === '12m' || history.daily.dates.length > 365}
              mobile={mobile}
              onDetail={(from, to) => {
                setRange('custom');
                setFrom(from);
                setTo(to);
                setCustom({ from, to });
              }}
            />
            <p className={styles.note}>
              {rain && HISTORY_DEFINITIONS[rain.dayDefinition]} Månadsnormaler visas enbart för kompletta
              månader med minst 24 års underlag från samma station under 1991–2020. Källa: SMHI, CC BY 4.0.
            </p>
            {history.gaps.filter((g) => g.series === 'precipitation').length > 0 && (
              <details className={styles.official}>
                <summary>Ofullständiga mätperioder</summary>
                {history.gaps
                  .filter((g) => g.series === 'precipitation')
                  .map((g) => (
                    <p key={g.from}>
                      Ofullständig mätserie {g.from} – {g.to}. Stationen rapporterade inte en komplett serie.
                    </p>
                  ))}
              </details>
            )}
            {history.hourly ? (
              <div style={{ marginTop: 24, borderTop: '1px solid #e9edef', paddingTop: 20 }}>
                <h3 className={styles.title}>Timnederbörd</h3>
                <p className={styles.subtitle}>
                  Nederbörd vid {history.hourly.station.name} (
                  {formatDistance(history.hourly.station.distanceMeters)}).
                </p>
                <HistoryBandChart
                  mobile={mobile}
                  dates={history.hourly.values.map((_, i) =>
                    new Date(Date.parse(history.hourly!.from) + (i + 1) * HISTORY.hourMs).toISOString(),
                  )}
                  values={history.hourly.values}
                  label="Uppmätt nederbörd per timme, tidsaxeln visar timmens slut i svensk tid"
                  unit="mm"
                />
                <p className={styles.note}>
                  Separat serie från kvartsmätningar, summerade till hela timmar i svensk tid. Tidsaxeln visar
                  timmens slut. Saknade kvartar ger en lucka. Källa: SMHI (CC BY 4.0).
                </p>
              </div>
            ) : (
              <p className={styles.note}>
                Timvärden kan visas för högst {HISTORY.hourlyDetailMaxDays} dygn åt gången under de senaste{' '}
                {HISTORY.rawRetentionDays} dygnen, där kvartsmätningar finns.
              </p>
            )}
          </section>
          <HistoryMeasurements history={history} mobile={mobile} />
          <HistoryTimeline history={history} />
          <p className={styles.note}>
            {history.attribution}
            {history.since.measurements && ` Mäthistorik tillgänglig sedan ${history.since.measurements}.`}
          </p>
        </>
      )}
    </div>
  );
}
