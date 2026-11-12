import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadServerEnv, resolveDataMode, resolveSmsMode } from '../src';

describe('loadServerEnv', () => {
  it('starts with no optional keys configured', () => {
    const env = loadServerEnv({});
    expect(env.API_PORT).toBe(4000);
    expect(env.GEOAPIFY_API_KEY).toBeUndefined();
    expect(env.TRAFIKVERKET_ENABLED).toBe(false);
    expect(env.SMS_ENABLED).toBe(false);
    expect(env.SMS_DRY_RUN).toBe(true);
    expect(env.SOURCE_SMHI_FORECAST_ENABLED).toBe(true);
  });

  it('treats empty strings as unset', () => {
    const env = loadServerEnv({ GEOAPIFY_API_KEY: '  ', DATABASE_URL: '' });
    expect(env.GEOAPIFY_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('reports all invalid values at once', () => {
    try {
      loadServerEnv({ API_PORT: 'abc', LOG_LEVEL: 'loud' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      expect((e as EnvValidationError).issues.map((i) => i.path)).toEqual(expect.arrayContaining(['API_PORT', 'LOG_LEVEL']));
    }
  });
});

describe('resolveSmsMode', () => {
  const live = {
    SMS_ENABLED: 'true', SMS_DRY_RUN: 'false', SMS_LIVE_SENDING_APPROVED: 'true',
    NODE_ENV: 'production', ELKS_API_USERNAME: 'u', ELKS_API_PASSWORD: 'p',
  };
  it('is disabled by default', () => expect(resolveSmsMode(loadServerEnv({}))).toBe('disabled'));
  it('stays dry-run unless every live condition holds', () => {
    expect(resolveSmsMode(loadServerEnv({ SMS_ENABLED: 'true' }))).toBe('dry_run');
    expect(resolveSmsMode(loadServerEnv({ ...live, SMS_DRY_RUN: 'true' }))).toBe('dry_run');
    expect(resolveSmsMode(loadServerEnv({ ...live, SMS_LIVE_SENDING_APPROVED: 'false' }))).toBe('dry_run');
    expect(resolveSmsMode(loadServerEnv({ ...live, NODE_ENV: 'development' }))).toBe('dry_run');
    expect(resolveSmsMode(loadServerEnv({ ...live, ELKS_API_PASSWORD: '' }))).toBe('dry_run');
    expect(resolveSmsMode(loadServerEnv(live))).toBe('live');
  });
});

describe('resolveDataMode', () => {
  it('defaults to demo and only accepts explicit live', () => {
    expect(resolveDataMode(undefined)).toBe('demo');
    expect(resolveDataMode('LIVE')).toBe('demo');
    expect(resolveDataMode('live')).toBe('live');
  });
});
