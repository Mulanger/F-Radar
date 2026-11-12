import type { Metadata } from 'next';
import { PortfolioOverview } from '@/components/dashboard/PortfolioOverview';

export const metadata: Metadata = { title: 'Portfolio Overview · FastighetsRadar' };

export default function OverviewPage() {
  return <PortfolioOverview />;
}
