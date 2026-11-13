import type { Metadata } from 'next';
import { AuthFrame } from '@/components/auth/AuthFrame';
import { PrefilledSignUp } from '@/components/auth/PrefilledSignUp';

export const metadata: Metadata = { title: 'Skapa konto · FastighetsRadar' };

export default function SignUpPage() {
  return (
    <AuthFrame title="Skapa ditt konto" subtitle="Därefter skapar du en organisation – din arbetsyta för fastigheter och larm.">
      <PrefilledSignUp />
    </AuthFrame>
  );
}
