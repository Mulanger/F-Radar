import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadLivePropertySnapshot } from '@/lib/data/portfolio';
import { PropertyDetailData } from '@/lib/state/property-detail';

type Params = Promise<{ propertyId: string }>;

/**
 * Loads ONE property's full snapshot (org-scoped by the API) – not the whole portfolio
 * (docs/plans/skalning.md, S-10/S-11). Metadata and page share the request-cached call.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const r = await loadLivePropertySnapshot(decodeURIComponent((await params).propertyId));
  return { title: `${r.status === 'ok' ? r.snapshot.property.name : 'Fastighet'} · FastighetsRadar` };
}

/** Validates that the property exists and hands its full snapshot to `../layout.tsx`'s detail view. */
export default async function PropertyPage({ params }: { params: Params }) {
  const id = decodeURIComponent((await params).propertyId);
  const r = await loadLivePropertySnapshot(id);
  if (r.status === 'not_found') notFound();
  return <PropertyDetailData id={id} snapshot={r.status === 'ok' ? r.snapshot : null} reason={r.status === 'unavailable' ? r.reason : undefined} />;
}
