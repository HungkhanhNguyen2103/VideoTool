import type { Scene } from '../../../contracts/project';
import { BGM_VOLUME, SFX_VOLUME } from '../../../contracts/video';
import { frameAlignedDurationSec, secondsToFrames } from '../../../contracts/frame-math';
export { BGM_VOLUME, BGM_VOLUME_NUMBER, SFX_VOLUME, SFX_VOLUME_NUMBER } from '../../../contracts/video';

export const FFMPEG_H264_CRF = 22;
export const FFMPEG_H264_PRESET = 'medium';

export type SceneRenderInputs = {
  assetType: Scene['assetType'];
  videoPath: string;
  audioPath?: string;
  sfxPath?: string;
  outputPath: string;
  durationSec: number;
  videoDurationSec?: number | null;
  width: number;
  height: number;
  fps: number;
  sfxVolume?: number;
};

export function buildSceneFilterGraph(input: Pick<SceneRenderInputs, 'durationSec' | 'width' | 'height' | 'fps'> & Partial<Pick<SceneRenderInputs, 'assetType' | 'videoDurationSec' | 'sfxVolume'>>): string {
  const { width, height, fps } = input;
  const durationSec = frameAlignedDurationSec(input.durationSec, fps);
  const videoDurationSec = input.videoDurationSec;
  const isMeasuredShortVideo = input.assetType === 'video' && videoDurationSec !== null && videoDurationSec !== undefined && videoDurationSec > 0 && videoDurationSec < durationSec;
  const startPad = isMeasuredShortVideo ? `,tpad=start_mode=clone:start_duration=${durationSec - videoDurationSec}` : '';
  const videoTrim = input.assetType === 'video' ? `,trim=duration=${durationSec},setpts=PTS-STARTPTS` : '';
  return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p,setsar=1${startPad}${videoTrim}[v];` +
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},apad=whole_dur=${durationSec}[voiceD];` +
    `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},apad=whole_dur=${durationSec},volume=${input.sfxVolume ?? Number(SFX_VOLUME)}[sfxD];` +
    '[voiceD][sfxD]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]';
}

export function buildSceneArguments(input: SceneRenderInputs): string[] {
  const args = ['-y'];
  const durationSec = frameAlignedDurationSec(input.durationSec, input.fps);
  const frameCount = secondsToFrames(durationSec, input.fps);
  if (input.assetType === 'image') args.push('-loop', '1');
  args.push('-i', input.videoPath);
  if (input.audioPath) args.push('-i', input.audioPath);
  else args.push('-f', 'lavfi', '-t', String(durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  if (input.sfxPath) args.push('-i', input.sfxPath);
  else args.push('-f', 'lavfi', '-t', String(durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push(
    '-filter_complex', buildSceneFilterGraph(input), '-map', '[v]', '-map', '[a]',
    '-t', String(durationSec), '-r', String(input.fps), '-frames:v', String(frameCount), '-c:v', 'libx264', '-crf', String(FFMPEG_H264_CRF), '-preset', FFMPEG_H264_PRESET, '-pix_fmt', 'yuv420p',
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
