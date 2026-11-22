import { notFound } from 'next/navigation';
import { EventPageView } from '@/components/alerts/EventPage';
import { loadLiveEventPage } from '@/lib/data/portfolio';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ eventId: string }> }) {
  const id = decodeURIComponent((await params).eventId);
  const r = UUID.test(id) ? await loadLiveEventPage(id) : null;
  return { title: `${r?.status === 'ok' ? r.page.event.title : 'Händelse'} · FastighetsRadar` };
}

/** One event over the organization's properties (docs/plans/skalning.md, Fas 2 / S-09). */
export default async function EventRoute({ params }: { params: Promise<{ eventId: string }> }) {
  const id = decodeURIComponent((await params).eventId);
  if (!UUID.test(id)) notFound();
  const r = await loadLiveEventPage(id);
  if (r.status === 'not_found') notFound();
  return <EventPageView page={r.status === 'ok' ? r.page : null} reason={r.status === 'unavailable' ? r.reason : undefined} />;
}
