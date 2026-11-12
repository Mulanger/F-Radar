import type { Metadata } from 'next';
import { SignUp } from '@clerk/nextjs';
import { AuthFrame } from '@/components/auth/AuthFrame';

export const metadata: Metadata = { title: 'Create account · FastighetsRadar' };

export default function SignUpPage() {
  return (
    <AuthFrame title="Create your account" subtitle="Next you'll create an organization – your workspace for properties and alerts.">
      <SignUp />
    </AuthFrame>
  );
}
