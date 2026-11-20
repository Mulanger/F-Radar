'use client';

import { useClerk } from '@clerk/nextjs';

interface EnvironmentLike {
  userSettings?: {
    passwordSettings?: { min_length?: number };
    signUp?: { legal_consent_enabled?: boolean };
  };
}

const DEFAULT_MIN_LENGTH = 8;

/**
 * Instance rules the custom forms mirror client-side (minimum password length, legal consent).
 * Read defensively from the loaded Clerk environment; Clerk still validates server-side.
 */
export function useClerkSettings() {
  const clerk = useClerk();
  let env: EnvironmentLike | undefined;
  try {
    env = (clerk as unknown as { environment?: EnvironmentLike }).environment
      ?? (typeof window !== 'undefined' ? (window as unknown as { Clerk?: { environment?: EnvironmentLike } }).Clerk?.environment : undefined);
  } catch {
    env = undefined;
  }
  const min = env?.userSettings?.passwordSettings?.min_length;
  return {
    loaded: clerk.loaded,
    passwordMinLength: typeof min === 'number' && min > 0 ? min : DEFAULT_MIN_LENGTH,
    legalConsent: !!env?.userSettings?.signUp?.legal_consent_enabled,
  };
}
