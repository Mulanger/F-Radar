'use client';

import { useState } from 'react';
import { DashboardLink } from '../shell/DashboardLink';
import { propertyHref } from '@/lib/navigation/dashboard';
import type { UtilityCoverageReport } from '@fastighetsradar/domain';
import { C } from '@/lib/design/tokens';

const LABEL = { electricity: 'El', district_heating: 'Fjärrvärme', district_cooling: 'Fjärrkyla', gas: 'Gas', water: 'Vatten och avlopp' };
const COVERAGE = { monitored: 'Bevakas', not_monitored: 'Leverantören bevakas inte ännu', stale: 'Källan kunde inte kontrolleras', unknown: 'Ej bedömd' };
/** Properties listed per utility before "Visa alla" (docs/plans/skalning.md, S-22). */
export const COVERAGE_LIST_MAX = 10;

type CoverageRow = UtilityCoverageReport['properties'][number];

function PropertyGaps({ rows, names, basePath }: { rows: CoverageRow[]; names: Map<string, string>; basePath: string }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, COVERAGE_LIST_MAX);
  return <>
    <ul>{shown.map((p) => <li key={p.propertyId}>
      <DashboardLink href={propertyHref(basePath, p.propertyId, 'overview')}>{names.get(p.propertyId) ?? 'Fastighet'}</DashboardLink>
      {': '}{COVERAGE[p.coverage]}{p.operatorName ? ` – ${p.operatorName}` : ''}{p.approximatePosition ? ' · ungefärlig position' : ''}
    </li>)}</ul>
    {rows.length > COVERAGE_LIST_MAX && <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: C.ink, textDecoration: 'underline', cursor: 'pointer' }}>
      {all ? 'Visa färre' : `Visa alla ${rows.length}`}
    </button>}
  </>;
}

export function UtilityCoverage({ reports, properties, basePath }: {
  reports: UtilityCoverageReport[] | undefined;
  properties: Array<{ id: string; name: string }>;
  basePath: string;
}) {
  if (!reports?.length) return null;
  const names = new Map(properties.map((p) => [p.id, p.name]));
  return <div aria-label="Täckning per nyttighet" style={{ fontSize: 12, color: C.text2, padding: '10px 0' }}>
    {reports.map((r) => <details key={r.utility} style={{ padding: '6px 0' }}>
      <summary style={{ cursor: 'pointer' }}>{LABEL[r.utility]} bevakas för {r.monitored} av {r.total} adresser</summary>
      <p>{r.notMonitored} hos leverantör som inte bevakas · {r.unavailable} med otillgänglig källa · {r.unknown} ej bedömda</p>
      {r.utility === 'water' && <p>Avser kommunens VA-information. Fastighetens anslutning till kommunalt VA är inte bekräftad.</p>}
      <p>{r.approximatePosition} med ungefärlig position. Kontrollera kartnålen för dessa adresser.</p>
      {r.gaps.length > 0 && <ul>{r.gaps.map((g) => <li key={`${g.operatorId}:${g.reason}`}>{g.operatorName}: {g.count} adresser – {g.reason === 'stale' ? 'källan kunde inte kontrolleras' : 'bevakas inte ännu'}</li>)}</ul>}
      <PropertyGaps rows={r.properties.filter((p) => p.coverage !== 'monitored' || p.approximatePosition)} names={names} basePath={basePath} />
      {!!r.sources?.length && <details><summary>Källhälsa för {LABEL[r.utility].toLocaleLowerCase('sv')}</summary><ul>{r.sources.map((s) => <li key={s.operatorId}>
        {s.name}: {!s.enabled ? 'avstängd' : s.current ? 'aktuell' : s.lastStatus === 'partial' ? 'ofullständigt svar' : 'kunde inte kontrolleras'}
        {s.enabled && s.attention ? ` · behöver åtgärd (${s.attention === 'format_changed' ? 'ändrat format' : 'nås inte'})` : ''}
      </li>)}</ul></details>}
    </details>)}
  </div>;
}
