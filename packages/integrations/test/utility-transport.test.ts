import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { operatorById, outageTlsOptions, withOperatorTransport, type AdapterContext } from '../src';

const context = (proxy?: string): AdapterContext => ({
  env: loadServerEnv({ UTILITY_OUTAGE_SE_PROXY_URL: proxy }), fetch: vi.fn(async () => new Response('ok')),
  logger: { debug() {}, info() {}, warn() {}, error() {} }, now: () => new Date('2026-11-19'),
});
describe('scoped outage proxy and TLS', () => {
  it('keeps ordinary fetching without a configured proxy and never proxies unmarked sources', () => {
    const c = context();
    expect(withOperatorTransport(operatorById('digpro:fev')!, c)).toBe(c);
    const p = context('https://proxy.example');
    expect(withOperatorTransport(operatorById('vattenfall')!, p)).toBe(p);
  });
  it('uses a dispatcher for the marked host; rejects redirects, arbitrary hosts, credentials and ports', async () => {
    const c = context('https://user:password@proxy.example:8443');
    const t = withOperatorTransport(operatorById('digpro:fev')!, c);
    await t.fetch('https://webmap.fev.se/bios/example');
    expect(c.fetch).toHaveBeenCalledWith('https://webmap.fev.se/bios/example', expect.objectContaining({ redirect: 'error', dispatcher: expect.anything() }));
    for (const url of ['https://example.org/', 'https://webmap.fev.se:444/', 'http://webmap.fev.se/', 'https://user@webmap.fev.se/']) await expect(t.fetch(url)).rejects.toThrow('Unapproved');
    expect(c.fetch).toHaveBeenCalledTimes(1);
  });
  it('adds only pinned intermediate CAs to the two target hosts and retains standard validation', async () => {
    for (const host of ['webmap.hedemoraenergi.se', 'webmap.lindeenergi.se']) {
      const tls = outageTlsOptions(host)!;
      expect(tls.rejectUnauthorized).toBe(true);
      expect(tls.ca.length).toBeGreaterThan(10);
    }
    expect(outageTlsOptions('example.org')).toBeUndefined();
    const c = context();
    await withOperatorTransport(operatorById('digpro:hed')!, c).fetch('https://webmap.hedemoraenergi.se/bios/example');
    expect(c.fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dispatcher: expect.anything(), redirect: 'error' }));
  });
  it('rejects insecure or path-based proxy URLs', () => {
    for (const proxy of ['http://proxy.example', 'https://proxy.example/forward', 'https://proxy.example/?url=']) expect(() => context(proxy)).toThrow();
  });
});
