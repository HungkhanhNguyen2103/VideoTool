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
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { REMOTION_H264_CRF } from '../../config';
import { formatGiB, estimateRenderDiskUsage, inspectRenderDiskSpace, probeRenderDiskSpace } from './render-disk-preflight';

let storeFile = createFileStoreService('./data/files').storeFile;
let storeFileFromPath = createFileStoreService('./data/files').storeFileFromPath;
let listProjectFiles = createFileStoreService('./data/files').listProjectFiles;
let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;
let configuredFilesDir = './data/files';
let configuredRemotionPublicDir = './data/remotion-public';

export function configureVideoModule(filesDir: string, remotionPublicDir = './data/remotion-public', remotionConcurrency?: number, remotionCrf = REMOTION_H264_CRF): void {
  configuredFilesDir = filesDir;
  configuredRemotionPublicDir = remotionPublicDir;
  const store = createFileStoreService(filesDir);
  storeFile = store.storeFile;
  storeFileFromPath = store.storeFileFromPath;
  listProjectFiles = store.listProjectFiles;
  resolveFilePath = store.resolveFilePath;
  configureVideoTts(filesDir);
  configureWordTimingService(filesDir);
  configureDepthMapService(filesDir);
  configureLogoService(filesDir);
  configureSceneDurationService(filesDir);
  configureVideoRenderer(filesDir, remotionPublicDir, remotionConcurrency, remotionCrf);
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

export async function renderFullProject(projectId: string, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>, options?: { draft?: boolean }): Promise<void> {
  const project = await getProject(projectId);
  assertProjectRenderReady(project);
  const renderEntries = activeScenes(project.scenes.map((scene, originalIndex) => ({ scene, originalIndex, active: scene.active })));
  const renderScenes = renderEntries.map(({ scene }) => scene);
  const originalSceneNumbers = renderEntries.map(({ originalIndex }) => originalIndex + 1);
  const renderProject = { ...project, scenes: renderScenes };
  const draft = options?.draft === true;
  if (draft && renderProject.renderEngine === 'ffmpeg') throw new AppError('Draft render is available only with Remotion.', 422, 'DRAFT_REQUIRES_REMOTION');
  const renderer = getVideoRenderer(renderProject.renderEngine);
  const safeProjectId = projectId.replace(/[^A-Za-z0-9_-]/g, '_');
  const renderParent = path.dirname(path.resolve(configuredFilesDir));
  await mkdir(renderParent, { recursive: true });
  const filesPath = path.resolve(configuredFilesDir);
  const stagePath = path.resolve(configuredRemotionPublicDir);
  const [renderVolume, storeVolume, stageVolume] = await Promise.all([
    probeRenderDiskSpace(renderParent),
    probeRenderDiskSpace(filesPath),
    renderProject.renderEngine === 'remotion' ? probeRenderDiskSpace(stagePath) : Promise.resolve(null),
  ]);
  const projectFiles = await listProjectFiles(projectId);
  const fileSizes = new Map(projectFiles.map((file) => [file.id, file.sizeBytes]));
  const referencedFileIds = [
    ...renderScenes.flatMap((scene) => [scene.assetFileId, scene.videoKeyframeFileId, scene.depthMap?.fileId, scene.audioFileId, scene.sfxFileId]),
    project.bgmFileId,
    project.logoFileId,
  ].filter((fileId): fileId is string => Boolean(fileId));
  const mediaAssetBytes = referencedFileIds.reduce((total, fileId) => total + (fileSizes.get(fileId) ?? 0), 0);
  const normalizedSfxBytes = renderScenes.reduce((total, scene) => {
    if (!scene.sfxFileId) return total;
    const sourceBytes = fileSizes.get(scene.sfxFileId) ?? 0;
    const pcmBytes = scene.durationSec * 48_000 * 2 * 2;
    return total + Math.max(sourceBytes * 10, pcmBytes);
  }, 0);
  const diskUsage = estimateRenderDiskUsage({
    durationSeconds: renderScenes.reduce((total, scene) => total + scene.durationSec, 0),
    mediaAssetBytes,
    normalizedSfxBytes,
    engine: renderProject.renderEngine,
    hasBgm: Boolean(project.bgmFileId),
    renderAndStoreShareVolume: renderVolume.device === storeVolume.device,
    renderAndStageShareVolume: renderVolume.device === stageVolume?.device,
  });
  const diskRequirements = [
    { path: renderParent, label: 'Render và file tạm', requiredBytes: diskUsage.renderVolumeRequiredBytes },
    ...(diskUsage.remotionStageVolumeRequiredBytes > 0 ? [{ path: stagePath, label: 'Media Remotion', requiredBytes: diskUsage.remotionStageVolumeRequiredBytes }] : []),
    ...(diskUsage.storeCopyVolumeRequiredBytes > 0 ? [{ path: filesPath, label: 'Bản sao lưu file khi khác ổ (EXDEV)', requiredBytes: diskUsage.storeCopyVolumeRequiredBytes }] : []),
  ];
  const probedVolumes = new Map([
    [path.resolve(renderParent), renderVolume],
    [filesPath, storeVolume],
    ...(stageVolume ? [[stagePath, stageVolume] as const] : []),
  ]);
  const diskCheck = await inspectRenderDiskSpace(diskRequirements, async (directory) => {
    return probedVolumes.get(path.resolve(directory)) ?? probeRenderDiskSpace(directory);
  });
  const diskLog = `Dự tính dung lượng render: đầu ra ${formatGiB(diskUsage.outputBytes)} GiB, media ${formatGiB(mediaAssetBytes)} GiB, SFX chuẩn hóa ${formatGiB(normalizedSfxBytes)} GiB; ${diskCheck.volumes.map((volume) => `${volume.path} cần ${formatGiB(volume.requiredBytes)} GiB, còn ${formatGiB(volume.availableBytes)} GiB`).join('; ')}.`;
  try {
    await appendLog(diskLog);
  } catch (error) {
    logger.warn(`Could not append render disk estimate for project ${projectId}.`, error);
  }
  if (diskCheck.insufficient[0]) throw diskCheck.insufficient[0].error;
  const tempDirectory = await mkdtemp(path.join(renderParent, `video-tool-render-${safeProjectId}-`));
  const outputPath = path.join(tempDirectory, draft ? 'render-draft.mp4' : 'render.mp4');
  let keepTempDirectory = false;
  try {
    const renderOptions: RenderVideoOptions = {
      outputPath,
      ...(draft ? { draft: true } : {}),
      originalSceneNumbers,
      originalSceneCount: project.scenes.length,
    };
    await renderer.renderFullVideo(renderProject, appendLog, reportProgress, renderOptions);
    let stored;
    try {
      stored = await storeFileFromPath({
        projectId,
        originalName: draft ? 'render-draft.mp4' : 'render.mp4',
        mimeType: 'video/mp4',
        sourcePath: outputPath,
        purpose: draft ? 'render-draft' : 'render',
      });
    } catch (storageError) {
      const failedRoot = path.join(renderParent, 'render-failed');
      let retainedPath = outputPath;
      let failedDirectory: string | undefined;
      try {
        await mkdir(failedRoot, { recursive: true });
        failedDirectory = await mkdtemp(path.join(failedRoot, `${safeProjectId}-${Date.now()}-`));
        retainedPath = path.join(failedDirectory, 'render.mp4');
        await rename(outputPath, retainedPath);
      } catch (preserveError) {
        keepTempDirectory = true;
        if (failedDirectory) await rm(failedDirectory, { recursive: true, force: true }).catch(() => undefined);
        retainedPath = outputPath;
        logger.error(`Could not retain completed render for project ${projectId}.`, preserveError);
      }
      try {
        await appendLog(`Render đã xong nhưng lưu thất bại; file giữ tại: ${retainedPath}`);
      } catch (logError) {
        logger.warn(`Could not append render-storage failure path for project ${projectId}.`, logError);
      }
      throw storageError;
    }
    try {
      if (draft) await setProjectDraftRenderFile(projectId, stored.id);
      else await setProjectRenderFile(projectId, stored.id, renderScenes.map((scene) => scene.id));
    } catch (linkError) {
      const storedPath = path.join(path.resolve(configuredFilesDir), stored.storedPath);
      try {
        await appendLog(`Render đã lưu thành công nhưng chưa gắn vào dự án; mã tệp: ${stored.id}; đường dẫn: ${storedPath}`);
      } catch (logError) {
        logger.warn(`Could not append project-link failure path for render file ${stored.id}.`, logError);
      }
      throw linkError;
    }
  } finally {
    if (!keepTempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function renderScenePreviewBuffer(projectId: string, sceneId: string): Promise<Buffer> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  assertSceneActive(scene);
  return getVideoRenderer(project.renderEngine).renderScenePreview(project, scene);
}

export type { TtsOptions };
