import Link from 'next/link';
import type { UtilityCoverageReport } from '@fastighetsradar/domain';
import { C } from '@/lib/design/tokens';

const LABEL = { electricity: 'El', district_heating: 'Fjärrvärme', district_cooling: 'Fjärrkyla', gas: 'Gas', water: 'Vatten och avlopp' };
const COVERAGE = { monitored: 'Bevakas', not_monitored: 'Leverantören bevakas inte ännu', stale: 'Källan kunde inte kontrolleras', unknown: 'Ej bedömd' };

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
      <ul>{r.properties.filter((p) => p.coverage !== 'monitored' || p.approximatePosition).map((p) => <li key={p.propertyId}>
        <Link href={`${basePath}/properties/${encodeURIComponent(p.propertyId)}`}>{names.get(p.propertyId) ?? 'Fastighet'}</Link>
        {': '}{COVERAGE[p.coverage]}{p.operatorName ? ` – ${p.operatorName}` : ''}{p.approximatePosition ? ' · ungefärlig position' : ''}
      </li>)}</ul>
      {!!r.sources?.length && <details><summary>Källhälsa för {LABEL[r.utility].toLocaleLowerCase('sv')}</summary><ul>{r.sources.map((s) => <li key={s.operatorId}>
        {s.name}: {!s.enabled ? 'avstängd' : s.current ? 'aktuell' : s.lastStatus === 'partial' ? 'ofullständigt svar' : 'kunde inte kontrolleras'}
        {s.enabled && s.attention ? ` · behöver åtgärd (${s.attention === 'format_changed' ? 'ändrat format' : 'nås inte'})` : ''}
      </li>)}</ul></details>}
    </details>)}
  </div>;
}
