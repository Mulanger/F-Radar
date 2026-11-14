#!/usr/bin/env node
/** Full f-radar release: preserve live configuration, migrate, swap, verify and roll back on failure. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { ALLOWED_POD, api } from './instapods.mjs';
import { assertDeploymentBranch, deploymentEnvironment } from './deploy-policy.mjs';

const root = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const git = (...argv) => execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, ...argv], { cwd: root }).toString().trim();
const runNode = (argv, cwd = root) => execFileSync(process.execPath, argv, { cwd, stdio: 'inherit', env: process.env });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).flatMap((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\r\n]*)["']?\s*$/.exec(line);
    return m ? [[m[1], m[2].trim()]] : [];
  }));
}
async function exec(command) {
  const r = await api('POST', `/pods/${ALLOWED_POD}/exec`, { command: ['sh', '-c', command], workdir: '/home/instapod' });
  if (r.status !== 200 || r.data?.exit_code) throw new Error(`Pod command failed (${r.status}, exit ${r.data?.exit_code}): ${String(r.data?.output ?? '').slice(-1200)}`);
  return String(r.data?.output ?? '');
}
function removeLocal(target) {
  const absolute = resolve(target);
  if (!absolute.startsWith(root + sep) || absolute === root) throw new Error('Refusing removal outside this checkout.');
  rmSync(absolute, { recursive: true, force: true });
}
function removeTracedEnv(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) removeTracedEnv(path);
    else if (entry.name === '.env' || entry.name.startsWith('.env.')) removeLocal(path);
  }
}
async function waitHealthy(previousPid) {
  for (let i = 0; i < 70; i++) {
    await pause(2000);
    try {
      const output = await exec('systemctl is-active app; systemctl show app --property=MainPID --value; curl -fsS -m 3 http://127.0.0.1:4000/health/ready; printf "\\n"; curl -s -o /dev/null -w "web:%{http_code}" -m 5 http://127.0.0.1:3000/sign-in');
      const lines = output.trim().split(/\r?\n/);
      if (lines[0] === 'active' && lines[1] !== '0' && lines[1] !== previousPid
          && /"status":"ready"/.test(output) && /web:200/.test(output)) {
        console.log(output.trim());
        return true;
      }
    } catch { /* systemd may still be stopping the preceding release */ }
    if (i % 10 === 9) console.log(`Waiting for app restart (${(i + 1) * 2}s minimum elapsed).`);
  }
  return false;
}

const local = readEnv();
if (local.INSTAPOD_TOKEN) process.env.INSTAPOD_TOKEN ??= local.INSTAPOD_TOKEN;
assertDeploymentBranch(git('branch', '--show-current'));
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Commit tracked changes before deployment.');
const podResponse = await api('GET', `/pods/${ALLOWED_POD}`);
const pod = podResponse.data;
if (podResponse.status !== 200 || pod.name !== ALLOWED_POD || pod.plan_slug !== 'build') throw new Error('Unexpected pod state.');
const appUrl = `https://${pod.domain}`;
const envResponse = await api('GET', `/pods/${ALLOWED_POD}/env`, undefined, { raw: true });
if (envResponse.status !== 200) throw new Error('Cannot snapshot the running environment.');
const beforeEnv = envResponse.data.vars;
const vars = deploymentEnvironment(beforeEnv, local);
if (beforeEnv.APP_URL !== appUrl) throw new Error('Running APP_URL differs from the pod domain.');
const pk = beforeEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const sk = beforeEnv.CLERK_SECRET_KEY;
if (!pk?.startsWith('pk_') || !sk?.startsWith('sk_')) throw new Error('Cannot preserve running Clerk credentials.');
if ((local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== pk)
    || local.NEXT_PUBLIC_CLERK_DEVELOPMENT_KEY || local.CLERK_SECRET) {
  throw new Error('Build-time Clerk configuration must match the running pod; remove development-pair overrides from this checkout.');
}
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = pk;
process.env.CLERK_SECRET_KEY = sk;
const mapKey = local.NEXT_PUBLIC_GEOAPIFY_MAP_KEY ?? '';
if (mapKey && mapKey === local.GEOAPIFY_API_KEY) throw new Error('Browser map key must differ from the server key.');
const beforeRelease = (await exec('cat /home/instapod/app/RELEASE')).trim();
const previousCommit = beforeRelease.split(/\r?\n/)[1];
if (!/^[a-f0-9]{7,40}$/.test(previousCommit ?? '')) throw new Error('Running release has no commit id.');
git('merge-base', '--is-ancestor', previousCommit, 'HEAD');
const previousPid = (await exec('systemctl show app --property=MainPID --value')).trim();
const stamp = new Date().toISOString().replace(/[^0-9TZ]/g, '');
const commit = git('rev-parse', '--short', 'HEAD');
const backupEnv = `/home/instapod/.f-radar-env-${stamp}`;
mkdirSync(join(root, '.ci'), { recursive: true });
writeFileSync(join(root, '.ci', `pod-env-before-${stamp}.json`), JSON.stringify(beforeEnv));
console.log(`Preparing ${commit} over ${previousCommit}; Clerk and SMS policy preserved.`);
console.log('Runtime keys changed:', Object.keys(vars).filter((k) => vars[k] !== beforeEnv[k]).join(', ') || '(none)');

if (!args.has('--env-only')) {
  if (!args.has('--skip-build')) {
    runNode(['node_modules/tsup/dist/cli-default.js', '--config', 'tsup.deploy.config.ts']);
    runNode(['../../node_modules/next/dist/bin/next', 'build'], join(root, 'apps/web'));
  }
  const deploy = join(root, '.deploy');
  const rel = join(deploy, 'release');
  removeLocal(deploy);
  mkdirSync(rel, { recursive: true });
  cpSync(join(root, 'deploy/pod/index.js'), join(rel, 'index.js'));
  cpSync(join(root, 'dist-deploy/api'), join(rel, 'api'), { recursive: true });
  cpSync(join(root, 'dist-deploy/db'), join(rel, 'db'), { recursive: true });
  cpSync(join(root, 'packages/db/migrations'), join(rel, 'db/migrations'), { recursive: true });
  cpSync(join(root, 'apps/web/.next/standalone'), join(rel, 'web'), { recursive: true });
  cpSync(join(root, 'apps/web/.next/static'), join(rel, 'web/apps/web/.next/static'), { recursive: true });
  if (existsSync(join(root, 'apps/web/public'))) cpSync(join(root, 'apps/web/public'), join(rel, 'web/apps/web/public'), { recursive: true });
  removeTracedEnv(join(rel, 'web'));
  writeFileSync(join(rel, 'RELEASE'), `${new Date().toISOString()}\n${commit}\n`);
  runNode(['scripts/check-no-secrets.mjs', '.deploy/release']);
  execFileSync('tar', ['-czf', join(deploy, 'release.tar.gz'), '-C', rel, '.'], { cwd: root, stdio: 'inherit' });
}

// No remote changes until the build and secret scan have succeeded.
if ((await exec('cat /home/instapod/app/RELEASE')).trim() !== beforeRelease) throw new Error('The running release changed during preparation.');
const latestEnv = await api('GET', `/pods/${ALLOWED_POD}/env`, undefined, { raw: true });
if (latestEnv.status !== 200 || Object.keys({ ...beforeEnv, ...latestEnv.data.vars }).some((k) => beforeEnv[k] !== latestEnv.data.vars[k])) {
  throw new Error('The running environment changed during preparation.');
}
await exec(`sudo cp -p /etc/instapods/app.env ${backupEnv}`);
let swapped = false;
let envAttempted = false;
try {
  if (!args.has('--env-only')) {
    await exec('test ! -L /home/instapod/app-next && rm -rf /home/instapod/app-next && mkdir -p /home/instapod/app-next');
    const form = new FormData();
    form.set('archive', new Blob([readFileSync(join(root, '.deploy/release.tar.gz'))], { type: 'application/gzip' }), 'release.tar.gz');
    form.set('path', '/home/instapod/app-next');
    const upload = await api('POST', `/pods/${ALLOWED_POD}/files/upload-archive`, form);
    if (upload.status !== 200) throw new Error(`Upload failed (${upload.status}).`);
    console.log(await exec('cd /home/instapod/app-next && DATABASE_URL="postgresql:///fastighetsradar?host=/var/run/postgresql" FASTIGHETSRADAR_MIGRATIONS_DIR=/home/instapod/app-next/db/migrations node db/migrate.mjs up'));
    await exec(`cd /home/instapod && test -d app && test -d app-next && test ! -L app && test ! -L app.prev && test ! -L app-next && if [ -e app.prev ]; then mv app.prev app.prev-${stamp}; fi && mv app app.prev && if mv app-next app; then true; else mv app.prev app; exit 1; fi`);
    swapped = true;
  }
  envAttempted = true;
  const update = await api('PUT', `/pods/${ALLOWED_POD}/env`, { vars });
  if (update.status !== 200) throw new Error(`Environment update failed (${update.status}).`);
  await exec('sudo systemctl restart --no-block app');
  if (!await waitHealthy(previousPid)) throw new Error('New release health check failed.');
} catch (error) {
  if (swapped || envAttempted) {
    console.error('Deployment failed; restoring the previous application and exact environment.');
    await exec(`sudo cp -p ${backupEnv} /etc/instapods/app.env`);
    if (swapped) await exec(`cd /home/instapod && test -d app.prev && test ! -L app && test ! -L app.prev && mv app app.failed-${stamp} && mv app.prev app`);
    const rollbackPid = (await exec('systemctl show app --property=MainPID --value')).trim();
    await exec('sudo systemctl restart --no-block app');
    if (!await waitHealthy(rollbackPid)) throw new Error('Rollback health check failed; manual recovery is required.', { cause: error });
    console.error(`Rollback healthy: restored ${previousCommit}. Migration 0008 is additive and is retained.`);
  }
  throw error;
}
console.log(`Deployed ${commit} to ${appUrl}; previous application retained as app.prev.`);
writeFileSync(join(root, '.ci', `deploy-result-${commit}.json`), JSON.stringify({
  commit, previousCommit, appUrl, checkedAt: new Date().toISOString(), ready: true,
  changedEnvironmentKeys: Object.keys(vars).filter((key) => vars[key] !== beforeEnv[key]),
  rollbackApplication: '/home/instapod/app.prev',
}, null, 2));
