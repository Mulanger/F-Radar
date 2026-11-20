/**
 * "Kom ihåg mig". Clerk sessions are long-lived by default; when the box is unchecked we mark
 * the browser and set a cookie without expiry. Once the browser has been closed that cookie is
 * gone, and `SessionPersistenceGuard` signs the user out on the next visit.
 */
const FLAG_KEY = 'fr-ephemeral-session';
const ALIVE_COOKIE = 'fr_session_alive';

export function rememberSession(remember: boolean): void {
  try {
    if (remember) {
      window.localStorage.removeItem(FLAG_KEY);
      return;
    }
    window.localStorage.setItem(FLAG_KEY, '1');
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${ALIVE_COOKIE}=1; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* storage unavailable – the session simply persists */
  }
}

/** True when the user chose not to be remembered and the browser has since been restarted. */
export function ephemeralSessionExpired(): boolean {
  try {
    if (window.localStorage.getItem(FLAG_KEY) !== '1') return false;
    return !document.cookie.split(/;\s*/).includes(`${ALIVE_COOKIE}=1`);
  } catch {
    return false;
  }
}

export function clearEphemeralSession(): void {
  try {
    window.localStorage.removeItem(FLAG_KEY);
  } catch {
    /* ignore */
  }
}
