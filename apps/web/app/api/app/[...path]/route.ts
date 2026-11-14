import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { internalApi } from '@/lib/server/internal-api';

/**
 * Backend-for-frontend proxy: browser → /api/app/<path> → Fastify /v1/<path>.
 *
 *  - Only allowlisted paths/methods are forwarded (no open proxy).
 *  - The Clerk session token is attached server-side; the browser never talks to Fastify.
 *  - State-changing requests must be same-origin (CSRF defence in addition to SameSite cookies).
 *  - Organization context comes from the verified token inside Fastify, never from the client.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTES: Array<{ pattern: RegExp; methods: string[] }> = [
  { pattern: /^notifications$/, methods: ['GET'] },
  { pattern: /^notifications\/(categories|activity|usage)$/, methods: ['GET'] },
  { pattern: /^notifications\/(rules|recipients)$/, methods: ['GET', 'POST'] },
  { pattern: new RegExp(`^notifications/(rules|recipients)/${UUID}$`), methods: ['PATCH','DELETE'] },
  { pattern: new RegExp(`^notifications/rules/${UUID}/(preview|test)$`), methods: ['POST'] },
  { pattern: new RegExp(`^notifications/recipients/${UUID}/verification(/complete)?$`), methods: ['POST'] },
  { pattern: new RegExp(`^notifications/properties/${UUID}$`), methods: ['PATCH'] },
  { pattern: /^me$/, methods: ['GET'] },
  { pattern: /^portfolio$/, methods: ['GET'] },
  { pattern: /^portfolio\/summary$/, methods: ['GET'] },
  { pattern: new RegExp(`^properties/${UUID}/history$`), methods: ['GET'] },
  { pattern: new RegExp(`^properties/${UUID}/(snapshot|forecast|warnings|events|environment|flood)$`), methods: ['GET'] },
  { pattern: /^sources\/status$/, methods: ['GET'] },
  { pattern: /^changes$/, methods: ['GET'] },
  { pattern: /^stream$/, methods: ['GET'] },
  { pattern: /^properties$/, methods: ['GET', 'POST'] },
  { pattern: new RegExp(`^properties/${UUID}$`), methods: ['GET', 'PATCH', 'DELETE'] },
  { pattern: /^geocoding\/suggestions$/, methods: ['GET'] },
];

function problem(status: number, title: string) {
  return NextResponse.json({ type: 'about:blank', title, status }, { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join('/');
  const route = ROUTES.find((r) => r.pattern.test(path));
  if (!route) return problem(404, 'Not Found');
  if (!route.methods.includes(req.method)) return problem(405, 'Method Not Allowed');
  if (req.method !== 'GET' && !sameOrigin(req)) return problem(403, 'Cross-origin request rejected');

  const { userId, getToken } = await auth();
  if (!userId) return problem(401, 'Unauthorized');
  const token = await getToken();
  if (!token) return problem(401, 'Unauthorized');

  const search = req.nextUrl.search;
  const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text();
  let upstream: Response;
  try {
    upstream = await internalApi(`/v1/${path}${search}`, {
      method: req.method,
      token,
      body,
      headers: path === 'stream' ? { accept: 'text/event-stream' } : body ? { 'content-type': 'application/json' } : undefined,
      signal: req.signal,
    });
  } catch {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    return problem(502, 'API unavailable');
  }
  const headers = new Headers({ 'cache-control': 'no-store' });
  const ct = upstream.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  // Live stream (SSE): pass the body through unbuffered; it ends when either side disconnects.
  if (path === 'stream' && upstream.ok && ct?.startsWith('text/event-stream')) {
    headers.set('x-accel-buffering', 'no');
    return new Response(upstream.body, { status: 200, headers });
  }
  return new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), { status: upstream.status, headers });
}

export const dynamic = 'force-dynamic';
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
