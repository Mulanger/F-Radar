#!/usr/bin/env node
/**
 * Measures GET /v1/portfolio at scale INSIDE the f-radar pod against the dedicated
 * `fastighetsradar_test` database (never the application database). Requires INSTAPOD_TOKEN.
 * docs/plans/skalning.md, Fas 0.
 *
 *   node scripts/run-portfolio-scale.mjs              # 200 500 1000
 *   node scripts/run-portfolio-scale.mjs 200 500      # chosen sizes
 *   node scripts/run-portfolio-scale.mjs --keep 500   # keep the synthetic data afterwards
 *
 * Steps: build dist-perf/portfolio-scale.mjs, upload it with the migrations to /home/instapod/fr-perf,
 * seed synthetic organizations, run the measurement matrix in the background (child processes with
 * the production heap limit of 192 MB and a search for the smallest limit that works), poll until it
 * is done, print the results and remove the synthetic data.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ALLOWED_POD, api } from './instapods.mjs';

const root = resolve(import.meta.dirname, '..');
const keep = process.argv.includes('--keep');
const sizes = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const sizeArgs = (sizes.length ? sizes : ['200', '500', '1000']).join(' ');
const dir = '/home/instapod/fr-perf';
const envVars = `TEST_DATABASE_URL="postgresql:///fastighetsradar_test?host=/var/run/postgresql" FASTIGHETSRADAR_MIGRATIONS_DIR=${dir}/migrations`;

async function exec(command, timeoutMs = 60_000) {
  const r = await api('POST', `/pods/${ALLOWED_POD}/exec`, { command: ['sh', '-c', command], workdir: '/home/instapod' }, { timeoutMs });
  return { code: r.data?.exit_code, out: String(r.data?.output ?? '') };
}

execSync('node node_modules/tsup/dist/cli-default.js --config tsup.perf.config.ts', { cwd: root, stdio: 'inherit' });
const staging = join(root, '.perf');
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, 'migrations'), { recursive: true });
cpSync(join(root, 'dist-perf/portfolio-scale.mjs'), join(staging, 'portfolio-scale.mjs'));
cpSync(join(root, 'packages/db/migrations'), join(staging, 'migrations'), { recursive: true });
execSync('tar -czf .perf.tar.gz -C .perf .', { cwd: root });

try {
  await exec(`rm -rf ${dir} && mkdir -p ${dir}`);
  const form = new FormData();
  form.set('archive', new Blob([readFileSync(join(root, '.perf.tar.gz'))], { type: 'application/gzip' }), 'perf.tar.gz');
  form.set('path', dir);
  const up = await api('POST', `/pods/${ALLOWED_POD}/files/upload-archive`, form);
  if (up.status !== 200) throw new Error(`upload failed: ${up.status}`);

  console.log(`seed ${sizeArgs} …`);
  await exec(`cd ${dir} && (${envVars} nohup node portfolio-scale.mjs seed ${sizeArgs} > seed.txt 2>&1; echo "exit=$?" >> seed.txt) > /dev/null 2>&1 &`);
  for (;;) {
    await sleep(10_000);
    const { out } = await exec(`cat ${dir}/seed.txt`);
    if (/exit=\d+/.test(out)) {
      console.log(out.trim());
      if (!/exit=0/.test(out)) throw new Error('seed failed');
      break;
    }
  }

  console.log('measure …');
  await exec(`cd ${dir} && (${envVars} nohup node portfolio-scale.mjs matrix ${sizeArgs} > matrix.txt 2>&1; echo "exit=$?" >> matrix.txt) > /dev/null 2>&1 &`);
  let shown = 0;
  for (;;) {
    await sleep(15_000);
    const { out } = await exec(`cat ${dir}/matrix.txt`);
    const lines = out.trim().split('\n').filter(Boolean);
    for (const line of lines.slice(shown)) console.log(line);
    shown = lines.length;
    if (/exit=\d+/.test(out)) break;
  }
} finally {
  if (!keep) {
    const c = await exec(`cd ${dir} && ${envVars} node portfolio-scale.mjs cleanup 2>&1 | tail -2`);
    console.log(c.out.trim());
  }
  rmSync(staging, { recursive: true, force: true });
  rmSync(join(root, '.perf.tar.gz'), { force: true });
}
