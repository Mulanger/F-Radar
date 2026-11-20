'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect } from 'react';
import { clearEphemeralSession, ephemeralSessionExpired } from '@/lib/auth/remember-me';

/** Ends the session on the first visit after a browser restart when "Kom ihåg mig" was unchecked. */
export function SessionPersistenceGuard() {
  const { isSignedIn, signOut } = useAuth();
  useEffect(() => {
    if (!isSignedIn || !ephemeralSessionExpired()) return;
    clearEphemeralSession();
    void signOut({ redirectUrl: '/sign-in' });
  }, [isSignedIn, signOut]);
  return null;
}
