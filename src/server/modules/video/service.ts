import { AppError, NotFound } from '../../shared/errors';
import { logger } from '../../shared/logger';
import type { ProjectDetail } from '../../../contracts/project';
import { createFileStoreService } from '../file-store';
import { getProject, patchProjectScene, setProjectBgm, setProjectRenderFile } from '../project';
import { getFreesoundClient } from '../../shared/freesound';
import { getVideoRenderer, configureVideoRenderer } from './index';
import { configureVideoTts, generateProjectVoiceovers, generateSceneVoiceover } from './tts-service';
import type { TtsOptions } from '../../shared/tts';

let storeFile = createFileStoreService('./data/files').storeFile;

export function configureVideoModule(filesDir: string, remotionPublicDir = './data/remotion-public'): void {
  const store = createFileStoreService(filesDir);
  storeFile = store.storeFile;
  configureVideoTts(filesDir);
  configureVideoRenderer(filesDir, remotionPublicDir);
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

export async function renderFullProject(projectId: string, appendLog: (message: string) => Promise<void>): Promise<void> {
  const project = await getProject(projectId);
  assertProjectRenderReady(project);
  const output = await getVideoRenderer(project.renderEngine).renderFullVideo(project, appendLog);
  const stored = await storeFile({ projectId, originalName: 'render.mp4', mimeType: 'video/mp4', buffer: output, purpose: 'render' });
  await setProjectRenderFile(projectId, stored.id);
}

export async function renderScenePreviewBuffer(projectId: string, sceneId: string): Promise<Buffer> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  return getVideoRenderer(project.renderEngine).renderScenePreview(project, scene);
}

export type { TtsOptions };
