import { readFile, rm } from 'node:fs/promises';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { createFileStoreService } from '../file-store';
import { configureRemotionBundle, getRemotionBundle } from './remotion-bundle';
import { stageRemotionRender, type StagedRemotionRender } from './remotion-staging';
import type { RenderFileResolver } from './remotion-props';
import type { VideoRenderer } from './ffmpeg-renderer';
import { renderMedia as remotionRenderMedia, selectComposition as remotionSelectComposition } from '@remotion/renderer';
import type { RenderMediaOptions } from '@remotion/renderer';

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
};

function asRenderFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(`Remotion render failed: ${message}`, 502, 'REMOTION_RENDER_FAILED');
}

export class RemotionRenderer implements VideoRenderer {
  private readonly resolver: RenderFileResolver;
  private readonly bundle: BundleFunction;
  private readonly selectComposition: SelectCompositionFunction;
  private readonly renderMedia: RenderMediaFunction;
  private readonly readOutput: typeof readFile;
  private bundlePromise: Promise<string> | null = null;

  constructor(options: RemotionRendererOptions = {}) {
    if (options.remotionPublicDir) configureRemotionBundle(options.remotionPublicDir);
    this.resolver = options.resolver ?? createFileStoreService(options.filesDir ?? './data/files').resolveFilePath;
    this.bundle = options.bundle ?? getRemotionBundle;
    this.selectComposition = options.selectComposition ?? remotionSelectComposition;
    this.renderMedia = options.renderMedia ?? remotionRenderMedia;
    this.readOutput = options.readFile ?? readFile;
  }

  async renderScenePreview(project: ProjectDetail, scene: Scene): Promise<Buffer> {
    return this.render({ ...project, bgmFileId: null }, [scene]);
  }

  async renderFullVideo(project: ProjectDetail, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>): Promise<Buffer> {
    return this.render(project, project.scenes, appendLog, reportProgress);
  }

  private async render(project: ProjectDetail, scenes: ReadonlyArray<Scene>, appendLog?: (message: string) => Promise<void>, reportProgress?: (percent: number) => Promise<void>): Promise<Buffer> {
    let staged: StagedRemotionRender | null = null;
    try {
      const serveUrl = await this.getBundle();
      staged = await stageRemotionRender({ serveUrl, project, scenes, resolver: this.resolver });
      if (appendLog) await appendLog('Remotion staging complete.');
      if (reportProgress) await reportProgress(10);
      const composition = await this.selectComposition({
        serveUrl,
        id: 'VideoComposition',
        inputProps: staged.inputProps,
      });
      if (appendLog) await appendLog('Remotion render started.');
      if (reportProgress) await reportProgress(15);

      let lastBucket = -1;
      let lastProgress = 15;
      let progressLogChain = Promise.resolve();
      let progressLogError: unknown;
      let progressReportChain = Promise.resolve();
      let progressReportError: unknown;
      const queueProgressLog = (message: string) => {
        if (!appendLog) return;
        progressLogChain = progressLogChain.then(async () => {
          try {
            await appendLog(message);
          } catch (error) {
            progressLogError ??= error;
          }
        });
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
      const onProgress = (progress: { progress: number }) => {
        const fraction = Math.max(0, Math.min(1, progress.progress));
        const bucket = Math.floor(fraction * 10);
        if (appendLog && bucket > lastBucket) {
          lastBucket = bucket;
          queueProgressLog(`Remotion render progress ${bucket * 10}%.`);
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
      };
      await this.renderMedia(renderOptions);
      await progressLogChain;
      await progressReportChain;
      if (progressLogError) throw progressLogError;
      if (progressReportError) throw progressReportError;
      const output = await this.readOutput(staged.outputPath);
      if (appendLog) await appendLog('Remotion render complete.');
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
}
