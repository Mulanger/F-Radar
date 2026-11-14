'use client';

import { useId, useState } from 'react';
import { formatClock, formatNumber, formatShortDate, type PropertyHistory } from '@fastighetsradar/domain';
import { C, WL } from '@/lib/design/tokens';
import { smooth, type Pt } from '@/lib/view-models/chart';
import { contiguousHistory, historyStationLabel, historyValue, rainBars } from '@/lib/view-models/history';
import styles from './HistoryView.module.css';

const BLUE = '#3879a6';
const WIDTH = 900;
const HEIGHT = 240;
const LEFT = 42;
const BOTTOM = 208;
const TOP = 18;

export function HistoryRainChart({
  history,
  monthly,
  mobile,
  onDetail,
}: {
  history: PropertyHistory;
  monthly: boolean;
  mobile: boolean;
  onDetail: (from: string, to: string) => void;
}) {
  const viewportWidth = mobile ? 420 : WIDTH;
  const viewportHeight = mobile ? 260 : HEIGHT;
  const [selected, setSelected] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const gradient = useId();
  const bars = rainBars(history, monthly, mobile);
  const current = Math.min(selected ?? bars.length - 1, bars.length - 1);
  const bar = bars[current];
  const maximum = Math.max(1, ...bars.flatMap((b) => [b.value ?? 0, b.normal ?? 0])) * 1.12;
  const space = (viewportWidth - LEFT - 10) / Math.max(1, bars.length);
  const y = (value: number) => BOTTOM - (value / maximum) * (BOTTOM - TOP);
  const series = history.daily.series.find((s) => s.key === 'precipitation');
  const station = historyStationLabel(history, series);
  const hasData = bars.some((b) => b.value !== null);
  const labelEvery = Math.max(1, Math.ceil(bars.length / (mobile ? 4 : 8)));

  return (
    <>
      <div className={styles.chartFrame}>
        <svg
          viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
          role="img"
          aria-label={`Nederbörd och officiella varningar, ${history.period.from} till ${history.period.to}. ${station}. ${hasData ? 'Blå staplar visar uppmätt nederbörd. Luckor saknar stapel.' : 'Mätvärden saknas.'}`}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor={BLUE} stopOpacity=".95" />
              <stop offset="1" stopColor={BLUE} stopOpacity=".78" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((n) => (
            <g key={n}>
              <line
                x1={LEFT}
                x2={viewportWidth}
                y1={y((maximum * n) / 3)}
                y2={y((maximum * n) / 3)}
                stroke="#e9edef"
                strokeWidth="1"
              />
              <text
                x={LEFT - 8}
                y={y((maximum * n) / 3) + 4}
                textAnchor="end"
                fill={C.text2}
                fontSize={mobile ? 16 : 12}
              >
                {formatNumber((maximum * n) / 3, maximum < 3 ? 1 : 0)}
              </text>
            </g>
          ))}
          <text x={LEFT - 8} y="10" textAnchor="end" fill={C.text2} fontSize={mobile ? 15 : 11}>
            mm
          </text>
          {bars.map((b, i) => {
            const x = LEFT + i * space;
            const width = Math.max(1, space * 0.64);
            return (
              <g key={b.from}>
                {b.bands
                  .filter((band) => band.level !== 'VMA')
                  .map((band, index) => (
                    <rect
                      key={index}
                      x={x + band.left * space}
                      y={TOP}
                      width={band.width * space}
                      height={BOTTOM - TOP}
                      fill={WL[band.level].fg}
                      opacity=".09"
                    />
                  ))}
                {b.warnings.some((w) => w.level === 'VMA') && (
                  <circle cx={x + space / 2} cy={TOP + 4} r="3.5" fill={WL.VMA.fg} />
                )}
                {b.normal !== null && (
                  <rect
                    x={x + space * 0.1}
                    y={y(b.normal)}
                    width={space * 0.8}
                    height={BOTTOM - y(b.normal)}
                    fill="none"
                    stroke="#6f8390"
                    strokeWidth="1.4"
                    rx="2"
                  />
                )}
                {b.value !== null && (
                  <rect
                    x={x + (space - width) / 2}
                    y={y(b.value)}
                    width={width}
                    height={Math.max(b.value > 0 ? 1 : 0, BOTTOM - y(b.value))}
                    fill={`url(#${gradient})`}
                    rx={Math.min(3, space / 6)}
                  />
                )}
                {i === current && (
                  <rect x={x} y={TOP} width={space} height={BOTTOM - TOP} fill={BLUE} opacity=".06" />
                )}
                <rect
                  className={styles.chartTarget}
                  x={x}
                  y={TOP}
                  width={space}
                  height={BOTTOM - TOP}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${b.label}: ${historyValue(b.value, 'mm')}${b.complete ? '' : ', ofullständig'}. ${b.warnings.map((w) => w.title).join(', ')}`}
                  onFocus={() => setSelected(i)}
                  onPointerMove={() => setSelected(i)}
                  onClick={() => setSelected(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      setSelected(
                        Math.max(0, Math.min(bars.length - 1, current + (e.key === 'ArrowRight' ? 1 : -1))),
                      );
                    }
                  }}
                />
                {i % labelEvery === 0 && (
                  <text
                    x={x + space / 2}
                    y={BOTTOM + 22}
                    fill={C.text2}
                    fontSize={mobile ? 16 : 12}
                    textAnchor="middle"
                  >
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
          {!hasData && (
            <text x={viewportWidth / 2} y={100} fill={C.text2} textAnchor="middle" fontSize="16">
              Mätvärden saknas för perioden
            </text>
          )}
        </svg>
      </div>
      {bar && (
        <div className={styles.tooltip} aria-live="polite" aria-atomic="true">
          <div className={styles.tooltipMain}>
            <span>
              {formatShortDate(bar.from + 'T12:00:00Z')}
              {bar.to !== bar.from ? ` – ${formatShortDate(bar.to + 'T12:00:00Z')}` : ''}
            </span>
            <strong>{historyValue(bar.value, 'mm')}</strong>
            {!bar.complete && <span>Ofullständig period</span>}
            {bar.normal !== null && <span>Normalt {formatNumber(bar.normal, 1)} mm (1991–2020)</span>}
          </div>
          <span>{station}</span>
          {bar.warnings.length > 0 && (
            <span>{bar.warnings.map((w) => `${WL[w.level].label}: ${w.title}`).join(' · ')}</span>
          )}
          <div className={styles.tooltipNav}>
            <button
              type="button"
              aria-label="Föregående mätperiod"
              disabled={current <= 0}
              onClick={() => setSelected(current - 1)}
            >
              ←
            </button>
            <span>Tryck på en stapel för detaljer</span>
            <button
              type="button"
              aria-label="Nästa mätperiod"
              disabled={current >= bars.length - 1}
              onClick={() => setSelected(current + 1)}
            >
              →
            </button>
          </div>
          {(bar.from !== history.period.from || bar.to !== history.period.to) && (
            <button className={styles.textButton} onClick={() => onDetail(bar.from, bar.to)}>
              {bar.from === bar.to ? 'Visa dygnet i detalj' : 'Visa perioden i detalj'}
            </button>
          )}
        </div>
      )}
      <div className={styles.chartLegend}>
        <span>
          <i style={{ background: BLUE }} />
          Nederbörd
        </span>
        {monthly && (
          <span>
            <i style={{ border: '1px solid #6f8390' }} />
            Månadsnormal 1991–2020
          </span>
        )}
        <span>Tonade band: officiella varningar · punkt: VMA</span>
      </div>
      <button className={styles.textButton} aria-expanded={table} onClick={() => setTable(!table)}>
        {table ? 'Dölj tabell' : 'Visa som tabell'}
      </button>
      {table && (
        <table className={styles.table}>
          <caption>Nederbörd {station}. Saknat värde visas med —.</caption>
          <thead>
            <tr>
              <th>Period</th>
              <th>mm</th>
              <th>Normalt mm</th>
              <th>Information</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.from}>
                <td>
                  {b.from}
                  {b.to !== b.from && ` – ${b.to}`}
                </td>
                <td>{historyValue(b.value)}</td>
                <td>{historyValue(b.normal)}</td>
                <td>
                  {!b.complete && 'Ofullständig. '}
                  {b.warnings.map((w) => `${WL[w.level].label}: ${w.title}`).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** A gap splits both line and band. Curves never bridge missing observations. */
export function HistoryBandChart({
  dates,
  values,
  min,
  max,
  label,
  unit,
  zero,
  references,
  mobile,
}: {
  dates: string[];
  values: Array<number | null>;
  min?: Array<number | null>;
  max?: Array<number | null>;
  label: string;
  unit: string;
  zero?: boolean;
  mobile?: boolean;
  references?: Array<{ month: number; p75: number; p95: number }>;
}) {
  const viewportWidth = mobile ? 420 : WIDTH;
  const viewportHeight = mobile ? 260 : HEIGHT;
  const [table, setTable] = useState(false);
  const gradient = useId();
  const all = [
    ...values,
    ...(min ?? []),
    ...(max ?? []),
    ...(references?.flatMap((r) => [r.p75, r.p95]) ?? []),
  ].filter((v): v is number => v !== null);
  if (!all.length) return <p className={styles.note}>Mätvärden saknas för perioden.</p>;
  let low = Math.min(...all, ...(zero ? [0] : []));
  let high = Math.max(...all, ...(zero ? [0] : []));
  const margin = Math.max(1, (high - low) * 0.12);
  low = ['mm', 'm/s', 'm³/s'].includes(unit) ? Math.max(0, low - margin) : low - margin;
  high += margin;
  const x = (index: number) =>
    LEFT + (dates.length === 1 ? 0.5 : index / (dates.length - 1)) * (viewportWidth - LEFT - 12);
  const y = (value: number) => BOTTOM - ((value - low) / (high - low)) * (BOTTOM - TOP);
  const point = (index: number, value: number): Pt => [x(index), y(value)];
  const bandValues = values.map((v, i) => (v !== null && min?.[i] != null && max?.[i] != null ? v : null));
  return (
    <>
      <div className={styles.chartFrame}>
        <svg
          role="img"
          aria-label={`${label}, ${dates[0]} till ${dates.at(-1)}. ${unit}. Luckor bryter serien.`}
          viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor={BLUE} stopOpacity=".2" />
              <stop offset="1" stopColor={BLUE} stopOpacity=".04" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((n) => (
            <g key={n}>
              <line
                x1={LEFT}
                x2={viewportWidth}
                y1={y(low + ((high - low) * n) / 3)}
                y2={y(low + ((high - low) * n) / 3)}
                stroke="#e9edef"
              />
              <text
                x={LEFT - 7}
                y={y(low + ((high - low) * n) / 3) + 4}
                textAnchor="end"
                fill={C.text2}
                fontSize={mobile ? 16 : 12}
              >
                {Math.round(low + ((high - low) * n) / 3)}
              </text>
            </g>
          ))}
          {references &&
            dates.slice(0, -1).map((date, i) => {
              const r = references.find((r) => r.month === Number(date.slice(5, 7)));
              return r ? (
                <g key={date}>
                  <rect
                    x={x(i)}
                    width={x(i + 1) - x(i) + 0.2}
                    y={y(r.p95)}
                    height={y(r.p75) - y(r.p95)}
                    fill={BLUE}
                    opacity=".08"
                  />
                  <line
                    x1={x(i)}
                    x2={x(i + 1)}
                    y1={y(r.p75)}
                    y2={y(r.p75)}
                    stroke={BLUE}
                    strokeWidth="1"
                    opacity=".8"
                  />
                  <line
                    x1={x(i)}
                    x2={x(i + 1)}
                    y1={y(r.p95)}
                    y2={y(r.p95)}
                    stroke={BLUE}
                    strokeWidth="1"
                    opacity=".8"
                  />
                </g>
              ) : null;
            })}
          {zero && (
            <>
              <line x1={LEFT} x2={viewportWidth} y1={y(0)} y2={y(0)} stroke="#6f8390" strokeDasharray="5 5" />
              <text
                x={viewportWidth - 5}
                y={y(0) - 6}
                textAnchor="end"
                fill={C.text2}
                fontSize={mobile ? 15 : 11}
              >
                0 RW
              </text>
            </>
          )}
          {min &&
            max &&
            contiguousHistory(bandValues).map((segment) => {
              const upper = segment.map((p) => point(p.index, max[p.index]!));
              const lower = [...segment].reverse().map((p) => point(p.index, min[p.index]!));
              return (
                <g key={segment[0].index}>
                  <path
                    d={`${smooth(upper)} ${smooth(lower).replace(/^M/, 'L')} Z`}
                    fill={`url(#${gradient})`}
                  />
                  <path d={smooth(upper)} fill="none" stroke={BLUE} strokeWidth="1" opacity=".8" />
                  <path
                    d={smooth([...lower].reverse())}
                    fill="none"
                    stroke={BLUE}
                    strokeWidth="1"
                    opacity=".8"
                  />
                </g>
              );
            })}
          {contiguousHistory(values).map((segment) =>
            segment.length === 1 ? (
              <g key={segment[0].index}>
                {min?.[segment[0].index] != null && max?.[segment[0].index] != null && (
                  <line
                    x1={x(segment[0].index)}
                    x2={x(segment[0].index)}
                    y1={y(min[segment[0].index]!)}
                    y2={y(max[segment[0].index]!)}
                    stroke={BLUE}
                    strokeWidth="8"
                    opacity=".2"
                  />
                )}
                <circle cx={x(segment[0].index)} cy={y(segment[0].value)} r="3" fill={BLUE} />
              </g>
            ) : (
              <path
                key={segment[0].index}
                d={smooth(segment.map((p) => point(p.index, p.value)))}
                stroke={BLUE}
                strokeWidth="2"
                fill="none"
              />
            ),
          )}
          {[...new Set([0, Math.floor(dates.length / 2), dates.length - 1])].map((i) => (
            <text
              key={i}
              x={x(i)}
              y={BOTTOM + 22}
              textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
              fill={C.text2}
              fontSize={mobile ? 16 : 12}
            >
              {dates[i].includes('T') ? formatClock(dates[i]) : formatShortDate(dates[i] + 'T12:00:00Z')}
            </text>
          ))}
        </svg>
      </div>
      <button className={styles.textButton} aria-expanded={table} onClick={() => setTable(!table)}>
        {table ? 'Dölj tabell' : 'Visa som tabell'}
      </button>
      {table && (
        <table className={styles.table}>
          <caption>
            {label}, {unit}
          </caption>
          <thead>
            <tr>
              <th>Datum</th>
              <th>Värde</th>
              {min && <th>Min</th>}
              {max && <th>Max</th>}
            </tr>
          </thead>
          <tbody>
            {dates.map((date, i) => (
              <tr key={date}>
                <td>{date}</td>
                <td>{historyValue(values[i])}</td>
                {min && <td>{historyValue(min[i])}</td>}
                {max && <td>{historyValue(max[i])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
