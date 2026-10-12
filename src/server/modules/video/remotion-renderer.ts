import { readFile, rm } from 'node:fs/promises';
import { cpus, freemem } from 'node:os';
import { performance } from 'node:perf_hooks';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { sceneFrameTimings, sceneVisualTimings } from '../../../remotion/frame-math';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { createFileStoreService } from '../file-store';
import { configureRemotionBundle, getRemotionBundle } from './remotion-bundle';
import { stageRemotionRender, type StagedRemotionRender } from './remotion-staging';
import type { RenderFileResolver } from './remotion-props';
import { hasUsableDepthScene } from './depth-eligibility';
import type { RenderVideoOptions, VideoRenderer } from './ffmpeg-renderer';
import { renderMedia as remotionRenderMedia, selectComposition as remotionSelectComposition } from '@remotion/renderer';
import type { RenderMediaOptions } from '@remotion/renderer';

export const REMOTION_CHROMIUM_OPTIONS = { gl: 'angle' as const };

type BundleFunction = () => Promise<string>;
type SelectCompositionFunction = typeof remotionSelectComposition;
type RenderMediaFunction = typeof remotionRenderMedia;

export type RemotionRendererOptions = {
  filesDir?: string;
  remotionPublicDir?: string;
  resolver?: RenderFileResolver;
  bundle?: BundleFunction;
  selectComposition?: SelectCompositionFunction;
  renderMedia?: RenderMediaFunction;
  readFile?: typeof readFile;
  remotionConcurrency?: number;
};

function asRenderFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(`Remotion render failed: ${message}`, 502, 'REMOTION_RENDER_FAILED');
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(2);
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

type SceneFrameTiming = ReturnType<typeof sceneFrameTimings>[number];
type SceneVisualTiming = ReturnType<typeof sceneVisualTimings>[number];
type SceneRenderMetrics = { frames: number; elapsedMs: number };

function sceneIndexForFrame(frame: number, timings: readonly SceneFrameTiming[]): number {
  for (let index = timings.length - 1; index >= 0; index -= 1) {
    const timing = timings[index]!;
    if (timing.durationInFrames > 0 && frame >= timing.from && frame < timing.from + timing.durationInFrames) return index;
  }
  return -1;
}

function sceneIndexesForVisualFrame(frame: number, timings: readonly SceneVisualTiming[]): number[] {
  return timings.flatMap((timing, index) => frame >= timing.from && frame < timing.from + timing.durationInFrames ? [index] : []);
}

function accumulateSceneProgress(
  metrics: SceneRenderMetrics[],
  timings: readonly SceneFrameTiming[],
  fromFrame: number,
  toFrame: number,
  elapsedMs: number,
): void {
  const frameCount = toFrame - fromFrame;
  if (frameCount <= 0) return;
  const elapsedPerFrame = elapsedMs / frameCount;
  for (let frame = fromFrame; frame < toFrame; frame += 1) {
    const sceneIndex = sceneIndexForFrame(frame, timings);
    if (sceneIndex < 0) continue;
    metrics[sceneIndex]!.frames += 1;
    metrics[sceneIndex]!.elapsedMs += elapsedPerFrame;
  }
}

export class RemotionRenderer implements VideoRenderer {
  private readonly resolver: RenderFileResolver;
  private readonly bundle: BundleFunction;
  private readonly selectComposition: SelectCompositionFunction;
  private readonly renderMedia: RenderMediaFunction;
  private readonly readOutput: typeof readFile;
  private readonly remotionConcurrency: number | undefined;
  private bundlePromise: Promise<string> | null = null;

  constructor(options: RemotionRendererOptions = {}) {
    if (options.remotionPublicDir) configureRemotionBundle(options.remotionPublicDir);
    this.resolver = options.resolver ?? createFileStoreService(options.filesDir ?? './data/files').resolveFilePath;
    this.bundle = options.bundle ?? getRemotionBundle;
    this.selectComposition = options.selectComposition ?? remotionSelectComposition;
    this.renderMedia = options.renderMedia ?? remotionRenderMedia;
    this.readOutput = options.readFile ?? readFile;
    this.remotionConcurrency = options.remotionConcurrency;
  }

  async renderScenePreview(project: ProjectDetail, scene: Scene): Promise<Buffer> {
    return this.render({ ...project, bgmFileId: null }, [scene]);
  }

  async renderFullVideo(project: ProjectDetail, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>, options?: RenderVideoOptions): Promise<Buffer> {
    return this.render(project, project.scenes, appendLog, reportProgress, options);
  }

  private async render(project: ProjectDetail, scenes: ReadonlyArray<Scene>, appendLog?: (message: string) => Promise<void>, reportProgress?: (percent: number) => Promise<void>, options: RenderVideoOptions = {}): Promise<Buffer> {
    let staged: StagedRemotionRender | null = null;
    const totalStartedAt = performance.now();
    const freeMemoryAtStart = freemem();
    let peakRss = process.memoryUsage().rss;
    const draft = options.draft === true;
    const renderScenes = draft ? scenes.map((scene) => ({ ...scene, depthMap: null })) : scenes;
    const renderProject = draft ? { ...project, parallax: 'off' as const } : project;
    try {
      await this.logMessage(`Remotion free memory at start: ${megabytes(freeMemoryAtStart)} MB.`, appendLog);

      const bundleWasCached = this.bundlePromise !== null;
      const bundleStartedAt = performance.now();
      const serveUrl = await this.getBundle();
      await this.logMessage(`Remotion bundle time: ${seconds(performance.now() - bundleStartedAt)}s${bundleWasCached ? ' (bundle cached)' : ''}.`, appendLog);

      const stagingStartedAt = performance.now();
      staged = await stageRemotionRender({ serveUrl, project: renderProject, scenes: renderScenes, resolver: this.resolver, keywordContextScenes: project.scenes });
      await this.logMessage(`Remotion staging time: ${seconds(performance.now() - stagingStartedAt)}s.`, appendLog);
      if (reportProgress) await reportProgress(10);

      const selectStartedAt = performance.now();
      const composition = await this.selectComposition({
        serveUrl,
        id: 'VideoComposition',
        inputProps: staged.inputProps,
        chromiumOptions: REMOTION_CHROMIUM_OPTIONS,
      });
      await this.logMessage(`Remotion selectComposition time: ${seconds(performance.now() - selectStartedAt)}s.`, appendLog);
      await this.logMessage('Remotion render started.', appendLog);
      const depthScenesPresent = hasUsableDepthScene(staged.inputProps.parallax, scenes);
      const cappedEnvConcurrency = this.remotionConcurrency === undefined ? undefined : Math.min(this.remotionConcurrency, Math.max(1, cpus().length));
      const effectiveConcurrency = depthScenesPresent ? 1 : cappedEnvConcurrency;
      const concurrencyRule = depthScenesPresent
        ? 'concurrency 1: depth scenes present'
        : cappedEnvConcurrency === undefined ? 'default' : `env override ${cappedEnvConcurrency}`;
      await this.logMessage(`Remotion ${concurrencyRule}.`, appendLog);
      if (reportProgress) await reportProgress(15);

      let lastBucket = -1;
      let lastProgress = 15;
      let lastRenderedFrames = 0;
      const sceneTimings = sceneFrameTimings(scenes, project.renderSettings.fps);
      const visualTimings = sceneVisualTimings(scenes, project.renderSettings.fps, renderProject.transitionStyle ?? 'varied');
      const sceneMetrics = sceneTimings.map(() => ({ frames: 0, elapsedMs: 0 }));
      let lastMeasuredFrameCount = 0;
      let lastMeasuredAt = 0;
      let renderedDoneIn: number | null = null;
      let encodedDoneIn: number | null = null;
      let progressLogChain = Promise.resolve();
      let progressLogError: unknown;
      let progressReportChain = Promise.resolve();
      let progressReportError: unknown;
      const queueProgressLog = (message: string) => {
        logger.info(message);
        if (appendLog) {
          progressLogChain = progressLogChain.then(async () => {
            try {
              await appendLog(message);
            } catch (error) {
              progressLogError ??= error;
            }
          });
        }
      };
      const queueProgressReport = (percent: number) => {
        if (!reportProgress) return;
        progressReportChain = progressReportChain.then(async () => {
          try {
            await reportProgress(percent);
          } catch (error) {
            progressReportError ??= error;
          }
        });
      };
      const onProgress = (progress: Parameters<NonNullable<RenderMediaOptions['onProgress']>>[0]) => {
        const fraction = Math.max(0, Math.min(1, progress.progress));
        const renderedFrames = typeof progress.renderedFrames === 'number' ? progress.renderedFrames : 0;
        lastRenderedFrames = Math.max(lastRenderedFrames, renderedFrames);
        if (typeof progress.renderedDoneIn === 'number' && Number.isFinite(progress.renderedDoneIn) && progress.renderedDoneIn >= 0) renderedDoneIn = progress.renderedDoneIn;
        if (typeof progress.encodedDoneIn === 'number' && Number.isFinite(progress.encodedDoneIn) && progress.encodedDoneIn >= 0) encodedDoneIn = progress.encodedDoneIn;
        const measuredAt = performance.now();
        if (lastRenderedFrames > lastMeasuredFrameCount) {
          accumulateSceneProgress(sceneMetrics, sceneTimings, lastMeasuredFrameCount, lastRenderedFrames, measuredAt - lastMeasuredAt);
          lastMeasuredFrameCount = lastRenderedFrames;
          lastMeasuredAt = measuredAt;
        }
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        const elapsedSeconds = (performance.now() - totalStartedAt) / 1000;
        const currentFps = elapsedSeconds > 0 ? renderedFrames / elapsedSeconds : 0;
        const bucket = Math.floor(fraction * 10);
        if (bucket > lastBucket) {
          lastBucket = bucket;
          queueProgressLog(`Remotion render progress ${bucket * 10}% (elapsed ${elapsedSeconds.toFixed(2)}s, ${currentFps.toFixed(2)} frames/s, peak RSS ${megabytes(peakRss)} MB).`);
        }
        const percent = Math.round(15 + (fraction * 80));
        if (percent > lastProgress) {
          lastProgress = percent;
          queueProgressReport(percent);
        }
      };
      const renderOptions: RenderMediaOptions = {
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: staged.outputPath,
        inputProps: staged.inputProps,
        onProgress,
        chromiumOptions: REMOTION_CHROMIUM_OPTIONS,
        ...(effectiveConcurrency === undefined ? {} : { concurrency: effectiveConcurrency }),
        ...(draft ? { scale: 0.5 } : {}),
      };
      const renderStartedAt = performance.now();
      lastMeasuredAt = renderStartedAt;
      const renderResult = await this.renderMedia(renderOptions);
      const renderMilliseconds = performance.now() - renderStartedAt;
      await this.logMessage(`Remotion renderMedia time: ${seconds(renderMilliseconds)}s.`, appendLog);
      await this.logMessage(renderedDoneIn === null ? 'Remotion frame rendering: not reported by @remotion/renderer.' : `Remotion frame rendering: ${seconds(renderedDoneIn)}s.`, appendLog);
      await this.logMessage(encodedDoneIn === null ? 'Remotion encoding/stitching: not reported by @remotion/renderer.' : `Remotion encoding/stitching: ${seconds(encodedDoneIn)}s.`, appendLog);
      await this.logMessage('Remotion audio mixing: not separately exposed by @remotion/renderer.', appendLog);
      const stagedScenes = staged.inputProps.scenes;
      for (const [index, metrics] of sceneMetrics.entries()) {
        if (metrics.frames === 0) continue;
        const scene = stagedScenes[index]!;
        const throughput = metrics.elapsedMs > 0 ? `${(metrics.frames / (metrics.elapsedMs / 1000)).toFixed(2)} frames/s` : 'not measurable';
        await this.logMessage(`Remotion scene throughput ${index + 1} ${scene.id}: ${metrics.frames} frames in ${seconds(metrics.elapsedMs)}s (${throughput}, estimated from progress intervals; ${scene.assetType}, filmLook ${scene.filmLook ? 'on' : 'off'}, popups ${scene.keywords.length}, transition ${renderProject.transitionStyle ?? 'varied'}).`, appendLog);
      }
      for (const slowFrame of renderResult.slowestFrames) {
        const sceneIndexes = sceneIndexesForVisualFrame(slowFrame.frame, visualTimings);
        const sceneDetails = sceneIndexes.map((index) => {
          const scene = stagedScenes[index]!;
          return `scene ${index + 1} ${scene.id} (${scene.assetType}, filmLook ${scene.filmLook ? 'on' : 'off'}, popups ${scene.keywords.length}, transition ${renderProject.transitionStyle ?? 'varied'})`;
        });
        if (sceneDetails.length > 0) await this.logMessage(`Remotion slow frame ${slowFrame.frame}: ${slowFrame.time}ms, ${sceneDetails.join('; ')}.`, appendLog);
      }
      await progressLogChain;
      await progressReportChain;
      if (progressLogError) throw progressLogError;
      if (progressReportError) throw progressReportError;

      const readStartedAt = performance.now();
      const output = await this.readOutput(staged.outputPath);
      await this.logMessage(`Remotion read output time: ${seconds(performance.now() - readStartedAt)}s.`, appendLog);
      await this.logMessage(`Remotion memory: peak RSS ${megabytes(peakRss)} MB; free memory at start ${megabytes(freeMemoryAtStart)} MB.`, appendLog);
      const frameStep = 1;
      const outputFps = composition.fps / frameStep;
      const outputWidth = Math.round(composition.width * (draft ? 0.5 : 1));
      const outputHeight = Math.round(composition.height * (draft ? 0.5 : 1));
      const frameCount = lastRenderedFrames || Math.ceil(composition.durationInFrames / frameStep);
      const outputMegabytes = megabytes((output as Buffer).byteLength);
      await this.logMessage(`${draft ? 'DRAFT ' : ''}Remotion render done: ${frameCount} frames in ${seconds(renderMilliseconds)}s (${(frameCount / (renderMilliseconds / 1000 || 1)).toFixed(2)} frames/s), concurrency ${effectiveConcurrency ?? 'default'}, ${outputWidth}x${outputHeight}@${outputFps}, scenes ${staged.inputProps.scenes.length} (video ${staged.inputProps.scenes.filter((scene) => scene.assetType === 'video').length}, depth ${staged.inputProps.scenes.filter((scene) => scene.depthMapRelPath !== null).length}), output ${outputMegabytes} MB`, appendLog);
      await this.logMessage(`Remotion total time: ${seconds(performance.now() - totalStartedAt)}s.`, appendLog);
      await this.logMessage('Remotion render complete.', appendLog);
      if (reportProgress) await reportProgress(100);
      return output as Buffer;
    } catch (error) {
      throw asRenderFailure(error);
    } finally {
      if (staged) {
        try {
          await staged.cleanup();
        } catch (error) {
          logger.warn('Remotion render staging cleanup failed.', error);
        }
        try {
          await rm(staged.outputPath, { force: true });
        } catch (error) {
          logger.warn('Remotion render output cleanup failed.', error);
        }
      }
    }
  }

  private getBundle(): Promise<string> {
    if (!this.bundlePromise) {
      this.bundlePromise = this.bundle().catch((error) => {
        this.bundlePromise = null;
        throw error;
      });
    }
    return this.bundlePromise;
  }

  private async logMessage(message: string, appendLog?: (message: string) => Promise<void>): Promise<void> {
    logger.info(message);
    if (appendLog) await appendLog(message);
  }
}
