'use client';

import { SignUp } from '@clerk/nextjs';
import { useState } from 'react';
import { readSignupEmail } from '@/lib/landing/signup-email';
import { credentialAppearance } from '@/lib/design/credential-appearance';
import { CredentialLoading } from './CredentialFrame';

/** Clerk sign-up that picks up the e-mail typed on the landing page (see `signup-email.ts`). */
export function PrefilledSignUp() {
  const [emailAddress] = useState(readSignupEmail);
  return <SignUp appearance={credentialAppearance} fallback={<CredentialLoading />} initialValues={emailAddress ? { emailAddress } : undefined} />;
}
