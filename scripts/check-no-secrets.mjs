#!/usr/bin/env node
/**
 * Fails if any secret value from the local .env appears in the given files/directories.
 * Prints only file names and variable NAMES – never the values.
 * Usage: node scripts/check-no-secrets.mjs <path> [path…]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Values that are public by design are allowed to appear in client bundles.
const PUBLIC_KEYS = new Set(['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_MAP_TILE_URL', 'NEXT_PUBLIC_MAP_TILE_ATTRIBUTION', 'NEXT_PUBLIC_MAP_STYLE_URL']);
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|REDIS_URL|USERNAME/;

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\r\n]*)["']?\s*$/.exec(line);
    if (m && m[2] && m[2].length >= 8 && SECRET_NAME.test(m[1]) && !PUBLIC_KEYS.has(m[1])) env[m[1]] = m[2];
  }
}
const needles = Object.entries(env);
const files = [];
const walk = (p) => {
  const st = statSync(p);
  if (st.isDirectory()) readdirSync(p).forEach((n) => walk(join(p, n)));
  else if (st.size < 50 * 1024 * 1024) files.push(p);
};
process.argv.slice(2).forEach((p) => existsSync(p) && walk(p));

let hits = 0;
for (const f of files) {
  const text = readFileSync(f, 'latin1');
  for (const [name, value] of needles) {
    if (text.includes(value)) {
      console.error(`SECRET LEAK: value of ${name} found in ${f}`);
      hits++;
    }
  }
}
console.log(`Scanned ${files.length} files for ${needles.length} secret values: ${hits ? hits + ' leak(s)' : 'clean'}`);
process.exit(hits ? 1 : 0);
