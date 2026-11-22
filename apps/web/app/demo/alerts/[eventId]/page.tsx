import { notFound } from 'next/navigation';
import { EventPageView } from '@/components/alerts/EventPage';
import { loadDemoEventPage, requestedDemoSize } from '@/lib/data/portfolio';

export const metadata = { title: 'Demo · Händelse · FastighetsRadar' };

/** Same page as live, built from the demo feed. */
export default async function DemoEventRoute({ params }: { params: Promise<{ eventId: string }> }) {
  const r = await loadDemoEventPage(await requestedDemoSize(), decodeURIComponent((await params).eventId));
  if (r.status !== 'ok') notFound();
  return <EventPageView page={r.page} />;
}
