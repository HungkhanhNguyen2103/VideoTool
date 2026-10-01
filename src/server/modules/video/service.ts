import { AppError, NotFound } from '../../shared/errors';
import { logger } from '../../shared/logger';
import type { ProjectDetail } from '../../../contracts/project';
import { createFileStoreService } from '../file-store';
import { getProject, patchProjectScene, setProjectBgm, setProjectDraftRenderFile, setProjectRenderFile } from '../project';
import { getFreesoundClient } from '../../shared/freesound';
import { getVideoRenderer, configureVideoRenderer } from './index';
import { configureVideoTts, generateProjectVoiceovers, generateSceneVoiceover } from './tts-service';
import type { TtsOptions } from '../../shared/tts';
import { configureWordTimingService } from './word-timing-service';
import { configureDepthMapService } from './depth-map-service';
import type { RenderVideoOptions } from './ffmpeg-renderer';

let storeFile = createFileStoreService('./data/files').storeFile;

export function configureVideoModule(filesDir: string, remotionPublicDir = './data/remotion-public', remotionConcurrency?: number): void {
  const store = createFileStoreService(filesDir);
  storeFile = store.storeFile;
  configureVideoTts(filesDir);
  configureWordTimingService(filesDir);
  configureDepthMapService(filesDir);
  configureVideoRenderer(filesDir, remotionPublicDir, remotionConcurrency);
}

export { generateProjectVoiceovers, generateSceneVoiceover };

export function assertProjectRenderReady(project: Pick<ProjectDetail, 'scenes'>): void {
  if (project.scenes.length === 0) throw new AppError('Scenes are not ready: the project has no scenes.', 422, 'SCENES_NOT_READY');
  const missing = project.scenes
    .map((scene, index) => scene.assetFileId ? null : index + 1)
    .filter((number): number is number => number !== null);
  if (missing.length > 0) throw new AppError(`Scenes are not ready: ${missing.join(', ')}.`, 422, 'SCENES_NOT_READY');
}

export async function generateSceneSfx(projectId: string, sceneId: string): Promise<void> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  if (!scene.sfxPrompt.trim()) {
    logger.warn(`SFX skipped for scene ${sceneId}: prompt is empty.`);
    return;
  }
  const audio = await getFreesoundClient().searchAndDownloadSfx(scene.sfxPrompt);
  if (!audio) {
    logger.warn(`SFX skipped for scene ${sceneId}: Freesound returned no result.`);
    return;
  }
  const stored = await storeFile({ projectId, originalName: `${scene.id}.mp3`, mimeType: 'audio/mpeg', buffer: audio, purpose: 'sfx' });
  await patchProjectScene(projectId, sceneId, { sfxFileId: stored.id });
}

export async function generateProjectSfx(projectId: string, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>): Promise<void> {
  const project = await getProject(projectId);
  const failed: number[] = [];
  for (const [index, scene] of project.scenes.entries()) {
    const sceneNumber = index + 1;
    await appendLog(`Generating SFX for scene ${sceneNumber}/${project.scenes.length}…`);
    try {
      await generateSceneSfx(projectId, scene.id);
    } catch (error) {
      failed.push(sceneNumber);
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`SFX generation failed for scene ${sceneNumber}.`, error);
      await appendLog(`Scene ${sceneNumber} failed: ${message}`);
    }
    await reportProgress(Math.round(((index + 1) / project.scenes.length) * 100));
  }
  if (failed.length > 0) await appendLog(`SFX failed for scenes: ${failed.join(', ')}`);
}

export async function generateProjectBgm(projectId: string, mood: string): Promise<void> {
  const normalizedMood = mood.trim();
  if (!normalizedMood) {
    logger.warn(`BGM skipped for project ${projectId}: mood is empty.`);
    return;
  }
  const audio = await getFreesoundClient().searchAndDownloadBgm(normalizedMood);
  if (!audio) {
    logger.warn(`BGM skipped for project ${projectId}: Freesound returned no result.`);
    return;
  }
  const stored = await storeFile({ projectId, originalName: 'bgm.mp3', mimeType: 'audio/mpeg', buffer: audio, purpose: 'bgm' });
  await setProjectBgm(projectId, normalizedMood, stored.id);
}

export async function renderFullProject(projectId: string, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>, options?: RenderVideoOptions): Promise<void> {
  const project = await getProject(projectId);
  assertProjectRenderReady(project);
  const draft = options?.draft === true;
  if (draft && project.renderEngine === 'ffmpeg') throw new AppError('Draft render is available only with Remotion.', 422, 'DRAFT_REQUIRES_REMOTION');
  const renderer = getVideoRenderer(project.renderEngine);
  const output = draft
    ? await renderer.renderFullVideo(project, appendLog, reportProgress, { draft: true })
    : await renderer.renderFullVideo(project, appendLog, reportProgress);
  const stored = await storeFile({
    projectId,
    originalName: draft ? 'render-draft.mp4' : 'render.mp4',
    mimeType: 'video/mp4',
    buffer: output,
    purpose: draft ? 'render-draft' : 'render',
  });
  if (draft) await setProjectDraftRenderFile(projectId, stored.id);
  else await setProjectRenderFile(projectId, stored.id);
}

export async function renderScenePreviewBuffer(projectId: string, sceneId: string): Promise<Buffer> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  return getVideoRenderer(project.renderEngine).renderScenePreview(project, scene);
}

export type { TtsOptions };
