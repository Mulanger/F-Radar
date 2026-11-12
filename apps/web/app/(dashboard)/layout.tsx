import { AppShell } from '@/components/shell/AppShell';
import { LiveUnavailable } from '@/components/shell/LiveUnavailable';
import { loadPortfolio } from '@/lib/data/portfolio';

// Data mode is read from server env at request time.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await loadPortfolio();
  if (result.status !== 'ok') return <LiveUnavailable reason={result.reason} />;
  return (
    <AppShell mode={result.mode} portfolio={result.portfolio}>
      {children}
    </AppShell>
  );
}
