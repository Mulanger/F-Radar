import { redirect } from 'next/navigation';
import { loadLivePortfolio } from '@/lib/data/portfolio';

export default async function PropertiesIndex() {
  const result = await loadLivePortfolio();
  const first = result.status === 'ok' ? result.portfolio.properties[0] : undefined;
  redirect(first ? `/properties/${encodeURIComponent(first.property.id)}` : '/overview');
}
