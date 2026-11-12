/* eslint-disable */
/**
 * FastighetsRadar process supervisor for the InstaPods `f-radar` pod.
 *
 * The pod's systemd unit runs `node index.js` from /home/instapod/app with
 * Restart=on-failure. This file starts two child processes and exits with an error as soon
 * as either dies, so systemd restarts the whole application (simple, deterministic, no
 * extra process manager, no extra paid infrastructure):
 *
 *   web  – Next.js standalone server, PUBLIC, 0.0.0.0:3000 (nginx/HTTPS in front)
 *   api  – Fastify, PRIVATE, 127.0.0.1:4000 (only reachable from inside the pod)
 *
 * PostgreSQL listens on localhost only and is reached through the Unix socket.
 * Secrets come from the pod environment (/etc/instapods/app.env), never from files here.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = __dirname;
const children = [];
let stopping = false;

function start(name, script, extraEnv, maxOldSpaceMb) {
  const child = spawn(process.execPath, [`--max-old-space-size=${maxOldSpaceMb}`, script], {
    cwd: path.dirname(script),
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[supervisor] ${name} exited (code=${code}, signal=${signal}) – exiting so systemd restarts the app`);
    shutdown(1);
  });
  children.push(child);
  console.log(`[supervisor] started ${name} (pid ${child.pid})`);
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000).unref();
  Promise.all(children.map((c) => new Promise((r) => (c.exitCode !== null ? r() : c.once('exit', r))))).then(() => process.exit(code));
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

start('api', path.join(root, 'api', 'main.mjs'), { API_HOST: '127.0.0.1', API_PORT: '4000', FASTIGHETSRADAR_MIGRATIONS_DIR: path.join(root, 'db', 'migrations') }, 192);
start('web', path.join(root, 'web', 'apps', 'web', 'server.js'), { PORT: '3000', HOSTNAME: '0.0.0.0', FASTIGHETSRADAR_INTERNAL_API_URL: 'http://127.0.0.1:4000' }, 384);
