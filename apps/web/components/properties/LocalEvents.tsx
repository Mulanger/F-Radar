'use client';

import type { DetailVM } from '@/lib/view-models/detail';
import { EventMapView } from '../maps/EventMapView';
import { LocalEventsMap } from '../maps/LocalEventsMap';
import { LocalEventsPanel } from './LocalEventsPanel';
import { useEventMap } from './use-event-map';

/**
 * Nearby events: list, local map and the "Visa på karta" view. Desktop shows the list first;
 * the phone layout puts the map (wrapped in `mapClassName`) above the list, as in the design.
 */
export function LocalEvents({ d, layout, mapClassName }: { d: DetailVM; layout: 'desktop' | 'mobile'; mapClassName?: string }) {
  const em = useEventMap(d);
  const map = <LocalEventsMap d={d} onOpen={em.entries.length ? () => em.open() : undefined} />;
  return (
    <>
      {layout === 'mobile' && <div className={mapClassName}>{map}</div>}
      <LocalEventsPanel d={d} map={em} />
      {layout === 'desktop' && map}
      {em.openId && em.entries.length > 0 && (
        <EventMapView
          entries={em.entries}
          openId={em.openId}
          onSelect={em.select}
          onClose={em.close}
          property={{ name: d.name, address: d.address, lat: d.location.lat, lon: d.location.lon }}
          live={d.origin === 'live'}
        />
      )}
    </>
  );
}
