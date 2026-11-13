import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Single source of local configuration: the repository-root .env (never committed, never
// deployed). Already-set variables win (e.g. the pod's systemd EnvironmentFile).
const rootEnv = path.join(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Clerk instance selection: when a DEVELOPMENT key pair is present (NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY +
// CLERK_SECRET), it takes precedence over the production pair for this phase. Mirrors
// `selectClerkKeys` in packages/config. Values are never logged.
{
  const devPk = process.env.NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY;
  const devSk = process.env.CLERK_SECRET;
  if (devPk?.startsWith('pk_test_') && devSk?.startsWith('sk_test_')) {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = devPk;
    process.env.CLERK_SECRET_KEY = devSk;
  }
}

// Map tiles: the browser must use a SEPARATE, origin-restricted Geoapify key. Refuse to build if
// someone points NEXT_PUBLIC_GEOAPIFY_MAP_KEY at the unrestricted server geocoding key.
if (process.env.NEXT_PUBLIC_GEOAPIFY_MAP_KEY && process.env.NEXT_PUBLIC_GEOAPIFY_MAP_KEY === process.env.GEOAPIFY_API_KEY) {
  throw new Error('NEXT_PUBLIC_GEOAPIFY_MAP_KEY must not equal GEOAPIFY_API_KEY – create a separate origin-restricted browser key.');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Internal workspace packages ship TypeScript source.
  transpilePackages: ['@fastighetsradar/domain', '@fastighetsradar/config'],
  poweredByHeader: false,
  devIndicators: false,
  // Self-contained server bundle for the f-radar pod (`node apps/web/server.js`).
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
