import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';
import { AuthFrame } from '@/components/auth/AuthFrame';

export const metadata: Metadata = { title: 'Logga in · FastighetsRadar' };

export default function SignInPage() {
  return (
    <AuthFrame title="Välkommen tillbaka" subtitle="Logga in för att bevaka dina fastigheter med svenska offentliga data.">
      <SignIn />
    </AuthFrame>
  );
}
