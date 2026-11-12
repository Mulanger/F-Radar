import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Next.js 16 proxy (formerly middleware). Clerk authenticates every request; all routes
 * except the ones below require a signed-in user. Organization checks happen server-side
 * in the dashboard layout and again in the Fastify API.
 */
const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/onboarding(.*)']);
const isDemoRoute = createRouteMatcher(['/demo(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isDemoRoute(req)) {
    // Fixture dashboard for design comparison – only when explicitly enabled.
    if (process.env.FASTIGHETSRADAR_DEMO_ENABLED !== 'true') return new NextResponse('Not found', { status: 404 });
    return;
  }
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
