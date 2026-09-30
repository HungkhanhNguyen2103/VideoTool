import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../config';
import { extractLastFrame } from './ffmpeg-frames';

const config = loadConfig();
const ffmpegAvailable = spawnSync(config.FFMPEG_PATH, ['-version'], { stdio: 'ignore' }).status === 0;

describe('ffmpeg last-frame wrapper', () => {
  let directory = '';

  beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'video-tool-ffmpeg-frames-')); });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it.skipIf(!ffmpegAvailable)('extracts the last blue frame instead of the first red frame', async () => {
    const video = path.join(directory, 'red-blue.mp4');
    const generated = spawnSync(config.FFMPEG_PATH, [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=30:d=1',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=30:d=1',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]',
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video,
    ], { encoding: 'utf8' });
    expect(generated.status).toBe(0);

    const png = await extractLastFrame(video);
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const decoded = spawnSync(config.FFMPEG_PATH, ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-frames:v', '1', 'pipe:1'], {
      input: png,
    });
    expect(decoded.status).toBe(0);
    const rgb = decoded.stdout as Buffer;
    const red = rgb.filter((_, index) => index % 3 === 0);
    const green = rgb.filter((_, index) => index % 3 === 1);
    const blue = rgb.filter((_, index) => index % 3 === 2);
    expect(Math.max(...blue)).toBeGreaterThan(150);
    expect(Math.max(...red)).toBeLessThan(100);
    expect(Math.max(...green)).toBeLessThan(100);
  });

  it('rejects a nonexistent input path', async () => {
    await expect(extractLastFrame(path.join(directory, 'missing.mp4'))).rejects.toThrow(/ffmpeg/i);
  });

  it.skipIf(!ffmpegAvailable)('returns a PNG for a clip shorter than the seek window', async () => {
    const video = path.join(directory, 'short.mp4');
    const generated = spawnSync(config.FFMPEG_PATH, [
      '-y', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:r=30:d=0.25',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video,
    ], { encoding: 'utf8' });
    expect(generated.status).toBe(0);

    const png = await extractLastFrame(video);
    expect((await readFile(video)).length).toBeGreaterThan(0);
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.length).toBeGreaterThan(0);
  });
});
