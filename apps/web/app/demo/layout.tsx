import { notFound } from 'next/navigation';
import type { Viewport } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { DemoAcknowledgementProvider } from '@/components/acknowledgements/DemoAcknowledgements';
import { DemoSmsRulesProvider } from '@/components/notifications/DemoSmsRules';
import { loadDemoPortfolio, requestedDemoSize } from '@/lib/data/portfolio';

export const dynamic = 'force-dynamic';
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

/** Design-comparison dashboard with labelled fixtures. Disabled unless FASTIGHETSRADAR_DEMO_ENABLED=true. */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const result = await loadDemoPortfolio(await requestedDemoSize());
  if (result.status !== 'ok') notFound();
  return (
    <DemoAcknowledgementProvider portfolio={result.portfolio}>
      <DemoSmsRulesProvider>
        <AppShell mode="demo" basePath="/demo" portfolio={result.portfolio}>
          {children}
        </AppShell>
      </DemoSmsRulesProvider>
    </DemoAcknowledgementProvider>
  );
}
