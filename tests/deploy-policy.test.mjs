import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertDeploymentBranch, deploymentEnvironment } from '../scripts/deploy-policy.mjs';

const current = {
  APP_URL: 'https://example.org', CLERK_AUTHORIZED_PARTIES: 'https://example.org',
  CLERK_SECRET_KEY: 'existing-secret', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'existing-public-key',
  DATABASE_URL: 'postgresql:///existing', SMS_ENABLED: 'false', SMS_PROVIDER: 'simulated',
  SMS_DRY_RUN: 'true', SMS_LIVE_SENDING_APPROVED: 'false', SMS_MONTHLY_LIMIT_PER_ORG: '0',
  SOURCE_SMHI_OCEANOGRAPHY_ENABLED: 'true', SOURCE_SMHI_HYDROLOGY_ENABLED: 'true',
  TRAFIKVERKET_ENABLED: 'true', TRAFIKVERKET_API_KEY: 'existing-traffic-key',
};

describe('pod deployment policy', () => {
  it('allows the verified merge release branch and the existing deployment paths', () => {
    for (const branch of ['codex/landing-parity-live', 'codex/phase4-sms-notifications', '']) assertDeploymentBranch(branch);
  });
  it('rejects main and unrelated branches', () => {
    for (const branch of ['main', 'codex/landing-data-parity', 'codex/other']) {
      assert.throws(() => assertDeploymentBranch(branch));
    }
  });
  it('keeps live authentication, secrets, budgets and enabled sources despite different local settings', () => {
    const vars = deploymentEnvironment(current, { ...current, CLERK_SECRET_KEY: 'local-secret',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'local-key', SOURCE_SMHI_OCEANOGRAPHY_ENABLED: 'false',
      SOURCE_SMHI_HYDROLOGY_ENABLED: 'false', TRAFIKVERKET_ENABLED: 'false',
      SMS_PROVIDER: '46elks', SMS_MONTHLY_LIMIT_PER_ORG: '100' });
    assert.deepEqual(vars, { ...current, SOURCE_SL_DEVIATIONS_ENABLED: 'false' });
  });
  it('changes only the selected new sources and keeps SL off', () => {
    const overrides = { MET_NORWAY_CONTACT: 'https://github.com/Mulanger/F-Radar/issues',
      SOURCE_MET_NOWCAST_ENABLED: 'true', SOURCE_SGU_OBSERVED_ENABLED: 'true' };
    const vars = deploymentEnvironment(current, { ...overrides, SOURCE_SL_DEVIATIONS_ENABLED: 'true' });
    assert.deepEqual(vars, { ...current, ...overrides, SOURCE_SL_DEVIATIONS_ENABLED: 'false' });
  });
  it('retains unrecognised runtime options and leaves its inputs untouched', () => {
    const before = { ...current, FUTURE_SOURCE_ENABLED: 'true' };
    const copy = structuredClone(before);
    assert.equal(deploymentEnvironment(before, {}).FUTURE_SOURCE_ENABLED, 'true');
    assert.deepEqual(before, copy);
  });
  it('rejects incomplete or non-string runtime configuration', () => {
    for (const env of [null, [], { ...current, CLERK_SECRET_KEY: '' }, { ...current, DATABASE_URL: null }]) {
      assert.throws(() => deploymentEnvironment(env, {}));
    }
  });
  it('refuses an unexpected live SMS policy', () => {
    for (const changes of [{ SMS_ENABLED: 'true' }, { SMS_PROVIDER: '46elks' },
      { SMS_DRY_RUN: 'false' }, { SMS_LIVE_SENDING_APPROVED: 'true' }]) {
      assert.throws(() => deploymentEnvironment({ ...current, ...changes }, {}));
    }
  });
  it('requires an HTTP contact URL when enabling nowcast', () => {
    for (const contact of ['', 'mailto:test@example.org', 'not-a-url']) {
      assert.throws(() => deploymentEnvironment(current, { SOURCE_MET_NOWCAST_ENABLED: 'true', MET_NORWAY_CONTACT: contact }));
    }
  });
});
