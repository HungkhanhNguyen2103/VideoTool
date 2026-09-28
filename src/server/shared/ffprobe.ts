import { spawn } from 'node:child_process';
import { loadConfig } from '../config';

type FfprobeJson = { format?: { duration?: unknown } };

function runFfprobe(command: string, filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => reject(new Error(`ffprobe failed: ${error.message}`)));
    child.once('close', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`ffprobe failed: ${stderr.trim() || `${command} exited with ${code}.`}`)));
  });
}

export async function probeVideoDuration(filePath: string, options: { ffprobePath?: string } = {}): Promise<number> {
  let raw: string;
  try {
    raw = await runFfprobe(options.ffprobePath ?? loadConfig().FFPROBE_PATH, filePath);
  } catch (error) {
    if (error instanceof Error && /ffprobe failed/i.test(error.message)) throw error;
    throw new Error(`ffprobe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: FfprobeJson;
  try {
    parsed = JSON.parse(raw) as FfprobeJson;
  } catch {
    throw new Error('ffprobe returned invalid JSON.');
  }
  const duration = typeof parsed.format?.duration === 'number'
    ? parsed.format.duration
    : Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('ffprobe returned an invalid video duration.');
  return duration;
}
