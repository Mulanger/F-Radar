'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useClerk, useOrganizationList } from '@clerk/nextjs';
import { authErrors, NETWORK_ERROR, type AuthErrors } from '@/lib/auth/clerk-errors';
import { destinationFor } from '@/lib/auth/redirect';
import { OrganizationStep } from './OrganizationStep';

const LOADING = 'Sidan laddar fortfarande. Försök igen om ett ögonblick.';

/**
 * Onboarding step 2 wired to Clerk: the company name becomes the user's organization, which is
 * made active (this also completes Clerk's choose-organization session task).
 */
export function OnboardingForm({ email }: { email?: string }) {
  const router = useRouter();
  const clerk = useClerk();
  const { isLoaded, createOrganization, setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const [redirecting, setRedirecting] = useState(false);
  const reopened = useRef(false);

  const activate = async (organization: string) => {
    if (!setActive) return { form: LOADING };
    await setActive({
      organization,
      navigate: async ({ session, decorateUrl }) => {
        const task = session?.currentTask?.key;
        const url = decorateUrl(destinationFor(task === 'choose-organization' ? undefined : task, '/overview'));
        if (url.startsWith('http')) window.location.href = url;
        else router.push(url);
      },
    });
  };

  // Someone who already belongs to a company (e.g. lost their active selection) is not asked
  // to create a second one – their organization is simply reopened.
  const existing = userMemberships.data?.[0]?.organization.id;
  useEffect(() => {
    if (!isLoaded || !existing || reopened.current) return;
    reopened.current = true;
    setRedirecting(true);
    activate(existing).catch(() => setRedirecting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when the membership is known
  }, [isLoaded, existing]);

  const create = async (name: string): Promise<AuthErrors | void> => {
    if (!createOrganization) return { form: LOADING };
    try {
      const org = await createOrganization({ name });
      return await activate(org.id);
    } catch (error) {
      // Clerk API failures carry an `errors` list; anything else is a network/runtime failure.
      if (!Array.isArray((error as { errors?: unknown } | null)?.errors)) return { form: NETWORK_ERROR };
      return authErrors(error, 'organization');
    }
  };

  return (
    <OrganizationStep
      email={email}
      redirecting={redirecting}
      onCreate={create}
      onSignOut={() => void clerk.signOut({ redirectUrl: '/sign-in' })}
    />
  );
}
