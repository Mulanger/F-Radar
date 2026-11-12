import { createClerkClient } from '@clerk/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clerkAuthorizedParties, type ServerEnv } from '@fastighetsradar/config';
import { ensureOrganization, type Queryable } from '@fastighetsradar/db';
import { HttpProblem } from './errors';

/**
 * Server-side authentication for the customer API.
 *
 * Architecture (docs/decisions/0002-auth-and-tenancy.md):
 *   Browser ──(Clerk session cookie)──▶ Next.js (public) ──(Bearer <Clerk session JWT>)──▶ Fastify (127.0.0.1 only)
 *
 * Fastify does NOT trust Next.js: it verifies the Clerk session token itself (signature via
 * the instance JWKS or CLERK_JWT_KEY, expiry, and `azp` against CLERK_AUTHORIZED_PARTIES).
 * The active organization is read ONLY from the verified token claims; any organization id
 * in a URL, query or body is ignored.
 */

export interface VerifiedIdentity {
  userId: string;
  sessionId: string | null;
  clerkOrgId: string | null;
  orgRole: string | null;
  orgSlug: string | null;
}

export interface RequestAuth extends VerifiedIdentity {
  /** Internal organizations.id resolved from the verified Clerk organization. */
  organizationId: string | null;
}

export type AuthVerifier = (req: FastifyRequest) => Promise<VerifiedIdentity | null>;

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
}

/** Clerk-backed verifier. Only the Authorization header is forwarded to Clerk's verifier. */
export function createClerkVerifier(env: ServerEnv): AuthVerifier | null {
  if (!env.CLERK_SECRET_KEY || !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return null;
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    jwtKey: env.CLERK_JWT_KEY,
  });
  const authorizedParties = clerkAuthorizedParties(env);
  return async (req) => {
    const authorization = req.headers.authorization;
    if (!authorization || !/^Bearer\s+\S+$/.test(authorization)) return null;
    const request = new Request(`http://fastighetsradar.internal${req.url}`, {
      method: req.method === 'GET' || req.method === 'HEAD' ? req.method : 'GET',
      headers: { authorization },
    });
    const state = await clerk.authenticateRequest(request, { authorizedParties, acceptsToken: 'session_token' });
    if (!state.isAuthenticated) return null;
    const a = state.toAuth();
    if (!a.userId) return null;
    return {
      userId: a.userId,
      sessionId: a.sessionId ?? null,
      clerkOrgId: a.orgId ?? null,
      orgRole: a.orgRole ?? null,
      orgSlug: a.orgSlug ?? null,
    };
  };
}

export interface AuthPluginOptions {
  verify: AuthVerifier | null;
  db: Queryable | null;
}

export function registerAuth(app: FastifyInstance, opts: AuthPluginOptions) {
  app.decorateRequest('auth', null);

  /** preHandler: requires a verified user; with `org: true` also a verified active organization. */
  const guard =
    ({ org }: { org: boolean }) =>
    async (req: FastifyRequest, _reply: FastifyReply) => {
      if (!opts.verify) throw new HttpProblem(503, 'Authentication unavailable', 'Clerk is not configured on the server');
      let identity: VerifiedIdentity | null = null;
      try {
        identity = await opts.verify(req);
      } catch (err) {
        req.log.warn({ err: err instanceof Error ? err.message : 'verify failed' }, 'token verification failed');
      }
      if (!identity) throw new HttpProblem(401, 'Unauthorized', 'A valid Clerk session token is required');
      req.auth = { ...identity, organizationId: null };
      if (!org) return;
      if (!identity.clerkOrgId) {
        throw new HttpProblem(403, 'Organization required', 'Select or create an organization first', 'urn:fastighetsradar:organization-required');
      }
      if (!opts.db) throw new HttpProblem(503, 'Database unavailable');
      req.auth.organizationId = await ensureOrganization(opts.db, identity.clerkOrgId, identity.orgSlug);
    };

  return { requireUser: guard({ org: false }), requireOrg: guard({ org: true }) };
}

/** Narrowing helper for handlers behind `requireOrg`. */
export function orgContext(req: FastifyRequest) {
  const a = req.auth;
  if (!a?.organizationId) throw new HttpProblem(403, 'Organization required');
  return { organizationId: a.organizationId, userId: a.userId, clerkOrgId: a.clerkOrgId!, orgSlug: a.orgSlug };
}
