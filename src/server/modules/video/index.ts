import type { RenderEngine } from '../../../contracts/project';
import { FfmpegRenderer, type VideoRenderer } from './ffmpeg-renderer';
import { RemotionRenderer } from './remotion-renderer';

let filesDir = './data/files';
let ffmpegRenderer: FfmpegRenderer | null = null;
let remotionRenderer: RemotionRenderer | null = null;

export function configureVideoRenderer(directory: string): void {
  filesDir = directory;
  ffmpegRenderer = null;
}

export function getVideoRenderer(engine: RenderEngine): VideoRenderer {
  if (engine === 'remotion') return remotionRenderer ??= new RemotionRenderer();
  return ffmpegRenderer ??= new FfmpegRenderer({ filesDir });
}

export type { VideoRenderer } from './ffmpeg-renderer';
export { FfmpegRenderer } from './ffmpeg-renderer';
