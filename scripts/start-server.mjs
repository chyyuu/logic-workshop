import { spawn } from 'node:child_process';
import { openSync, closeSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = process.argv[2] ?? '5173';
if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid port');
const output = openSync(new URL('../server.log', import.meta.url), 'a');
const error = openSync(new URL('../server-error.log', import.meta.url), 'a');
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
  '--host', '127.0.0.1', '--port', port, '--strictPort'], {
  cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, error],
});
child.unref();
closeSync(output); closeSync(error);
writeFileSync(new URL('../server.pid', import.meta.url), String(child.pid));
console.log(`http://127.0.0.1:${port}/ (PID ${child.pid})`);
