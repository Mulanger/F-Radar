import { describe, expect, it } from 'vitest';
import { portfolioTelemetry } from '../src/routes/customer';

describe('portfolio telemetry (skalning Fas 0)', () => {
  it('logs only counts, size, time and heap – never portfolio content', () => {
    const body = JSON.stringify({ properties: [{ name: 'Hamnvägen 1', address: 'Hamnvägen 1, Stockholm' }] });
    const t = portfolioTelemetry(1, body, 100, 342.6);
    expect(Object.keys(t.portfolio).sort()).toEqual(['bytes', 'durationMs', 'heapUsedMb', 'properties']);
    expect(t.portfolio).toMatchObject({ properties: 1, bytes: Buffer.byteLength(body), durationMs: 243 });
    expect(t.portfolio.heapUsedMb).toBeGreaterThan(0);
    expect(JSON.stringify(t)).not.toMatch(/Hamnvägen|Stockholm/);
  });

  it('counts bytes, not characters (å, ä, ö)', () => {
    expect(portfolioTelemetry(0, 'åäö', 0, 0).portfolio.bytes).toBe(6);
  });
});
