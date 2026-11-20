import type { Metadata } from 'next';
import { CredentialFrame } from '@/components/auth/CredentialFrame';
import { PrefilledSignUp } from '@/components/auth/PrefilledSignUp';

export const metadata: Metadata = { title: 'Skapa konto · FastighetsRadar' };

export default function SignUpPage() {
  return (
    <CredentialFrame>
      <PrefilledSignUp />
    </CredentialFrame>
  );
}
