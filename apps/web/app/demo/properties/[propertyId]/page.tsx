import { notFound } from 'next/navigation';
import { loadDemoPortfolio } from '@/lib/data/portfolio';

export default async function DemoPropertyPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const result = await loadDemoPortfolio();
  const id = decodeURIComponent((await params).propertyId);
  if (result.status !== 'ok' || !result.portfolio.properties.some((s) => s.property.id === id)) notFound();
  return null;
}
