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

  async renderFullVideo(project: ProjectDetail, appendLog: (message: string) => Promise<void>): Promise<Buffer> {
    return this.render(project, project.scenes, appendLog);
  }

  private async render(project: ProjectDetail, scenes: ReadonlyArray<Scene>, appendLog?: (message: string) => Promise<void>): Promise<Buffer> {
    let staged: StagedRemotionRender | null = null;
    try {
      const serveUrl = await this.getBundle();
      staged = await stageRemotionRender({ serveUrl, project, scenes, resolver: this.resolver });
      if (appendLog) await appendLog('Remotion staging complete.');
      const composition = await this.selectComposition({
        serveUrl,
        id: 'VideoComposition',
        inputProps: staged.inputProps,
      });
      if (appendLog) await appendLog('Remotion render started.');

      let lastBucket = -1;
      let progressLogChain = Promise.resolve();
      let progressLogError: unknown;
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
      const onProgress = (progress: { progress: number }) => {
        if (!appendLog) return;
        const bucket = Math.floor(Math.max(0, Math.min(1, progress.progress)) * 10);
        if (bucket > lastBucket) {
          lastBucket = bucket;
          queueProgressLog(`Remotion render progress ${bucket * 10}%.`);
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
      if (progressLogError) throw progressLogError;
      const output = await this.readOutput(staged.outputPath);
      if (appendLog) await appendLog('Remotion render complete.');
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
