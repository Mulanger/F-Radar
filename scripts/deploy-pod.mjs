#!/usr/bin/env node
/**
 * Deterministic deployment to the InstaPods `f-radar` pod (and ONLY that pod).
 *
 *   node scripts/deploy-pod.mjs [--skip-build] [--env-only]
 *
 * Steps:
 *  1. Build: tsup deploy bundles (API, migrate CLI) + Next.js standalone (web).
 *  2. Assemble .deploy/release: index.js supervisor, api/, db/, web/ (no .env, no .git,
 *     no node_modules except Next's traced runtime deps, no fixtures as customer data).
 *  3. Secret scan of the release (fails on any .env secret value).
 *  4. Upload to /home/instapod/app-next, run migrations, swap app ↔ app-next (previous
 *     release kept as app.prev for rollback), set ONLY the required runtime env vars,
 *     restart the `app` service and health-check.
 *
 * The token is read from INSTAPOD_TOKEN; secret values are never printed.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ALLOWED_POD, api } from './instapods.mjs';

const root = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

function readEnv() {
  const env = {};
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\r\n]*)["']?\s*$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function exec(command) {
  const r = await api('POST', `/pods/${ALLOWED_POD}/exec`, { command: ['sh', '-c', command], workdir: '/home/instapod' });
  const out = String(r.data?.output ?? '');
  if (r.status !== 200 || r.data?.exit_code) throw new Error(`exec failed (${r.status}, exit ${r.data?.exit_code}): ${out.slice(-1500)}`);
  return out;
}

const local = readEnv();
const pod = (await api('GET', `/pods/${ALLOWED_POD}`)).data;
if (pod.name !== ALLOWED_POD || pod.plan_slug !== 'build') throw new Error(`Unexpected pod state: ${pod.name}/${pod.plan_slug}`);
const appUrl = `https://${pod.domain}`;

// Development pair (NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY + CLERK_SECRET) wins when complete – see selectClerkKeys().
const devPair = local.NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY?.startsWith('pk_test_') && local.CLERK_SECRET?.startsWith('sk_test_');
const pk = (devPair ? local.NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY : local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) ?? '';
const sk = (devPair ? local.CLERK_SECRET : local.CLERK_SECRET_KEY) ?? '';
console.log('Clerk instance for this deployment:', pk.startsWith('pk_test_') ? 'development' : 'production');
if (!pk || !sk) throw new Error('Clerk keys missing in .env');
if ((pk.startsWith('pk_live_') || sk.startsWith('sk_live_')) && !args.has('--allow-live-clerk')) {
  throw new Error('Production Clerk keys only work on their configured domain, not on ' + appUrl + '. Use development keys or pass --allow-live-clerk.');
}

// Map tiles (build-time, public): a separate origin-restricted Geoapify browser key.
const mapKey = local.NEXT_PUBLIC_GEOAPIFY_MAP_KEY ?? '';
if (mapKey && mapKey === local.GEOAPIFY_API_KEY) throw new Error('NEXT_PUBLIC_GEOAPIFY_MAP_KEY must not reuse the server GEOAPIFY_API_KEY');
console.log('Map tiles for this deployment:', mapKey ? `geoapify (${local.NEXT_PUBLIC_MAP_STYLE || 'positron'})` : 'NOT CONFIGURED – maps render without tiles');

/* 1–3: build, assemble, scan */
if (!args.has('--env-only')) {
  if (!args.has('--skip-build')) {
    sh('node node_modules/tsup/dist/cli-default.js --config tsup.deploy.config.ts');
    sh('npm run build -w @fastighetsradar/web');
  }
  const rel = join(root, '.deploy', 'release');
  rmSync(join(root, '.deploy'), { recursive: true, force: true });
  mkdirSync(rel, { recursive: true });
  cpSync(join(root, 'deploy/pod/index.js'), join(rel, 'index.js'));
  cpSync(join(root, 'dist-deploy/api'), join(rel, 'api'), { recursive: true });
  cpSync(join(root, 'dist-deploy/db'), join(rel, 'db'), { recursive: true });
  cpSync(join(root, 'packages/db/migrations'), join(rel, 'db/migrations'), { recursive: true });
  cpSync(join(root, 'apps/web/.next/standalone'), join(rel, 'web'), { recursive: true });
  cpSync(join(root, 'apps/web/.next/static'), join(rel, 'web/apps/web/.next/static'), { recursive: true });
  // Never ship env files that Next may have traced.
  for (const f of ['.env', 'apps/web/.env', '.env.local']) rmSync(join(rel, 'web', f), { force: true });
  writeFileSync(join(rel, 'RELEASE'), `${new Date().toISOString()}\n${execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()}\n`);
  sh(`node scripts/check-no-secrets.mjs .deploy/release`);
  sh(`tar -czf .deploy/release.tar.gz -C .deploy/release .`);

  /* 4: upload + migrate + swap */
  await exec('rm -rf /home/instapod/app-next && mkdir -p /home/instapod/app-next');
  const form = new FormData();
  form.set('archive', new Blob([readFileSync(join(root, '.deploy/release.tar.gz'))], { type: 'application/gzip' }), 'release.tar.gz');
  form.set('path', '/home/instapod/app-next');
  const up = await api('POST', `/pods/${ALLOWED_POD}/files/upload-archive`, form);
  if (up.status !== 200) throw new Error(`upload failed: ${JSON.stringify(up.data)}`);
  console.log(await exec('cd /home/instapod/app-next && DATABASE_URL="postgresql:///fastighetsradar?host=/var/run/postgresql" FASTIGHETSRADAR_MIGRATIONS_DIR=/home/instapod/app-next/db/migrations node db/migrate.mjs up'));
  await exec('cd /home/instapod && rm -rf app.prev && mv app app.prev && mv app-next app');
}

/* Runtime env: only what the processes need. DATABASE_URL uses the local socket + peer auth (no password). */
const vars = {
  APP_URL: appUrl,
  CLERK_AUTHORIZED_PARTIES: appUrl,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk,
  CLERK_SECRET_KEY: sk,
  GEOCODING_PROVIDER: 'geoapify',
  GEOAPIFY_API_KEY: local.GEOAPIFY_API_KEY ?? '',
  TRAFIKVERKET_API_KEY: local.TRAFIKVERKET_API_KEY ?? '',
  TRAFIKVERKET_ENABLED: 'false',
  DATABASE_URL: 'postgresql:///fastighetsradar?host=/var/run/postgresql',
  FASTIGHETSRADAR_INTERNAL_API_URL: 'http://127.0.0.1:4000',
  FASTIGHETSRADAR_DEMO_ENABLED: 'false',
  SMS_ENABLED: 'false',
  SMS_DRY_RUN: 'true',
  LOG_LEVEL: 'info',
  TZ: 'Europe/Stockholm',
};
const envRes = await api('PUT', `/pods/${ALLOWED_POD}/env`, { vars });
if (envRes.status !== 200) throw new Error(`env update failed: ${JSON.stringify(envRes.data)}`);
console.log('Env keys set:', Object.keys(vars).join(', '));
if (envRes.data?.warnings?.length) console.log('Env warnings:', envRes.data.warnings);

await exec('sudo systemctl restart app');
let ok = false;
for (let i = 0; i < 30 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const out = await exec('curl -fsS -m 3 http://127.0.0.1:4000/health/ready && echo && curl -s -o /dev/null -w "web:%{http_code}" -m 5 http://127.0.0.1:3000/sign-in');
    console.log(out);
    ok = /"status":"ready"/.test(out) && /web:200/.test(out);
  } catch {
    /* not up yet */
  }
}
if (!ok) {
  console.error((await api('GET', `/pods/${ALLOWED_POD}/logs?lines=80&service=app`)).data?.logs);
  throw new Error('Health check failed – previous release is in /home/instapod/app.prev');
}
console.log(`Deployed to ${appUrl}`);
