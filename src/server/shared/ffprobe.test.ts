import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../config';
import { probeVideoDuration } from './ffprobe';

const config = loadConfig();
const ffmpegAvailable = spawnSync(config.FFMPEG_PATH, ['-version'], { stdio: 'ignore' }).status === 0;

describe('video ffprobe wrapper', () => {
  let directory = '';

  beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'video-tool-ffprobe-')); });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it.skipIf(!ffmpegAvailable)('parses a real short video duration', async () => {
    const video = path.join(directory, 'short.mp4');
    const generated = spawnSync(config.FFMPEG_PATH, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=0.75', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { encoding: 'utf8' });
    expect(generated.status).toBe(0);
    await expect(probeVideoDuration(video)).resolves.toBeCloseTo(0.75, 1);
  });

  it('throws a clear error for a missing or invalid video file', async () => {
    await expect(probeVideoDuration(path.join(directory, 'missing.mp4'))).rejects.toThrow(/ffprobe/i);
  });
});
