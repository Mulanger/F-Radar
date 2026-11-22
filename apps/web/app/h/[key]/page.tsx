import { redirect, notFound } from 'next/navigation';
import { internalApiJson, InternalApiError } from '@/lib/server/internal-api';

export const dynamic = 'force-dynamic';

/**
 * SMS short link `/h/<key>` for an event over several properties → the event page
 * (docs/plans/skalning.md, Fas 2 / S-09). Like `/p/<key>`: outside the dashboard layout, the API
 * checks that the event reached the active organization.
 */
export default async function EventShortLink({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[0-9a-f]{16}$/.test(key)) notFound();
  let id: string;
  try {
    id = (await internalApiJson<{ id: string }>(`/v1/events/links/${key}`)).id;
  } catch (err) {
    if (err instanceof InternalApiError && err.status === 404) notFound();
    if (err instanceof InternalApiError && err.status === 403) redirect('/onboarding');
    if (err instanceof InternalApiError && err.status === 401) redirect('/sign-in');
    throw err;
  }
  redirect(`/alerts/${encodeURIComponent(id)}`);
}
