import type { Metadata } from 'next';
import { PortfolioOverview } from '@/components/dashboard/PortfolioOverview';

export const metadata: Metadata = { title: 'Portföljöversikt · FastighetsRadar' };

export default function OverviewPage() {
  return <PortfolioOverview />;
}
