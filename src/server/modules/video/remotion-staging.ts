import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, parse, posix } from 'node:path';
import path from 'node:path';
import { newId } from '../../shared/ids';
import { logger } from '../../shared/logger';
import type { Scene } from '../../../contracts/project';
import { resolveRemotionAssets, type RemotionProjectSettings, type RenderFileResolver } from './remotion-props';
import { normalizeSfxForRender } from './sfx-audio';

export type StageRemotionRenderOptions = {
  serveUrl: string;
  project: RemotionProjectSettings;
  scenes: ReadonlyArray<Scene>;
  resolver: RenderFileResolver;
  renderId?: string;
  keywordContextScenes?: ReadonlyArray<Scene>;
  normalizeSfx?: (sourcePath: string, outputPath: string) => Promise<void>;
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
  const resolved = await resolveRemotionAssets(options.project, options.scenes, renderId, options.resolver, { keywordContextScenes: options.keywordContextScenes });
  const renderDir = path.join(options.serveUrl, 'public', 'renders', renderId);
  const outputPath = path.join(options.serveUrl, `render-${renderId}.mp4`);
  await mkdir(renderDir, { recursive: true });
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(renderDir, { recursive: true, force: true });
  };
  const normalizeSfx = options.normalizeSfx ?? ((sourcePath, outputPath) => normalizeSfxForRender({
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    inputPath: sourcePath,
    outputPath,
  }));

  try {
    const sfxSources = new Set<string>();
    const stagedScenes = [];
    for (const scene of resolved.inputProps.scenes) {
      if (!scene.sfxRelPath) {
        stagedScenes.push(scene);
        continue;
      }
      const source = resolved.sources.find((candidate) => candidate.relativePath === scene.sfxRelPath);
      if (!source) throw new Error(`Staged SFX source is missing for scene ${scene.id}.`);
      sfxSources.add(source.relativePath);
      const parsed = parse(scene.sfxRelPath);
      const relativePath = posix.join(posix.dirname(scene.sfxRelPath), `${parsed.name}-normalized.wav`);
      await normalizeSfx(source.absolutePath, path.join(renderDir, basename(relativePath)));
      stagedScenes.push({ ...scene, sfxRelPath: relativePath });
    }
    for (const source of resolved.sources) {
      if (sfxSources.has(source.relativePath)) continue;
      await copyFile(source.absolutePath, path.join(renderDir, path.basename(source.relativePath)));
    }
    const inputProps = { ...resolved.inputProps, scenes: stagedScenes };
    return { renderId, renderDir, outputPath, inputProps, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      logger.warn('Remotion staging cleanup failed.', cleanupError);
    }
    throw error;
  }
}
