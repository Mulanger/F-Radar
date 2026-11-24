import { auth } from '@clerk/nextjs/server';
import { getRadarFrame } from '@/lib/server/portfolio-radar';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return new Response(null, { status: 401 });

  const frame = await getRadarFrame();
  if (!frame) return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });

  return new Response(new Uint8Array(frame.png), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=45',
      'x-radar-measured-at': frame.measuredAt,
    },
  });
}
