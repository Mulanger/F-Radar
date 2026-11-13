import type { Metadata } from 'next';
import { SignUp } from '@clerk/nextjs';
import { AuthFrame } from '@/components/auth/AuthFrame';

export const metadata: Metadata = { title: 'Skapa konto · FastighetsRadar' };

export default function SignUpPage() {
  return (
    <AuthFrame title="Skapa ditt konto" subtitle="Därefter skapar du en organisation – din arbetsyta för fastigheter och larm.">
      <SignUp />
    </AuthFrame>
  );
}
