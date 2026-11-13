'use client';

import { SignUp } from '@clerk/nextjs';
import { useState } from 'react';
import { readSignupEmail } from '@/lib/landing/signup-email';

/** Clerk sign-up that picks up the e-mail typed on the landing page (see `signup-email.ts`). */
export function PrefilledSignUp() {
  const [emailAddress] = useState(readSignupEmail);
  return <SignUp initialValues={emailAddress ? { emailAddress } : undefined} />;
}
