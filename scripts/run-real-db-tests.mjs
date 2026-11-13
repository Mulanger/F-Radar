#!/usr/bin/env node
/**
 * Runs the real-PostgreSQL/PostGIS integration suite INSIDE the f-radar pod against the dedicated
 * `fastighetsradar_test` database (never the application database). Requires INSTAPOD_TOKEN.
 *
 *   node node_modules/tsup/dist/cli-default.js --config tsup.deploy.config.ts
 *   node scripts/run-real-db-tests.mjs
 *
 * Uploads dist-deploy/tests/real-db.test.mjs + migrations to /home/instapod/fr-ci and runs node --test there.
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ALLOWED_POD, api } from './instapods.mjs';

const root = resolve(import.meta.dirname, '..');
const ci = join(root, '.ci');
rmSync(ci, { recursive: true, force: true });
mkdirSync(join(ci, 'migrations'), { recursive: true });
cpSync(join(root, 'dist-deploy/tests/real-db.test.mjs'), join(ci, 'real-db.test.mjs'));
cpSync(join(root, 'packages/db/migrations'), join(ci, 'migrations'), { recursive: true });
execSync(`tar -czf .ci.tar.gz -C .ci .`, { cwd: root });

async function exec(command) {
  const r = await api('POST', `/pods/${ALLOWED_POD}/exec`, { command: ['sh', '-c', command], workdir: '/home/instapod' });
  return { code: r.data?.exit_code, out: String(r.data?.output ?? '') };
}

await exec('rm -rf /home/instapod/fr-ci && mkdir -p /home/instapod/fr-ci');
const form = new FormData();
form.set('archive', new Blob([readFileSync(join(root, '.ci.tar.gz'))], { type: 'application/gzip' }), 'ci.tar.gz');
form.set('path', '/home/instapod/fr-ci');
const up = await api('POST', `/pods/${ALLOWED_POD}/files/upload-archive`, form);
if (up.status !== 200) throw new Error(`upload failed: ${up.status}`);
const r = await exec(
  'cd /home/instapod/fr-ci && TEST_DATABASE_URL="postgresql:///fastighetsradar_test?host=/var/run/postgresql" FASTIGHETSRADAR_MIGRATIONS_DIR=/home/instapod/fr-ci/migrations node --test real-db.test.mjs > out.txt 2>&1; echo "exit=$?"; tail -60 out.txt',
);
console.log(r.out);
rmSync(ci, { recursive: true, force: true });
rmSync(join(root, '.ci.tar.gz'), { force: true });
if (!/exit=0/.test(r.out)) process.exit(1);
