/**
 * Hands the e-mail typed on the landing page over to the sign-up page. sessionStorage keeps it
 * out of URLs, logs and history, and it disappears when the tab is closed.
 */
export const SIGNUP_EMAIL_KEY = 'fr-signup-email';

export function storeSignupEmail(email: string): void {
  const value = email.trim();
  if (!value) return;
  try {
    window.sessionStorage.setItem(SIGNUP_EMAIL_KEY, value);
  } catch {
    /* storage unavailable – the sign-up page simply starts empty */
  }
}

export function readSignupEmail(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage.getItem(SIGNUP_EMAIL_KEY) || undefined;
  } catch {
    return undefined;
  }
}
