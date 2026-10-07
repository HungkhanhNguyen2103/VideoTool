import { spawn } from 'node:child_process';

export type FfmpegCaptureResult = { stdout: string; stderr: string };
export type FfmpegCaptureRunner = (command: string, args: string[]) => Promise<FfmpegCaptureResult>;
export type NormalizeSfxOptions = {
  ffmpegPath: string;
  ffprobePath: string;
  inputPath: string;
  outputPath: string;
  runner?: FfmpegCaptureRunner;
};

const TARGET_I = -16;
const TARGET_TP = -1.5;
const SHORT_CLIP_SECONDS = 3;
const TRUE_PEAK_LIMIT = '0.841395';

const runCapture: FfmpegCaptureRunner = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `${command} exited with ${code}.`)));
});

function numberFromLoudnormJson(stderr: string, field: string): number | null {
  const start = stderr.indexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>;
    const value = Number(parsed[field]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function integratedLoudness(stderr: string): number | null {
  const matches = [...stderr.matchAll(/\bI:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*LUFS/gi)];
  const last = matches.at(-1)?.[1];
  if (!last || last.toLowerCase().includes('inf')) return null;
  const value = Number(last);
  return Number.isFinite(value) ? value : null;
}

function decimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

async function probeDuration(ffprobePath: string, inputPath: string, runner: FfmpegCaptureRunner): Promise<number> {
  const result = await runner(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inputPath]);
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Could not measure SFX duration.');
  return duration;
}

async function probeChannels(ffprobePath: string, inputPath: string, runner: FfmpegCaptureRunner): Promise<number> {
  const result = await runner(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'default=nw=1:nk=1', inputPath]);
  const channels = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isInteger(channels) || channels < 1) throw new Error('Could not measure SFX channel count.');
  return channels;
}

function stereoPan(channels: number): string {
  return channels === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'pan=stereo|c0=c0|c1=c1';
}

async function measureShortClip(ffmpegPath: string, inputPath: string, pan: string, runner: FfmpegCaptureRunner): Promise<number> {
  // Measure the same stereo channel layout written to disk; mono-to-stereo rematrixing changes EBU R128 weighting.
  const result = await runner(ffmpegPath, ['-hide_banner', '-nostats', '-i', inputPath, '-af', `${pan},ebur128=peak=true`, '-f', 'null', '-']);
  const integrated = integratedLoudness(result.stderr);
  if (integrated === null) throw new Error('Could not measure SFX integrated loudness with ebur128.');
  return integrated;
}

export async function normalizeSfxForRender(options: NormalizeSfxOptions): Promise<void> {
  const runner = options.runner ?? runCapture;
  const duration = await probeDuration(options.ffprobePath, options.inputPath, runner);
  const pan = stereoPan(await probeChannels(options.ffprobePath, options.inputPath, runner));
  let filter: string;

  if (duration < SHORT_CLIP_SECONDS) {
    const measuredI = await measureShortClip(options.ffmpegPath, options.inputPath, pan, runner);
    const gainDb = TARGET_I - measuredI;
    filter = `${pan},volume=${decimal(gainDb)}dB,aresample=192000,alimiter=limit=${TRUE_PEAK_LIMIT}:level=false,aresample=48000`;
  } else {
    const measured = await runner(options.ffmpegPath, [
      '-hide_banner', '-nostats', '-i', options.inputPath,
      '-af', `${pan},loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:print_format=json`, '-f', 'null', '-',
    ]);
    const inputI = numberFromLoudnormJson(measured.stderr, 'input_i');
    const inputTp = numberFromLoudnormJson(measured.stderr, 'input_tp');
    const inputLra = numberFromLoudnormJson(measured.stderr, 'input_lra');
    const inputThresh = numberFromLoudnormJson(measured.stderr, 'input_thresh');
    const offset = numberFromLoudnormJson(measured.stderr, 'target_offset');
    if ([inputI, inputTp, inputLra, inputThresh, offset].some((value) => value === null)) {
      throw new Error('Could not measure SFX loudnorm statistics.');
    }
    filter = `${pan},loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:measured_I=${decimal(inputI!)}:measured_TP=${decimal(inputTp!)}:measured_LRA=${decimal(inputLra!)}:measured_thresh=${decimal(inputThresh!)}:offset=${decimal(offset!)}:linear=true:print_format=summary`;
  }

  await runner(options.ffmpegPath, [
    '-y', '-hide_banner', '-i', options.inputPath, '-af', filter,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', options.outputPath,
  ]);
}
