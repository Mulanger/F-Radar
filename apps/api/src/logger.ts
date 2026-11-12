import type { FastifyServerOptions } from 'fastify';
import type { ServerEnv } from '@fastighetsradar/config';

/**
 * Structured JSON logging (pino via Fastify) with redaction of secrets and
 * personal data (IMPLEMENTATION.md §16.1).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.apiKey',
  '*.api_key',
  '*.token',
  '*.phone',
  '*.phoneE164',
  '*.email',
];

export function loggerOptions(env: ServerEnv): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'fastighetsradar-api' },
    serializers: {
      // Never log query strings: they can contain API keys or addresses.
      req: (req: { method: string; url: string; id: string }) => ({
        method: req.method,
        url: req.url.split('?')[0],
        id: req.id,
      }),
    },
  };
}
