import type { RenderEngine } from '../../../contracts/project';
import { FfmpegRenderer, type VideoRenderer } from './ffmpeg-renderer';
import { RemotionRenderer } from './remotion-renderer';
import { configureRemotionBundle, resetRemotionBundleCache } from './remotion-bundle';

let filesDir = './data/files';
let remotionPublicDir = './data/remotion-public';
let ffmpegRenderer: FfmpegRenderer | null = null;
let remotionRenderer: RemotionRenderer | null = null;

export function configureVideoRenderer(directory: string, bundleDirectory = remotionPublicDir): void {
  filesDir = directory;
  remotionPublicDir = bundleDirectory;
  ffmpegRenderer = null;
  remotionRenderer = null;
  configureRemotionBundle(bundleDirectory);
  resetRemotionBundleCache();
}

export function getVideoRenderer(engine: RenderEngine): VideoRenderer {
  if (engine === 'remotion') return remotionRenderer ??= new RemotionRenderer({ filesDir });
  return ffmpegRenderer ??= new FfmpegRenderer({ filesDir });
}

export type { VideoRenderer } from './ffmpeg-renderer';
export { FfmpegRenderer } from './ffmpeg-renderer';
export { RemotionRenderer } from './remotion-renderer';
export { createVideoRouter } from './routes';
export { alignProjectWordTimings } from './word-timing-service';
export { configureDepthMapService, generateProjectDepthMaps, generateSceneDepthMap } from './depth-map-service';
export {
  assertProjectRenderReady,
  configureVideoModule,
  generateProjectBgm,
  generateProjectSfx,
  generateProjectVoiceovers,
  generateSceneSfx,
  generateSceneVoiceover,
  renderFullProject,
  renderScenePreviewBuffer,
} from './service';
