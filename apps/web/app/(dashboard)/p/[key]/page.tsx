import { redirect, notFound } from 'next/navigation';
import { internalApiJson, InternalApiError } from '@/lib/server/internal-api';
export default async function PropertyShortLink({params}:{params:Promise<{key:string}>}) {
  const {key}=await params;
  if(!/^[a-f0-9]{16}$/.test(key))notFound();
  let id:string;
  try { id=(await internalApiJson<{id:string}>(`/v1/notifications/links/${key}`)).id; }
  catch(err){ if(err instanceof InternalApiError && err.status===404)notFound();throw err; }
  redirect(`/properties/${id}`);
}
