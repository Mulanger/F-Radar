import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignIn } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { SignInForm } from '@/components/auth/SignInForm';

export const metadata: Metadata = { title: 'Logga in · FastighetsRadar' };

export default async function SignInPage({ params }: { params: Promise<{ 'sign-in'?: string[] }> }) {
  const { 'sign-in': rest } = await params;
  // Sub-paths (session tasks, SSO callbacks) are Clerk-driven steps; keep Clerk's component for them.
  if (rest?.length) return <SignIn />;
  const { userId } = await auth();
  if (userId) redirect('/overview');
  return <SignInForm />;
}
