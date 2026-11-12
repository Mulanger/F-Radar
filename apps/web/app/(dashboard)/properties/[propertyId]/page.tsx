import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPortfolio } from '@/lib/data/portfolio';

type Params = Promise<{ propertyId: string }>;

async function findProperty(propertyId: string) {
  const result = await loadPortfolio();
  if (result.status !== 'ok') return null;
  const id = decodeURIComponent(propertyId);
  return result.portfolio.properties.find((s) => s.property.id === id) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const s = await findProperty((await params).propertyId);
  return { title: `${s?.property.name ?? 'Property'} · FastighetsRadar` };
}

/** Validates the id server-side; the UI itself is rendered by `../layout.tsx`. */
export default async function PropertyPage({ params }: { params: Params }) {
  const s = await findProperty((await params).propertyId);
  if (!s) notFound();
  return null;
}
