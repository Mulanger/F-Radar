import { notFound } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { loadDemoPortfolio } from '@/lib/data/portfolio';

export const dynamic = 'force-dynamic';

/** Design-comparison dashboard with labelled fixtures. Disabled unless FASTIGHETSRADAR_DEMO_ENABLED=true. */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const result = await loadDemoPortfolio();
  if (result.status !== 'ok') notFound();
  return (
    <AppShell mode="demo" basePath="/demo" portfolio={result.portfolio}>
      {children}
    </AppShell>
  );
}
