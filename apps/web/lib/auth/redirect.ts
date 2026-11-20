/**
 * Where to go after signing in. Clerk adds `redirect_url` (an absolute URL) when a protected
 * page bounces a visitor to /sign-in; only same-origin targets are honoured.
 */
export function redirectTarget(search: string, origin: string, fallback: string): string {
  const raw = new URLSearchParams(search).get('redirect_url');
  if (!raw) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (url.pathname.startsWith('/sign-in') || url.pathname.startsWith('/sign-up')) return fallback;
    return path || fallback;
  } catch {
    return fallback;
  }
}

/** Destination after a session becomes active; pending organization choice goes to onboarding. */
export function destinationFor(task: string | undefined, fallback: string): string {
  if (task === 'choose-organization') return '/onboarding';
  if (task) return `/sign-in/tasks/${task}`;
  if (typeof window === 'undefined') return fallback;
  return redirectTarget(window.location.search, window.location.origin, fallback);
}
