#!/usr/bin/env node
/**
 * Client-side scale measurement (docs/plans/skalning.md, Fas 0 / avsnitt 2.1).
 *
 *   npm run measure:portfolio            # 10, 50, 200, 500, 1000 properties
 *   npm run measure:portfolio -- 200 500 # chosen sizes
 *
 * Uses the deterministic demo test portfolio (scaleDemoPortfolio) – no network, no customer data.
 * Prints the size of the full portfolio and of the LIST the dashboard gets (Fas 3 / S-10), the
 * server-side zod validation time of the list and the client view-model build times.
 * Timings depend on the machine: compare before/after on the same computer.
 */
import { performance } from 'node:perf_hooks';
import { PortfolioSchema, listPortfolio, type PropertySnapshot } from '@fastighetsradar/domain';
import { demoPortfolio, scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildOverviewVM } from '../apps/web/lib/view-models/overview';
import { buildDetailVM } from '../apps/web/lib/view-models/detail';

const sizes = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const ui = { ready: true, group: 'all', isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback };

/** Median of `reps` runs after one warm-up run, in ms. */
function time(fn: () => unknown, reps = 5): number {
  fn();
  const runs: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  return runs.sort((a, b) => a - b)[Math.floor(reps / 2)]!;
}

const rows: string[][] = [['N', 'hela', 'lista', 'lista per fastighet', 'zod safeParse (lista)', 'buildOverviewVM', 'buildDetailVM', 'rader i flödet']];
for (const n of sizes.length ? sizes : [10, 50, 200, 500, 1000]) {
  const p = scaleDemoPortfolio(demoPortfolio, n);
  const fullKb = Buffer.byteLength(JSON.stringify(p)) / 1024;
  const list = listPortfolio(p);
  const json = JSON.stringify(list);
  const kb = Buffer.byteLength(json) / 1024;
  const parse = time(() => PortfolioSchema.safeParse(JSON.parse(json)), 3);
  const overview = time(() => buildOverviewVM(list, ui));
  const middle = p.properties[Math.floor(p.properties.length / 2)]!;
  const detail = time(() => buildDetailVM(p, middle, { ready: true, metric: 'temp', smsOn: true, isRuleOn: ui.isRuleOn }));
  const fmt = (k: number) => (k >= 1024 ? `${(k / 1024).toFixed(1)} MB` : `${k.toFixed(0)} KB`);
  rows.push([String(p.properties.length), fmt(fullKb), fmt(kb), `${(kb / p.properties.length).toFixed(1)} KB`, `${parse.toFixed(0)} ms`, `${overview.toFixed(0)} ms`, `${detail.toFixed(1)} ms`, String(p.feed.length)]);
}

const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
for (const [i, r] of rows.entries()) {
  console.log(r.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join('  '));
  if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
}
console.log(`\nNode ${process.version} · ${new Date().toISOString()} · demo test portfolio (scaleDemoPortfolio)`);
