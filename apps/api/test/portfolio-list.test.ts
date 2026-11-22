import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadServerEnv } from '@fastighetsradar/config';
import { PortfolioSchema } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { Queryable } from '@fastighetsradar/db';
import { buildApp } from '../src/app';
import type { AuthVerifier } from '../src/auth';
import type { MonitoringService } from '../src/monitoring/service';

/** Fas 3 / S-10: `/v1/portfolio` is the LIST – the property page loads `/v1/properties/:id/snapshot`. */
describe('GET /v1/portfolio returns the portfolio list', () => {
  const ORG_UUID = '00000000-0000-4000-8000-00000000000a';
  const db: Queryable = { async query<R>(sql: string) { return { rows: (sql.includes('INSERT INTO organizations') ? [{ id: ORG_UUID }] : []) as R[] }; } };
  const verify: AuthVerifier = async () => ({ userId: 'user_a', sessionId: 's', clerkOrgId: 'org_testAAAAAAAA', orgRole: 'org:admin', orgSlug: 'a' });
  const full = demoPortfolio;
  const monitoring = { portfolio: async () => full } as unknown as MonitoringService;
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, db, verifyAuth: verify, monitoring });
  });
  afterAll(() => app.close());

  it('leaves out forecast series, measured rain and the less common metrics, keeping a valid portfolio', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/portfolio', headers: { authorization: 'Bearer x' } });
    expect(r.statusCode).toBe(200);
    const list = PortfolioSchema.parse(r.json());
    expect(list.properties).toHaveLength(full.properties.length);
    expect(full.properties.some((s) => s.forecast?.series.length)).toBe(true);
    expect(list.properties.every((s) => !s.forecast || (s.forecast.series.length === 0 && !s.forecast.days?.length))).toBe(true);
    expect(list.properties.every((s) => !s.measuredRain)).toBe(true);
    expect(r.rawPayload.length).toBeLessThan(JSON.stringify(full).length * 0.75);
  });
});
