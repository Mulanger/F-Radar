import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

/**
 * Next.js 16 proxy (formerly middleware). Clerk authenticates live routes; those outside the public
 * allowlist require a signed-in user. `/` is the public landing page. Organization
 * checks happen server-side in the dashboard layout and again in the Fastify API.
 */
const PUBLIC_ROUTES = ['/', '/sign-in(.*)', '/sign-up(.*)', '/onboarding(.*)'];
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
    return process.env.FASTIGHETSRADAR_DEMO_ENABLED === 'true' ? NextResponse.next() : new NextResponse('Not found', { status: 404 });
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
