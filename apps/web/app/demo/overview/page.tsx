import type { Metadata } from 'next';
import { PortfolioOverview } from '@/components/dashboard/PortfolioOverview';

export const metadata: Metadata = { title: 'Demo · Portföljöversikt · FastighetsRadar' };

export default function DemoOverviewPage() {
  return <PortfolioOverview />;
}
