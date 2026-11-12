import { z } from 'zod';

/**
 * Server-side environment schema (IMPLEMENTATION.md §6).
 *
 * Rules:
 *  - Missing OPTIONAL API keys never fail startup; the affected source becomes
 *    `disabled` / `pending_access` instead.
 *  - Secrets are only read server-side. Nothing in here may be exposed through
 *    a NEXT_PUBLIC_* variable.
 *  - SMS defaults to disabled + dry-run.
 */

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1' || v === 'yes'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
  .pipe(z.string().url().optional());

const intWithDefault = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().nonnegative());

export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: intWithDefault(4000),
  TZ: z.string().default('Europe/Stockholm'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: optionalString,
  REDIS_URL: optionalString,

  AUTH_SECRET: optionalString,
  AUTH_PROVIDER: optionalString,

  /** Clerk (auth provider, decision 2026-11-12). Secret key is server-only. */
  CLERK_SECRET_KEY: optionalString,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: optionalString,
  /** Optional PEM public key for networkless JWT verification (Clerk Dashboard → API keys). */
  CLERK_JWT_KEY: optionalString,
  /** Comma-separated origins allowed as the token `azp` (defaults to APP_URL). */
  CLERK_AUTHORIZED_PARTIES: optionalString,
  /** Internal URL the Next.js server uses to reach Fastify (never public). */
  FASTIGHETSRADAR_INTERNAL_API_URL: z.string().url().default('http://127.0.0.1:4000'),

  GEOCODING_PROVIDER: z.enum(['geoapify', 'manual']).default('geoapify'),
  GEOAPIFY_API_KEY: optionalString,
  GEOAPIFY_AUTOCOMPLETE_URL: z.string().url().default('https://api.geoapify.com/v1/geocode/autocomplete'),
  GEOAPIFY_GEOCODING_URL: z.string().url().default('https://api.geoapify.com/v1/geocode/search'),
  GEOAPIFY_COUNTRY_FILTER: z.string().default('se'),
  GEOAPIFY_LANGUAGE: z.string().default('sv'),

  SMHI_FORECAST_BASE_URL: z.string().url().default('https://opendata-download-metfcst.smhi.se/api'),
  SMHI_WARNINGS_URL: z
    .string()
    .url()
    .default('https://opendata-download-warnings.smhi.se/ibww/api/version/1/warning.json'),
  SMHI_OBSERVATIONS_BASE_URL: z.string().url().default('https://opendata-download-metobs.smhi.se/api'),
  KRISINFORMATION_BASE_URL: z.string().url().default('https://api.krisinformation.se/v3'),
  AIR_QUALITY_BASE_URL: z.string().url().default('https://datavardluft.smhi.se/52North/api/'),
  SGU_OBSERVED_GROUNDWATER_BASE_URL: z
    .string()
    .url()
    .default('https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1'),
  SGU_REGIONAL_GROUNDWATER_BASE_URL: z
    .string()
    .url()
    .default('https://api.sgu.se/oppnadata/grundvattennivaer-sgu-hype-omraden/ogc/features/v1'),
  SCB_PXWEB_V2_BASE_URL: z.string().url().default('https://statistikdatabasen.scb.se'),

  MCF_FLOOD_ENABLED: bool(false),
  MCF_GIS_DATASET_MANIFEST: optionalString,

  TRAFIKVERKET_ENABLED: bool(false),
  TRAFIKVERKET_API_KEY: optionalString,
  LANTMATERIET_ENABLED: bool(false),
  LANTMATERIET_AUTH_METHOD: optionalString,
  LANTMATERIET_CLIENT_ID: optionalString,
  LANTMATERIET_CLIENT_SECRET: optionalString,
  BOVERKET_ENABLED: bool(false),
  BOVERKET_API_KEY: optionalString,

  SMS_ENABLED: bool(false),
  SMS_DRY_RUN: bool(true),
  SMS_TEST_ALLOWLIST: optionalString,
  SMS_SENDER: z.string().default('FastRadar'),
  ELKS_API_USERNAME: optionalString,
  ELKS_API_PASSWORD: optionalString,
  SMS_DAILY_LIMIT_PER_ORG: intWithDefault(20),
  SMS_MONTHLY_LIMIT_PER_ORG: intWithDefault(100),
  SMS_GLOBAL_DAILY_BUDGET_SEK: intWithDefault(100),
  /** Explicit owner approval flag required in addition to SMS_ENABLED + SMS_DRY_RUN=false. */
  SMS_LIVE_SENDING_APPROVED: bool(false),

  SOURCE_SMHI_FORECAST_ENABLED: bool(true),
  SOURCE_SMHI_WARNINGS_ENABLED: bool(true),
  SOURCE_SMHI_OBSERVATIONS_ENABLED: bool(true),
  SOURCE_KRISINFORMATION_ENABLED: bool(true),
  SOURCE_AIR_QUALITY_ENABLED: bool(true),
  SOURCE_SGU_ENABLED: bool(true),
  SOURCE_SCB_ENABLED: bool(true),

  MAP_STYLE_URL: optionalUrl,
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super(`Invalid environment configuration: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Clerk key selection. A complete DEVELOPMENT pair (NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY=pk_test_…,
 * CLERK_SECRET=sk_test_…) takes precedence over the standard (production) names. Production keys
 * only work on their configured domain; development keys work on localhost and the pod URL.
 */
export function selectClerkKeys(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const devPk = source.NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY?.trim();
  const devSk = source.CLERK_SECRET?.trim();
  if (devPk?.startsWith('pk_test_') && devSk?.startsWith('sk_test_')) {
    return { ...source, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: devPk, CLERK_SECRET_KEY: devSk };
  }
  return source;
}

/** Parse and validate environment variables. Throws EnvValidationError with all issues. */
export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const result = ServerEnvSchema.safeParse(selectClerkKeys(source));
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** Names of env vars that hold secrets – used for log redaction. */
export const SECRET_ENV_KEYS = [
  'AUTH_SECRET',
  'CLERK_SECRET_KEY',
  'CLERK_JWT_KEY',
  'GEOAPIFY_API_KEY',
  'TRAFIKVERKET_API_KEY',
  'LANTMATERIET_CLIENT_SECRET',
  'BOVERKET_API_KEY',
  'ELKS_API_USERNAME',
  'ELKS_API_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL',
] as const satisfies ReadonlyArray<keyof ServerEnv>;

/** Origins accepted as Clerk `azp`. */
export function clerkAuthorizedParties(env: ServerEnv): string[] {
  const list = (env.CLERK_AUTHORIZED_PARTIES ?? env.APP_URL)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...new Set(list)];
}

/** Clerk instance type derived from the key prefix (never logs the key). */
export function clerkInstanceType(env: ServerEnv): 'development' | 'production' | 'missing' {
  const k = env.CLERK_SECRET_KEY ?? '';
  return k.startsWith('sk_test_') ? 'development' : k.startsWith('sk_live_') ? 'production' : 'missing';
}

export type SmsMode = 'disabled' | 'dry_run' | 'live';

/**
 * Resolves the effective SMS mode. Live sending requires ALL of:
 * SMS_ENABLED=true, SMS_DRY_RUN=false, SMS_LIVE_SENDING_APPROVED=true, credentials present
 * and NODE_ENV=production. Anything else degrades to dry-run or disabled.
 */
export function resolveSmsMode(env: ServerEnv): SmsMode {
  if (!env.SMS_ENABLED) return 'disabled';
  const liveAllowed =
    !env.SMS_DRY_RUN &&
    env.SMS_LIVE_SENDING_APPROVED &&
    env.NODE_ENV === 'production' &&
    !!env.ELKS_API_USERNAME &&
    !!env.ELKS_API_PASSWORD;
  return liveAllowed ? 'live' : 'dry_run';
}
