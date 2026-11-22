import { notFound } from 'next/navigation';
import { loadDemoPropertySnapshot, requestedDemoSize } from '@/lib/data/portfolio';
import { PropertyDetailData } from '@/lib/state/property-detail';

/** Same split as live: the layout has the list, this page provides one full snapshot. */
export default async function DemoPropertyPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const id = decodeURIComponent((await params).propertyId);
  const r = await loadDemoPropertySnapshot(await requestedDemoSize(), id);
  if (r.status !== 'ok') notFound();
  return <PropertyDetailData id={id} snapshot={r.snapshot} />;
}
