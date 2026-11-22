import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { DEMO_SIZE_COOKIE, DEMO_SIZE_PARAM, demoSizeParam } from './lib/demo/size';

/**
 * Next.js 16 proxy (formerly middleware). Clerk authenticates live routes; those outside the public
 * allowlist require a signed-in user. `/` is the public landing page and `/priser` the public pricing page. Organization
 * checks happen server-side in the dashboard layout and again in the Fastify API.
 */
const PUBLIC_ROUTES = [
  '/', '/priser', '/villkor', '/integritetspolicy', '/cookies', '/pub-avtal', '/datakallor',
  '/sign-in(.*)', '/sign-up(.*)', '/onboarding(.*)',
];
const isPublicRoute = createRouteMatcher(PUBLIC_ROUTES);
// API route handlers enforce auth themselves and answer 401 JSON instead of an HTML redirect.
const isApiRoute = createRouteMatcher(['/api(.*)']);

const clerkProxy = clerkMiddleware(
  async (auth, req) => {
    if (isApiRoute(req)) return;
    if (!isPublicRoute(req)) await auth.protect();
  },
  // Keep users on our own branded pages instead of the Clerk-hosted Account Portal.
  { signInUrl: '/sign-in', signUpUrl: '/sign-up' },
);

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  const path = req.nextUrl.pathname;
  if (path === '/demo' || path.startsWith('/demo/')) {
    // The gated fixture dashboard has no customer data or Clerk session dependency.
    if (process.env.FASTIGHETSRADAR_DEMO_ENABLED !== 'true') return new NextResponse('Not found', { status: 404 });
    // `?n=500`: remember the test-portfolio size for the demo pages, then drop it from the URL.
    if (req.nextUrl.searchParams.has(DEMO_SIZE_PARAM)) {
      const size = demoSizeParam(req.nextUrl.searchParams.get(DEMO_SIZE_PARAM));
      const url = req.nextUrl.clone();
      url.searchParams.delete(DEMO_SIZE_PARAM);
      const res = NextResponse.redirect(url);
      if (size) res.cookies.set(DEMO_SIZE_COOKIE, size, { path: '/demo', sameSite: 'lax', httpOnly: true });
      else res.cookies.delete({ name: DEMO_SIZE_COOKIE, path: '/demo' });
      return res;
    }
    return NextResponse.next();
  }
  return clerkProxy(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
