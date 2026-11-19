import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { AdapterContext } from '../types';
import type { UtilityOperator } from './types';
import { OUTAGE_TLS_INTERMEDIATES } from './tls-intermediates';

const dispatchers = new Map<string, Dispatcher>();

/** Only the configured operator's upstream host can use its proxy/TLS exception. No redirects. */
export function operatorTransportHosts(op: UtilityOperator): string[] {
  if (op.platform === 'digpro') return [op.host];
  if (op.platform === 'trimble') return [new URL(op.base).hostname];
  return [];
}

export function outageTlsOptions(host: string) {
  const entry = OUTAGE_TLS_INTERMEDIATES[host as keyof typeof OUTAGE_TLS_INTERMEDIATES];
  if (!entry) return undefined;
  const certificate = new X509Certificate(entry.pem);
  if (certificate.fingerprint256 !== entry.sha256) throw new Error('Outage intermediate certificate pin mismatch');
  // Keep ordinary trust roots and hostname/expiry validation. Never trust the server's leaf cert.
  return { ca: [...rootCertificates, entry.pem], rejectUnauthorized: true as const };
}

export function withOperatorTransport(op: UtilityOperator, ctx: AdapterContext): AdapterContext {
  const hosts = operatorTransportHosts(op);
  const proxy = op.requiresSwedishEgress ? ctx.env.UTILITY_OUTAGE_SE_PROXY_URL : undefined;
  if (!proxy && !hosts.some((host) => outageTlsOptions(host))) return ctx;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || !hosts.includes(url.hostname)) {
      throw new Error('Unapproved outage transport destination');
    }
    const key = `${proxy ?? 'direct'}|${url.hostname}`;
    let dispatcher = dispatchers.get(key);
    if (!dispatcher) {
      const tls = outageTlsOptions(url.hostname);
      dispatcher = proxy
        ? new ProxyAgent({ uri: proxy, requestTls: tls, proxyTls: { rejectUnauthorized: true }, connections: 1 })
        : new Agent({ connect: tls, connections: 1 });
      dispatchers.set(key, dispatcher);
    }
    // The injected fetch is preserved, so fixture tests never open a socket. Node fetch accepts Dispatcher.
    return ctx.fetch(input, { ...init, redirect: 'error', dispatcher } as RequestInit & { dispatcher: Dispatcher });
  };
  return { ...ctx, fetch };
}
