#!/usr/bin/env node
/**
 * Minimal InstaPods REST client for FastighetsRadar operations.
 * Docs: https://docs.instapods.com/api-reference/overview.md
 *
 * Safety rules (see IMPLEMENTATION_PROGRESS.md – Agent 2):
 *  - Auth: INSTAPOD_TOKEN (official CLI/API variable), read from the environment or the
 *    local .env file. The token is never printed.
 *  - Every pod-scoped call is hard-restricted to ALLOWED_POD. Any other pod name is refused,
 *    so unrelated pods (e.g. `vaktskolan`) can never be targeted by mistake.
 *  - Output is filtered: password/token/secret-like fields are redacted.
 *
 * Usage:
 *   node scripts/instapods.mjs pods                    # list pod names + basic metadata (read-only)
 *   node scripts/instapods.mjs get                     # f-radar details
 *   node scripts/instapods.mjs exec -- <cmd> [args…]   # run a command inside f-radar
 *   node scripts/instapods.mjs logs [lines] [service]
 *   node scripts/instapods.mjs raw <METHOD> <path> [jsonBody]   # path must contain /pods/f-radar or be a non-pod path
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const ALLOWED_POD = 'f-radar';
const BASE = 'https://app.instapods.com/api';

function loadToken() {
  if (process.env.INSTAPOD_TOKEN) return process.env.INSTAPOD_TOKEN.trim();
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const m = /^\s*INSTAPOD_TOKEN\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(readFileSync(envPath, 'utf8'));
    if (m) return m[1].trim();
  }
  throw new Error('INSTAPOD_TOKEN is not set (environment or .env)');
}

const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|private|credential|database_url|dsn/i;
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) && v ? '[REDACTED]' : redact(v)]));
  }
  if (typeof value === 'string') return value.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, '$1[REDACTED]@');
  return value;
}

function assertAllowedPath(path) {
  if (!path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Invalid API path "${path}" (on Git Bash set MSYS_NO_PATHCONV=1 to stop path rewriting).`);
  }
  const m = /^\/pods\/([^/?]+)/.exec(path);
  if (m && m[1] !== ALLOWED_POD) throw new Error(`Refusing to touch pod "${m[1]}" – only "${ALLOWED_POD}" is allowed.`);
}

export async function api(method, path, body, { raw = false } = {}) {
  assertAllowedPath(path);
  if (method !== 'GET' && path === '/pods' && body?.name !== ALLOWED_POD) {
    throw new Error(`Refusing to create a pod other than "${ALLOWED_POD}".`);
  }
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${loadToken()}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.length > 300 ? `${text.slice(0, 300)}… [non-JSON response truncated]` : text;
  }
  return { status: res.status, data: raw ? data : redact(data) };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let out;
  switch (cmd) {
    case 'pods': {
      const r = await api('GET', '/pods?limit=100');
      const pods = (r.data.pods ?? []).map((p) => ({ name: p.name, status: p.status, plan: p.plan_slug, region: p.region, preset: p.preset }));
      out = { status: r.status, total: r.data.total, pods };
      break;
    }
    case 'get':
      out = await api('GET', `/pods/${ALLOWED_POD}`);
      break;
    case 'exec': {
      const i = rest.indexOf('--');
      const command = i >= 0 ? rest.slice(i + 1) : rest;
      const r = await api('POST', `/pods/${ALLOWED_POD}/exec`, { command, workdir: '/home/instapod' });
      if (typeof r.data === 'object') {
        process.stdout.write(String(r.data.output ?? ''));
        if (r.data.exit_code) process.stdout.write(`\n[exit ${r.data.exit_code}] ${r.data.error ?? ''}\n`);
        process.exitCode = r.data.exit_code ? 1 : 0;
        return;
      }
      out = r;
      break;
    }
    case 'logs': {
      const [lines = '100', service = 'app'] = rest;
      const r = await api('GET', `/pods/${ALLOWED_POD}/logs?lines=${lines}&service=${service}`);
      process.stdout.write(String(r.data.logs ?? JSON.stringify(r.data)));
      return;
    }
    case 'upload': {
      // upload <local .tar.gz> <absolute remote dir under /home/instapod>
      const [file, dir] = rest;
      if (!file || !dir?.startsWith('/home/instapod/')) throw new Error('usage: upload <file.tar.gz> </home/instapod/...>');
      const { readFileSync: rf } = await import('node:fs');
      const form = new FormData();
      form.set('archive', new Blob([rf(file)], { type: 'application/gzip' }), 'bundle.tar.gz');
      form.set('path', dir);
      out = await api('POST', `/pods/${ALLOWED_POD}/files/upload-archive`, form);
      break;
    }
    case 'raw': {
      const [method, path, json] = rest;
      out = await api(method, path, json ? JSON.parse(json) : undefined);
      break;
    }
    default:
      console.error('Usage: node scripts/instapods.mjs <pods|get|exec|logs|raw> …');
      process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('instapods.mjs')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
