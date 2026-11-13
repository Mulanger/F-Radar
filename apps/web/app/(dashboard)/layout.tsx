import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import { AppShell } from '@/components/shell/AppShell';
import { LiveUnavailable } from '@/components/shell/LiveUnavailable';
import { loadLivePortfolio } from '@/lib/data/portfolio';

export const dynamic = 'force-dynamic';

/**
 * Authenticated customer dashboard. No property data is requested until Clerk has
 * resolved BOTH a user and an active organization; the API re-verifies both.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/onboarding');

  const result = await loadLivePortfolio();
  if (result.status !== 'ok') {
    if (result.code === 'organization_required') redirect('/onboarding');
    return <LiveUnavailable reason={result.reason} />;
  }
  const user = await currentUser();
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || user?.primaryEmailAddress?.emailAddress || 'Signed in';
  const portfolio = {
    ...result.portfolio,
    viewer: { displayName, role: orgRole ?? '', initials: displayName.slice(0, 2).toUpperCase() },
  };
  return (
    <AppShell mode="live" basePath="" portfolio={portfolio}>
      {children}
    </AppShell>
  );
}
