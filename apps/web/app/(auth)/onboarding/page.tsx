import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { OnboardingForm } from '@/components/auth/OnboardingForm';

export const metadata: Metadata = { title: 'Välj organisation · FastighetsRadar' };

async function primaryEmail(userId: string): Promise<string | undefined> {
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    return user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  } catch {
    return undefined;
  }
}

/**
 * Organization onboarding (step 2 after sign-up). Every property belongs to a Clerk organization;
 * users with no active organization land here (also via the `choose-organization` session task).
 * A one-person "personal workspace" is simply an organization with a single member.
 */
export default async function OnboardingPage() {
  // Pending sessions (choose-organization task) must still reach this page.
  const { userId, orgId } = await auth({ treatPendingAsSignedOut: false });
  if (!userId) redirect('/sign-in');
  if (orgId) redirect('/overview');
  return <OnboardingForm email={await primaryEmail(userId)} />;
}
