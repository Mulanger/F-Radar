import type { Metadata } from 'next';
import { PortfolioOverview } from '@/components/dashboard/PortfolioOverview';

export const metadata: Metadata = { title: 'Demo · Portfolio Overview · FastighetsRadar' };

export default function DemoOverviewPage() {
  return <PortfolioOverview />;
}
