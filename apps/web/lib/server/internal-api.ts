import 'server-only';
import { auth } from '@clerk/nextjs/server';

/**
 * Server-side client for the internal Fastify API.
 *
 * The Fastify process listens on 127.0.0.1 only. Next.js forwards the caller's Clerk
 * session token (minted for the signed-in browser session); Fastify verifies it
 * independently, so a bug in Next.js cannot grant access to another organization.
 */
export const INTERNAL_API_URL = (process.env.FASTIGHETSRADAR_INTERNAL_API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');

export class InternalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Internal API responded ${status}`);
    this.name = 'InternalApiError';
  }
}

export async function sessionToken(): Promise<string | null> {
  const a = await auth();
  if (!a.userId) return null;
  return a.getToken();
}

export async function internalApi(path: string, init: RequestInit & { token?: string | null } = {}): Promise<Response> {
  const token = init.token === undefined ? await sessionToken() : init.token;
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  const timeout = AbortSignal.timeout(path.split('?')[0] === '/v1/stream' ? 10 * 60_000 : 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(`${INTERNAL_API_URL}${path}`, { ...init, signal, headers, cache: 'no-store', redirect: 'error' });
}

export async function internalApiJson<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const res = await internalApi(path, init);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new InternalApiError(res.status, body);
  return body as T;
}
