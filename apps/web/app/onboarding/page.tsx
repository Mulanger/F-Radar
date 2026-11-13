import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { OrganizationList } from '@clerk/nextjs';
import { AuthFrame } from '@/components/auth/AuthFrame';

export const metadata: Metadata = { title: 'Välj organisation · FastighetsRadar' };

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
      title="Välj arbetsyta"
      subtitle="Skapa en organisation för ditt företag – eller gå med i en som du har bjudits in till."
    >
      <OrganizationList hidePersonal afterCreateOrganizationUrl="/overview" afterSelectOrganizationUrl="/overview" />
    </AuthFrame>
  );
}
