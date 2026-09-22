import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { newId } from '../../shared/ids';
import { logger } from '../../shared/logger';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { resolveRemotionAssets, type RenderFileResolver } from './remotion-props';

export type StageRemotionRenderOptions = {
  serveUrl: string;
  project: Pick<ProjectDetail, 'id' | 'renderSettings' | 'bgmFileId'>;
  scenes: ReadonlyArray<Scene>;
  resolver: RenderFileResolver;
  renderId?: string;
};

export type StagedRemotionRender = {
  renderId: string;
  renderDir: string;
  outputPath: string;
  inputProps: Awaited<ReturnType<typeof resolveRemotionAssets>>['inputProps'];
  cleanup: () => Promise<void>;
};

export async function stageRemotionRender(options: StageRemotionRenderOptions): Promise<StagedRemotionRender> {
  const renderId = options.renderId ?? newId();
  const resolved = await resolveRemotionAssets(options.project, options.scenes, renderId, options.resolver);
  const renderDir = path.join(options.serveUrl, 'public', 'renders', renderId);
  const outputPath = path.join(options.serveUrl, `render-${renderId}.mp4`);
  await mkdir(renderDir, { recursive: true });
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(renderDir, { recursive: true, force: true });
  };

  try {
    for (const source of resolved.sources) {
      await copyFile(source.absolutePath, path.join(renderDir, path.basename(source.relativePath)));
    }
    return { renderId, renderDir, outputPath, inputProps: resolved.inputProps, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      logger.warn('Remotion staging cleanup failed.', cleanupError);
    }
    throw error;
  }
}
