import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const libDir = join(root, 'lib');
const pythonBin = process.env.TTS_PYTHON_BIN ?? 'python';
const host = process.env.TTS_SERVER_HOST ?? '127.0.0.1';
const port = process.env.TTS_SERVER_PORT ?? '8000';
let shellCommandNotFound = false;

const child = spawn(pythonBin, ['-m', 'uvicorn', 'tts_server:app', '--host', host, '--port', port], {
  cwd: libDir,
  stdio: ['inherit', 'inherit', 'pipe'],
  shell: process.platform === 'win32',
});

child.stderr.on('data', (chunk) => {
  const message = chunk.toString();
  if (message.includes('is not recognized as an internal or external command')) {
    shellCommandNotFound = true;
    return;
  }
  process.stderr.write(message);
});

child.once('error', (error) => {
  console.error(`TTS server failed to start: ${error.message}. Check TTS_PYTHON_BIN and that 'uvicorn' is installed.`);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (shellCommandNotFound) {
    console.error(`TTS server failed to start: ${pythonBin} was not found. Check TTS_PYTHON_BIN and that 'uvicorn' is installed.`);
    process.exit(1);
  }
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
