import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignUp } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { SignUpForm } from '@/components/auth/SignUpForm';

export const metadata: Metadata = { title: 'Skapa konto · FastighetsRadar' };

export default async function SignUpPage({ params }: { params: Promise<{ 'sign-up'?: string[] }> }) {
  const { 'sign-up': rest } = await params;
  // Sub-paths (verification links, SSO callbacks) are Clerk-driven steps; keep Clerk's component for them.
  if (rest?.length) return <SignUp />;
  const { userId } = await auth();
  if (userId) redirect('/overview');
  return <SignUpForm />;
}
