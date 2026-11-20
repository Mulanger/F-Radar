import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';
import { CredentialFrame, CredentialLoading } from '@/components/auth/CredentialFrame';
import { credentialAppearance } from '@/lib/design/credential-appearance';

export const metadata: Metadata = { title: 'Logga in · FastighetsRadar' };

export default function SignInPage() {
  return (
    <CredentialFrame>
      <SignIn appearance={credentialAppearance} fallback={<CredentialLoading />} />
    </CredentialFrame>
  );
}
