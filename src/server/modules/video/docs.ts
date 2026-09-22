import type { Scene } from '../../../contracts/project';

export const SFX_VOLUME = '0.31622777';
export const BGM_VOLUME = '0.1';
export const AUDIO_BUFFER_SECONDS = 0.3;

export type SceneRenderInputs = {
  assetType: Scene['assetType'];
  videoPath: string;
  audioPath?: string;
  sfxPath?: string;
  outputPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
};

export function buildSceneFilterGraph(input: Pick<SceneRenderInputs, 'durationSec' | 'width' | 'height' | 'fps'>): string {
  const { durationSec, width, height, fps } = input;
  return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p,setsar=1[v];` +
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},apad=whole_dur=${durationSec}[voiceD];` +
    `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},apad=whole_dur=${durationSec},volume=${SFX_VOLUME}[sfxD];` +
    '[voiceD][sfxD]amix=inputs=2:duration=first:dropout_transition=0[a]';
}

export function buildSceneArguments(input: SceneRenderInputs): string[] {
  const args = ['-y'];
  if (input.assetType === 'image') args.push('-loop', '1');
  args.push('-i', input.videoPath);
  if (input.audioPath) args.push('-i', input.audioPath);
  else args.push('-f', 'lavfi', '-t', String(input.durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  if (input.sfxPath) args.push('-i', input.sfxPath);
  else args.push('-f', 'lavfi', '-t', String(input.durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push(
    '-filter_complex', buildSceneFilterGraph(input), '-map', '[v]', '-map', '[a]',
    '-t', String(input.durationSec), '-r', String(input.fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', input.outputPath,
  );
  return args;
}

export function buildConcatArguments(listPath: string, outputPath: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];
}

export function buildBgmFilterGraph(totalDuration: number): string {
  return `[1:a]aloop=loop=-1:size=2000000000,atrim=0:${totalDuration},apad=whole_dur=${totalDuration},volume=${BGM_VOLUME}[bgmD];` +
    '[0:a][bgmD]amix=inputs=2:duration=first:dropout_transition=0[fullA]';
}

export function buildBgmArguments(concatPath: string, bgmPath: string, outputPath: string, totalDuration: number): string[] {
  return ['-y', '-i', concatPath, '-i', bgmPath, '-filter_complex', buildBgmFilterGraph(totalDuration), '-map', '0:v:0', '-map', '[fullA]', '-c:v', 'copy', '-c:a', 'aac', '-t', String(totalDuration), '-movflags', '+faststart', outputPath];
}
