import { z } from 'zod';

/**
 * Versions of the published Användarvillkor and Integritetspolicy (the date they took effect).
 * Bump a version when the document changes materially: organizations whose recorded acceptance is
 * older are asked to accept again the next time an administrator opens the dashboard.
 */
export const LEGAL_VERSIONS = { terms: '2026-11-21', privacy: '2026-11-21' } as const;

/** Stored on the Clerk user at sign-up (`unsafeMetadata.legal`) and copied to the organization. */
export interface SignupLegalConsent {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
}

export function signupLegalConsent(now: Date = new Date()): SignupLegalConsent {
  return { termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, acceptedAt: now.toISOString() };
}

/** The acceptance time from a user's sign-up metadata, when it covers the current versions. */
export function currentSignupConsent(metadata: unknown): string | null {
  const legal = (metadata as { legal?: Partial<SignupLegalConsent> } | null | undefined)?.legal;
  if (!legal || legal.termsVersion !== LEGAL_VERSIONS.terms || legal.privacyVersion !== LEGAL_VERSIONS.privacy) return null;
  return typeof legal.acceptedAt === 'string' && !Number.isNaN(Date.parse(legal.acceptedAt)) ? legal.acceptedAt : null;
}

/** POST /v1/legal/acceptance – only the current versions can be accepted. */
export const LegalAcceptanceInputSchema = z.object({
  termsVersion: z.literal(LEGAL_VERSIONS.terms),
  privacyVersion: z.literal(LEGAL_VERSIONS.privacy),
  /** When the user ticked the box at sign-up; the server falls back to now if it is implausible. */
  acceptedAt: z.iso.datetime({ offset: true }).optional(),
});
export type LegalAcceptanceInput = z.infer<typeof LegalAcceptanceInputSchema>;

export interface LegalAcceptanceStatus {
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  privacyVersion: string | null;
  privacyAcceptedAt: string | null;
  acceptedByUserId: string | null;
  /** The organization has accepted the versions in force. */
  current: boolean;
  /** This user may accept on the organization's behalf (organization administrators). */
  canAccept: boolean;
}
