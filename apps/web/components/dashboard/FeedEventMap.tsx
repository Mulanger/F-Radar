'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PropertyEventMapEventSchema, type PropertyEventMapEvent, type PropertySnapshot } from '@fastighetsradar/domain';
import { demoEndedEvent } from '@/lib/demo/event-map-demo';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildDetailVM } from '@/lib/view-models/detail';
import { feedEventMapEntry } from '@/lib/view-models/event-map';
import { EventMapView } from '../maps/EventMapView';
import { useEventMap } from '../properties/use-event-map';
import styles from './FeedEventMap.module.css';

/** A feed row that can be shown on the map (from the overview VM). */
export interface FeedMapTarget {
  propertyId: string;
  mapEventId: string | null;
  /** The event has ended: shown greyed out where it was. */
  mapEnded?: boolean;
}

const MAP_ICON = 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14';

/**
 * The small map button in a feed card's lower right corner. It never navigates: clicks and keys stop
 * here, so the card around it can still open the property.
 */
export function FeedMapButton({ title, ended = false, onClick }: { title: string; ended?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.mapButton} ${ended ? styles.ended : ''}`}
      aria-label={`${ended ? 'Visa var det var på karta' : 'Visa på karta'}: ${title}`}
      title={ended ? 'Visa var det var på karta' : 'Visa på karta'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={MAP_ICON} />
      </svg>
    </button>
  );
}

/**
 * "Visa på karta" from the dashboard feed: opens the same map view as the property page, right on
 * the dashboard, without leaving it. `open(row)` shows the row's event; `view` is the overlay to render.
 */
export function useFeedEventMap() {
  const [target, setTarget] = useState<{ propertyId: string; eventId: string; ended: boolean; n: number } | null>(null);
  const open = useCallback((row: FeedMapTarget) => {
    if (row.mapEventId) setTarget({ propertyId: row.propertyId, eventId: row.mapEventId, ended: row.mapEnded === true, n: Date.now() });
  }, []);
  const close = useCallback(() => setTarget(null), []);
  const view = target ? <FeedEventMap key={target.n} propertyId={target.propertyId} eventId={target.eventId} ended={target.ended} onClose={close} /> : null;
  return { open, view };
}

function FeedEventMap({ propertyId, eventId, ended, onClose }: { propertyId: string; eventId: string; ended: boolean; onClose: () => void }) {
  const ds = useDashboard();
  const s = ds.portfolio.properties.find((p) => p.property.id === propertyId);
  // The property can disappear on a refresh (removed, or filtered away); then there is nothing to show.
  useEffect(() => {
    if (!s) onClose();
  }, [s, onClose]);
  if (!s) return null;
  return ended ? <EndedEventMap s={s} eventId={eventId} onClose={onClose} /> : <PropertyEventMap s={s} eventId={eventId} onClose={onClose} />;
}

/**
 * An ended event: its stored stretch is loaded on demand (live API, or the demo fixture) and drawn
 * grey. If it can no longer be found (removed after a week), the view simply closes.
 */
function EndedEventMap({ s, eventId, onClose }: { s: PropertySnapshot; eventId: string; onClose: () => void }) {
  const ds = useDashboard();
  const live = s.property.origin === 'live';
  const [data, setData] = useState<PropertyEventMapEvent | null>(() => (live ? null : demoEndedEvent(s.property.id, eventId)));

  useEffect(() => {
    if (!live) {
      if (!data) onClose();
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/app/properties/${encodeURIComponent(s.property.id)}/event-map/${encodeURIComponent(eventId)}`, { signal: ctrl.signal, cache: 'no-store', headers: { accept: 'application/json' } })
      .then(async (r) => {
        const parsed = r.ok ? PropertyEventMapEventSchema.safeParse(await r.json()) : null;
        if (parsed?.success && parsed.data.propertyId === s.property.id && parsed.data.item.eventId === eventId) setData(parsed.data);
        else onClose();
      })
      .catch(() => {
        if (!ctrl.signal.aborted) onClose();
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, s.property.id, eventId]);

  const nowIso = live ? new Date().toISOString() : ds.portfolio.generatedAt;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => (data ? feedEventMapEntry(data, nowIso) : null), [data]);
  if (!entry) return null;
  const p = s.property;
  return <EventMapView entries={[entry]} openId={entry.id} onSelect={() => {}} onClose={onClose} property={{ name: p.name, address: p.address, lat: p.location.lat, lon: p.location.lon }} live={live} />;
}

function PropertyEventMap({ s, eventId, onClose }: { s: PropertySnapshot; eventId: string; onClose: () => void }) {
  const ds = useDashboard();
  const smsOn = ds.isSmsOn(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => buildDetailVM(ds.portfolio, s, { ready: ds.ready, metric: ds.metric, smsOn, isRuleOn: ds.isRuleOn }), [ds.portfolio, s, ds.ready, ds.metric, smsOn]);
  const em = useEventMap(d);
  const [asked, setAsked] = useState(false);

  // Runs after useEventMap's own reset for a new property, so the event stays selected.
  useEffect(() => {
    em.open(eventId);
    setAsked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, d.id]);

  // The event ended while the map was open (a refresh removed it): close the view.
  useEffect(() => {
    if (asked && !em.openId) onClose();
  }, [asked, em.openId, onClose]);

  if (!em.openId || !em.entries.length) return null;
  return (
    <EventMapView
      entries={em.entries}
      openId={em.openId}
      onSelect={em.select}
      onClose={onClose}
      property={{ name: d.name, address: d.address, lat: d.location.lat, lon: d.location.lon }}
      live={d.origin === 'live'}
    />
  );
}
