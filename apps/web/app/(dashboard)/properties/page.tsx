import { redirect } from 'next/navigation';
import { loadPortfolio } from '@/lib/data/portfolio';

export default async function PropertiesIndex() {
  const result = await loadPortfolio();
  const first = result.status === 'ok' ? result.portfolio.properties[0] : undefined;
  redirect(first ? `/properties/${encodeURIComponent(first.property.id)}` : '/overview');
}
