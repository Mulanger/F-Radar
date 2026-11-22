import { redirect, notFound } from 'next/navigation';
import { internalApiJson, InternalApiError } from '@/lib/server/internal-api';

export const dynamic = 'force-dynamic';

/**
 * SMS short link `/p/<key>` → the property page. Outside the `(dashboard)` group on purpose
 * (docs/plans/skalning.md, S-14): it only looks up the key and redirects, so opening an alert
 * on a phone loads the portfolio once (on the property page), not twice. Sign-in is enforced by
 * the proxy; the API checks that the link belongs to the active organization.
 */
export default async function PropertyShortLink({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[a-f0-9]{16}$/.test(key)) notFound();
  let id: string;
  try {
    id = (await internalApiJson<{ id: string }>(`/v1/notifications/links/${key}`)).id;
  } catch (err) {
    if (err instanceof InternalApiError && err.status === 404) notFound();
    if (err instanceof InternalApiError && err.status === 403) redirect('/onboarding');
    if (err instanceof InternalApiError && err.status === 401) redirect('/sign-in');
    throw err;
  }
  redirect(`/properties/${encodeURIComponent(id)}`);
}
