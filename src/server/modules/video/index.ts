import type { RenderEngine } from '../../../contracts/project';
import { FfmpegRenderer, type VideoRenderer } from './ffmpeg-renderer';
import { RemotionRenderer } from './remotion-renderer';
import { configureRemotionBundle, resetRemotionBundleCache } from './remotion-bundle';

let filesDir = './data/files';
let remotionPublicDir = './data/remotion-public';
let configuredRemotionConcurrency: number | undefined;
let ffmpegRenderer: FfmpegRenderer | null = null;
let remotionRenderer: RemotionRenderer | null = null;

export function configureVideoRenderer(directory: string, bundleDirectory = remotionPublicDir, remotionConcurrency?: number): void {
  filesDir = directory;
  remotionPublicDir = bundleDirectory;
  ffmpegRenderer = null;
  remotionRenderer = null;
  configureRemotionBundle(bundleDirectory);
  configuredRemotionConcurrency = remotionConcurrency;
  resetRemotionBundleCache();
}

export function getVideoRenderer(engine: RenderEngine): VideoRenderer {
  if (engine === 'remotion') return remotionRenderer ??= new RemotionRenderer({ filesDir, remotionConcurrency: configuredRemotionConcurrency });
  return ffmpegRenderer ??= new FfmpegRenderer({ filesDir });
}

export type { VideoRenderer } from './ffmpeg-renderer';
export { FfmpegRenderer } from './ffmpeg-renderer';
export { RemotionRenderer } from './remotion-renderer';
export { createVideoRouter } from './routes';
export { alignProjectWordTimings } from './word-timing-service';
export { recomputeProjectSceneDurations } from './scene-duration-service';
export { analyzeProjectNameKeywords } from './name-keyword-service';
export { autoAnalyzeProjectNameKeywordsIfStale } from './name-keyword-service';
export { analyzeProjectPopups, autoAnalyzeProjectPopupsIfStale, POPUP_ANALYSIS_JOB_TYPE, PopupAnalysisRequestSchema } from './popup-analysis-service';
export { configureDepthMapService, generateProjectDepthMaps, generateSceneDepthMap } from './depth-map-service';
export { configureLogoService, removeProjectLogo, replaceProjectLogo } from './logo-service';
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
