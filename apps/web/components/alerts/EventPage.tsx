'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import type { EventPage, PropertySnapshot } from '@fastighetsradar/domain';
import { formatClock, formatShortDate } from '@fastighetsradar/domain';
import { SEV } from '@/lib/design/tokens';
import { propertyHref } from '@/lib/navigation/dashboard';
import { useDashboard } from '@/lib/state/dashboard-state';
import { DashboardLink } from '../shell/DashboardLink';
import { PortfolioMap } from '../maps/PortfolioMap';
import { FeedAckAllButton, FeedAckButton, useFeedAcks, type FeedAckRow } from '../dashboard/FeedAck';
import styles from './EventPage.module.css';

/** Rows shown before "Visa alla": the list stays quick at 1000 properties. */
export const EVENT_LIST_MAX = 100;

const when = (iso: string | null) => (iso ? `${formatShortDate(iso).replace(/\.$/, '')} ${formatClock(iso)}` : null);
const fold = (s: string) => s.toLocaleLowerCase('sv').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * One event over many properties (docs/plans/skalning.md, Fas 2 / S-09): what a feed card and a
 * grouped SMS open. The official text once, the affected properties on the map and in a searchable
 * list, and "Kvittera alla" – instead of one row per property in the feed.
 */
export function EventPageView({ page, reason }: { page: EventPage | null; reason?: string }) {
  const ds = useDashboard();
  const acks = useFeedAcks();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const search = useDeferredValue(query);

  const rows = useMemo<Array<FeedAckRow & { propertyId: string; name: string; address: string }>>(() => (page?.properties ?? []).map((p) => ({
    id: p.changeId ?? `none-${p.propertyId}`,
    title: `${page!.event.title} · ${p.name}`,
    ackRequired: p.ackRequired && !!p.changeId,
    acknowledgedAt: p.acknowledgedAt,
    eventGroupKey: page!.event.id,
    propertyId: p.propertyId,
    name: p.name,
    address: p.address,
  })), [page]);
  const mapList = useMemo(() => rows.map((r) => ds.property(r.propertyId)).filter((s): s is PropertySnapshot => !!s), [rows, ds]);
  const legend = useMemo(() => (['critical', 'warning', 'monitor', 'normal', 'unknown'] as const)
    .map((k) => ({ key: k, label: SEV[k].label, c: SEV[k].c, n: mapList.filter((s) => s.property.status === k).length }))
    .filter((l) => l.n > 0), [mapList]);
  const matches = useMemo(() => {
    const words = fold(search).split(/\s+/).filter(Boolean);
    return words.length ? rows.filter((r) => words.every((w) => fold(`${r.name} ${r.address}`).includes(w))) : rows;
  }, [rows, search]);

  if (!page) {
    return <div className={styles.page}><Back basePath={ds.basePath} /><p className={styles.notice}>{reason ?? 'Händelsen kunde inte visas.'}</p></div>;
  }
  const e = page.event;
  const sev = SEV[e.severity] ?? SEV.unknown;
  const waiting = rows.filter((r) => r.ackRequired && !acks.ackedAt(r)).length;
  const shown = all ? matches : matches.slice(0, EVENT_LIST_MAX);
  const validity = [when(e.validFrom), when(e.validTo)].filter(Boolean).join(' – ');

  return (
    <div className={styles.page}>
      <Back basePath={ds.basePath} />
      <header className={styles.header}>
        <div className={styles.eyebrow}>
          <span className={styles.chip} style={{ background: sev.bg, color: sev.c }}>{sev.label}</span>
          <span>{e.sourceLabel}</span>
          {e.publishedAt && <span>· {when(e.publishedAt)}</span>}
          {!e.active && <span>· Avslutad</span>}
          {e.origin === 'demo_fixture' && <span>· Demodata</span>}
        </div>
        <h1 className={styles.title}>{e.title}</h1>
        <div className={styles.summary}>
          <span>{rows.length} {rows.length === 1 ? 'fastighet' : 'fastigheter'}</span>
          {waiting > 0 && <span className={styles.waiting}>{waiting} att kvittera</span>}
          {waiting === 0 && rows.some((r) => r.ackRequired) && <span className={styles.done}>Alla kvitterade</span>}
          <FeedAckAllButton rows={rows} acks={acks} title={e.title} />
        </div>
      </header>

      {reason && <p className={styles.notice}>{reason}</p>}

      <section className={styles.text} aria-label="Meddelande från källan">
        {e.areaLabel && <div className={styles.meta}>Område: {e.areaLabel}</div>}
        {validity && <div className={styles.meta}>Gäller: {validity}</div>}
        <p>{e.description ?? 'Källan har ingen beskrivning av händelsen.'}</p>
        {e.sourceUrl && <a href={e.sourceUrl} target="_blank" rel="noreferrer">Läs hos {e.sourceLabel}</a>}
      </section>

      {mapList.length > 0 && (
        <section className={styles.map} aria-label="Berörda fastigheter på kartan">
          <PortfolioMap list={mapList} legend={legend} onOpen={(id) => ds.openProperty(id)} />
        </section>
      )}

      <section className={styles.list} aria-label="Berörda fastigheter">
        <div className={styles.listHead}>
          <h2>Berörda fastigheter</h2>
          <input type="search" value={query} onChange={(ev) => { setQuery(ev.target.value); setAll(false); }} placeholder="Sök fastighet eller adress" aria-label="Sök bland berörda fastigheter" />
        </div>
        <ul>
          {shown.map((r) => (
            <li key={r.propertyId}>
              <span className={styles.property}>
                <DashboardLink href={propertyHref(ds.basePath, r.propertyId, 'alerts')}>{r.name}</DashboardLink>
                <span className={styles.address}>{r.address}</span>
              </span>
              <FeedAckButton f={r} acks={acks} />
            </li>
          ))}
        </ul>
        {!matches.length && <p className={styles.empty}>Ingen berörd fastighet matchar sökningen.</p>}
        {!all && matches.length > EVENT_LIST_MAX && (
          <button type="button" className={styles.more} onClick={() => setAll(true)}>Visa alla {matches.length}</button>
        )}
      </section>
    </div>
  );
}

function Back({ basePath }: { basePath: string }) {
  return <DashboardLink className={styles.back} href={`${basePath}/alerts`}>← Larm och händelser</DashboardLink>;
}
