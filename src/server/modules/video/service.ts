import { AppError, NotFound } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { access } from 'node:fs/promises';
import type { ProjectDetail } from '../../../contracts/project';
import { createFileStoreService } from '../file-store';
import { assertSceneActive, getProject, patchProjectScene, setProjectBgm, setProjectDraftRenderFile, setProjectRenderFile } from '../project';
import { getFreesoundClient } from '../../shared/freesound';
import { getVideoRenderer, configureVideoRenderer } from './index';
import { configureVideoTts, generateProjectVoiceovers, generateSceneVoiceover } from './tts-service';
import type { TtsOptions } from '../../shared/tts';
import { configureWordTimingService } from './word-timing-service';
import { configureDepthMapService } from './depth-map-service';
import { configureLogoService } from './logo-service';
import { configureSceneDurationService } from './scene-duration-service';
import type { RenderVideoOptions } from './ffmpeg-renderer';
import { activeScenes, countInactiveScenes } from '../../../contracts/scene-active';

let storeFile = createFileStoreService('./data/files').storeFile;
let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;

export function configureVideoModule(filesDir: string, remotionPublicDir = './data/remotion-public', remotionConcurrency?: number): void {
  const store = createFileStoreService(filesDir);
  storeFile = store.storeFile;
  resolveFilePath = store.resolveFilePath;
  configureVideoTts(filesDir);
  configureWordTimingService(filesDir);
  configureDepthMapService(filesDir);
  configureLogoService(filesDir);
  configureSceneDurationService(filesDir);
  configureVideoRenderer(filesDir, remotionPublicDir, remotionConcurrency);
}

export { generateProjectVoiceovers, generateSceneVoiceover };

export function assertProjectRenderReady(project: Pick<ProjectDetail, 'scenes'>): void {
  const scenes = activeScenes(project.scenes.map((scene, originalIndex) => ({ scene, originalIndex, active: scene.active })));
  if (scenes.length === 0) throw new AppError('Không có scene nào đang bật để render.', 422, 'SCENES_NOT_READY');
  const missing = scenes
    .map(({ scene, originalIndex }) => scene.assetFileId ? null : originalIndex + 1)
    .filter((number): number is number => number !== null);
  if (missing.length > 0) throw new AppError(`Scenes are not ready: ${missing.join(', ')}.`, 422, 'SCENES_NOT_READY');
}

export type SfxSceneOutcome = {
  sceneId: string;
  sceneNumber: number;
  outcome: 'generated' | 'skipped-no-prompt' | 'skipped-existing' | `failed:${string}`;
  reason?: string;
  sound?: { id: number; name: string; tags: string[]; duration: number; avg_rating: number; num_ratings: number };
};

export type SfxBatchSummary = {
  generated: number;
  failed: number;
  skippedNoPrompt: number;
  skippedExisting: number;
  rateLimitedStop: boolean;
  counts: Record<string, number>;
  outcomes: SfxSceneOutcome[];
  skippedInactive: number;
};

export async function generateSceneSfx(projectId: string, sceneId: string, sceneNumber = 1): Promise<SfxSceneOutcome> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  assertSceneActive(scene);
  if (!scene.sfxPrompt.trim()) {
    logger.warn(`SFX skipped for scene ${sceneId}: prompt is empty.`);
    return { sceneId, sceneNumber, outcome: 'skipped-no-prompt', reason: 'empty-prompt' };
  }
  const result = await getFreesoundClient().searchSfx(scene.sfxPrompt);
  if (result.reason !== 'ok' || !result.audio) {
    logger.warn(`SFX failed for scene ${sceneNumber}: ${result.reason}.`);
    return { sceneId, sceneNumber, outcome: `failed:${result.reason}`, reason: result.detail ?? result.reason };
  }
  const stored = await storeFile({ projectId, originalName: `${scene.id}.mp3`, mimeType: 'audio/mpeg', buffer: result.audio, purpose: 'sfx' });
  await patchProjectScene(projectId, sceneId, { sfxFileId: stored.id });
  const sound = result.sound ? {
    id: result.sound.id,
    name: result.sound.name,
    tags: result.sound.tags,
    duration: result.sound.duration,
    avg_rating: result.sound.avg_rating,
    num_ratings: result.sound.num_ratings,
  } : undefined;
  return { sceneId, sceneNumber, outcome: 'generated', ...(sound ? { sound } : {}) };
}

export async function generateProjectSfx(
  projectId: string,
  appendLog: (message: string) => Promise<void>,
  reportProgress: (percent: number) => Promise<void>,
  options: { onlyMissing?: boolean } = {},
): Promise<SfxBatchSummary> {
  const project = await getProject(projectId);
  const scopedScenes = project.scenes.map((scene, index) => ({ scene, index, active: scene.active }));
  const scenesToProcess = activeScenes(scopedScenes);
  const summary: SfxBatchSummary = { generated: 0, failed: 0, skippedNoPrompt: 0, skippedExisting: 0, rateLimitedStop: false, counts: {}, outcomes: [], skippedInactive: countInactiveScenes(scopedScenes) };
  if (scenesToProcess.length === 0) {
    await appendLog(`Không có scene nào đang bật để tạo SFX; skippedInactive: ${summary.skippedInactive}.`);
    await reportProgress(100);
    await appendLog(`SFX summary: ${JSON.stringify(summary)}.`);
    return summary;
  }
  let consecutiveRateLimits = 0;
  const remember = (result: SfxSceneOutcome) => {
    summary.outcomes.push(result);
    if (result.outcome === 'generated') summary.generated += 1;
    else if (result.outcome === 'skipped-no-prompt') summary.skippedNoPrompt += 1;
    else if (result.outcome === 'skipped-existing') summary.skippedExisting += 1;
    else {
      summary.failed += 1;
      const reason = result.outcome.slice('failed:'.length);
      summary.counts[reason] = (summary.counts[reason] ?? 0) + 1;
    }
  };

  for (const [activeIndex, { scene, index }] of scenesToProcess.entries()) {
    const sceneNumber = index + 1;
    if (options.onlyMissing && scene.sfxFileId) {
      try {
        const file = await resolveFilePath(project.id, scene.sfxFileId);
        if (file.purpose === 'sfx' && file.mimeType.startsWith('audio/')) {
          await access(file.absolutePath);
          const result: SfxSceneOutcome = { sceneId: scene.id, sceneNumber, outcome: 'skipped-existing' };
          remember(result);
          await appendLog(`SFX Scene ${String(sceneNumber).padStart(2, '0')}: skipped-existing (valid SFX file).`);
          await reportProgress(Math.round(((activeIndex + 1) / scenesToProcess.length) * 100));
          continue;
        }
      } catch {
        // Missing/corrupt file references are eligible for regeneration.
      }
    }

    if (!scene.sfxPrompt.trim()) {
      const result: SfxSceneOutcome = { sceneId: scene.id, sceneNumber, outcome: 'skipped-no-prompt', reason: 'empty-prompt' };
      remember(result);
      await appendLog(`SFX Scene ${String(sceneNumber).padStart(2, '0')}: skipped-no-prompt.`);
      await reportProgress(Math.round(((activeIndex + 1) / scenesToProcess.length) * 100));
      continue;
    }

    await appendLog(`Generating SFX for scene ${sceneNumber}/${project.scenes.length}…`);
    try {
      const result = await generateSceneSfx(projectId, scene.id, sceneNumber);
      remember(result);
      if (result.outcome === 'generated') {
        consecutiveRateLimits = 0;
        const sound = result.sound;
        const attribution = sound ? ` Freesound #${sound.id} “${sound.name}”; tags: ${sound.tags.join(', ')}; ${sound.duration}s; rating ${sound.avg_rating} (${sound.num_ratings}).` : '';
        await appendLog(`SFX Scene ${String(sceneNumber).padStart(2, '0')}: generated.${attribution}`);
      } else {
        await appendLog(`SFX Scene ${String(sceneNumber).padStart(2, '0')}: ${result.outcome}${result.reason ? ` — ${result.reason}` : ''}.`);
        if (result.outcome === 'failed:rate-limited') consecutiveRateLimits += 1;
        else consecutiveRateLimits = 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`SFX generation failed for scene ${sceneNumber}.`, error);
      const outcome: SfxSceneOutcome = { sceneId: scene.id, sceneNumber, outcome: 'failed:download-error', reason: message };
      remember(outcome);
      consecutiveRateLimits = 0;
      await appendLog(`SFX Scene ${String(sceneNumber).padStart(2, '0')}: failed:download-error — ${message}`);
    }
    await reportProgress(Math.round(((activeIndex + 1) / scenesToProcess.length) * 100));
    if (consecutiveRateLimits >= 3) {
      summary.rateLimitedStop = true;
      await appendLog('Freesound đã chặn tạm thời — thử lại sau');
      await reportProgress(100);
      break;
    }
  }
  summary.skippedInactive = countInactiveScenes(scopedScenes);
  const noResults = summary.counts['no-results'] ?? 0;
  const rateLimited = summary.counts['rate-limited'] ?? 0;
  const httpErrors = summary.counts['http-error'] ?? 0;
  const downloadErrors = summary.counts['download-error'] ?? 0;
  const emptyQueries = summary.counts['empty-query'] ?? 0;
  await appendLog(`SFX: ${summary.generated} ok, ${rateLimited} rate-limited, ${noResults} không tìm thấy, ${summary.skippedNoPrompt} không có prompt${httpErrors ? `, ${httpErrors} lỗi HTTP` : ''}${downloadErrors ? `, ${downloadErrors} lỗi tải` : ''}${emptyQueries ? `, ${emptyQueries} query rỗng` : ''}${summary.skippedExisting ? `, ${summary.skippedExisting} đã có SFX` : ''}; skippedInactive: ${summary.skippedInactive}.`);
  return summary;
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
  const renderEntries = activeScenes(project.scenes.map((scene, originalIndex) => ({ scene, originalIndex, active: scene.active })));
  const renderScenes = renderEntries.map(({ scene }) => scene);
  const originalSceneNumbers = renderEntries.map(({ originalIndex }) => originalIndex + 1);
  const renderProject = { ...project, scenes: renderScenes };
  const draft = options?.draft === true;
  if (draft && renderProject.renderEngine === 'ffmpeg') throw new AppError('Draft render is available only with Remotion.', 422, 'DRAFT_REQUIRES_REMOTION');
  const renderer = getVideoRenderer(renderProject.renderEngine);
  const output = draft
    ? await renderer.renderFullVideo(renderProject, appendLog, reportProgress, { draft: true, originalSceneNumbers, originalSceneCount: project.scenes.length })
    : await renderer.renderFullVideo(renderProject, appendLog, reportProgress, { originalSceneNumbers, originalSceneCount: project.scenes.length });
  const stored = await storeFile({
    projectId,
    originalName: draft ? 'render-draft.mp4' : 'render.mp4',
    mimeType: 'video/mp4',
    buffer: output,
    purpose: draft ? 'render-draft' : 'render',
  });
  if (draft) await setProjectDraftRenderFile(projectId, stored.id);
  else await setProjectRenderFile(projectId, stored.id, renderScenes.map((scene) => scene.id));
}

export async function renderScenePreviewBuffer(projectId: string, sceneId: string): Promise<Buffer> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  assertSceneActive(scene);
  return getVideoRenderer(project.renderEngine).renderScenePreview(project, scene);
}

export type { TtsOptions };
