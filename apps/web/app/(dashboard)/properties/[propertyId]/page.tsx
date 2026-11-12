import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadLivePortfolio } from '@/lib/data/portfolio';

type Params = Promise<{ propertyId: string }>;

async function findProperty(propertyId: string) {
  const result = await loadLivePortfolio();
  if (result.status !== 'ok') return null;
  const id = decodeURIComponent(propertyId);
  return result.portfolio.properties.find((s) => s.property.id === id) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const s = await findProperty((await params).propertyId);
  return { title: `${s?.property.name ?? 'Property'} · FastighetsRadar` };
}

/** Validates (org-scoped, server-side) that the property exists; UI is rendered by `../layout.tsx`. */
export default async function PropertyPage({ params }: { params: Params }) {
  const s = await findProperty((await params).propertyId);
  if (!s) notFound();
  return null;
}
