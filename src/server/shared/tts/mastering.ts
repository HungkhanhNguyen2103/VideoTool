import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../../config';
import { logger } from '../logger';

export const AUDIO_MASTERING_FILTER = 'highpass=f=75,equalizer=f=100:width_type=h:width=50:g=2,equalizer=f=3200:width_type=h:width=1000:g=2,loudnorm=I=-16:TP=-1.5:LRA=11';

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `${command} exited with ${code}.`)));
  });
}

export async function masterAudio(buffer: Buffer): Promise<Buffer> {
  const config = loadConfig();
  const directory = await mkdtemp(path.join(tmpdir(), 'video-tool-tts-'));
  const input = path.join(directory, 'input.wav');
  const output = path.join(directory, 'mastered.wav');
  try {
    await writeFile(input, buffer);
    await runProcess(config.FFMPEG_PATH, ['-y', '-i', input, '-af', AUDIO_MASTERING_FILTER, '-c:a', 'pcm_s16le', output]);
    return await readFile(output);
  } catch (error) {
    logger.warn('Audio mastering failed; using unmastered audio.', error);
    return buffer;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function probeAudioDuration(buffer: Buffer): Promise<number> {
  const config = loadConfig();
  const directory = await mkdtemp(path.join(tmpdir(), 'video-tool-probe-'));
  const input = path.join(directory, 'audio.wav');
  try {
    await writeFile(input, buffer);
    const output = await runProcess(config.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input]);
    const duration = Number.parseFloat(output.trim());
    if (!Number.isFinite(duration) || duration < 0) throw new Error('ffprobe returned an invalid duration.');
    return duration;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
