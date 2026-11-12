import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';
import { AuthFrame } from '@/components/auth/AuthFrame';

export const metadata: Metadata = { title: 'Sign in · FastighetsRadar' };

export default function SignInPage() {
  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to monitor your properties with Swedish public data.">
      <SignIn />
    </AuthFrame>
  );
}
