import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config';

const FFMPEG_TIMEOUT_MS = 30_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function runFfmpeg(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finishReject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000} seconds.`));
    }, FFMPEG_TIMEOUT_MS);
    timeout.unref();

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => finishReject(new Error(`ffmpeg failed: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) finishResolve();
      else finishReject(new Error(`ffmpeg failed: ${stderr.trim() || `ffmpeg exited with ${code}.`}`));
    });
  });
}

export async function extractLastFrame(videoPath: string, options: { ffmpegPath?: string } = {}): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-tool-tail-'));
  const outputPath = path.join(tempDir, 'tail.png');
  try {
    await runFfmpeg(options.ffmpegPath ?? loadConfig().FFMPEG_PATH, [
      '-y', '-v', 'error', '-sseof', '-0.5', '-i', videoPath, '-an', '-update', '1', outputPath,
    ]);
    let buffer: Buffer;
    try {
      buffer = await readFile(outputPath);
    } catch {
      throw new Error('ffmpeg did not produce a last-frame PNG.');
    }
    if (buffer.length === 0) throw new Error('ffmpeg produced an empty last-frame PNG.');
    if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error('ffmpeg produced an invalid last-frame PNG.');
    return buffer;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
