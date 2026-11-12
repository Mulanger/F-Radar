import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { OrganizationList } from '@clerk/nextjs';
import { AuthFrame } from '@/components/auth/AuthFrame';

export const metadata: Metadata = { title: 'Choose organization · FastighetsRadar' };

/**
 * Organization onboarding. Every property belongs to a Clerk organization; users with
 * no active organization land here (also via the `choose-organization` session task).
 * A one-person "personal workspace" is simply an organization with a single member.
 */
export default async function OnboardingPage() {
  // Pending sessions (choose-organization task) must still reach this page.
  const { userId, orgId } = await auth({ treatPendingAsSignedOut: false });
  if (!userId) redirect('/sign-in');
  if (orgId) redirect('/overview');
  return (
    <AuthFrame
      title="Choose your workspace"
      subtitle="Create an organization for your company – or a personal workspace just for you – or join one you've been invited to."
    >
      <OrganizationList hidePersonal afterCreateOrganizationUrl="/overview" afterSelectOrganizationUrl="/overview" />
    </AuthFrame>
  );
}
