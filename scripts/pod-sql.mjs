#!/usr/bin/env node
/**
 * Read-only SQL helper for the f-radar pod's APPLICATION database (diagnostics).
 *   node scripts/pod-sql.mjs "SELECT job_id, last_status FROM provider_jobs"
 * Refuses anything but a single SELECT statement. Requires INSTAPOD_TOKEN.
 */
import { ALLOWED_POD, api } from './instapods.mjs';

const sql = process.argv.slice(2).join(' ').trim();
if (!/^select\s/i.test(sql) || /;\s*\S/.test(sql) || /\b(insert|update|delete|drop|alter|truncate|create|grant|copy)\b/i.test(sql)) {
  console.error('Only a single read-only SELECT is allowed.');
  process.exit(2);
}
const b64 = Buffer.from(sql).toString('base64');
const r = await api('POST', `/pods/${ALLOWED_POD}/exec`, {
  command: ['sh', '-c', `echo ${b64} | base64 -d | psql -X -q -v ON_ERROR_STOP=1 --set=default_transaction_read_only=on -P pager=off -h /var/run/postgresql fastighetsradar -c "SET default_transaction_read_only = on" -f -`],
  workdir: '/home/instapod',
});
console.log(String(r.data?.output ?? ''));
process.exit(r.data?.exit_code ? 1 : 0);
