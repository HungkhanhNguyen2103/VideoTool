import AdmZip from 'adm-zip';
import path from 'node:path';
import type { ProjectDetail } from '../../../contracts/project';
import type { VideoDistributionPreview } from '../../../contracts/asset';
import { createFileStoreService } from '../file-store';
import { applyProjectVideoDistribution, applySceneAssets, assertSceneActive, getProject, patchProjectScene, pickVideoSceneIndexes } from '../project';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { expectedAssetType, MIME_BY_EXTENSION, type FlowSceneExport } from './docs';
import { probeVideoDuration } from '../../shared/ffprobe';
import { extractLastFrame } from '../../shared/ffmpeg-frames';
import { activeScenes, isSceneActive } from '../../../contracts/scene-active';

let storeFile = createFileStoreService('./data/files').storeFile;
let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;
let enqueueDepthMapJob: ((projectId: string, sceneId: string) => Promise<void>) | null = null;
let probeVideoDurationFn = probeVideoDuration;
let extractLastFrameFn = extractLastFrame;

export function configureAssetModule(
  filesDir: string,
  depthJobEnqueuer?: (projectId: string, sceneId: string) => Promise<void>,
  options: { probeVideoDuration?: typeof probeVideoDuration; extractLastFrame?: typeof extractLastFrame } = {},
): void {
  const service = createFileStoreService(filesDir);
  storeFile = service.storeFile;
  resolveFilePath = service.resolveFilePath;
  enqueueDepthMapJob = depthJobEnqueuer ?? null;
  probeVideoDurationFn = options.probeVideoDuration ?? probeVideoDuration;
  extractLastFrameFn = options.extractLastFrame ?? extractLastFrame;
}

async function requestDepthMaps(projectId: string, sceneIds: Iterable<string>): Promise<void> {
  if (!enqueueDepthMapJob) return;
  await Promise.all([...new Set(sceneIds)].map((sceneId) => enqueueDepthMapJob!(projectId, sceneId).catch(() => undefined)));
}

function slugifyTitle(value: string, sceneNumber: number): string {
  const slug = value
    .slice(0, 60)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug || `scene_${sceneNumber}`;
}

export function exportScenesJson(project: ProjectDetail): FlowSceneExport[] {
  return activeScenes(project.scenes.map((scene, index) => ({ scene, index, active: scene.active }))).map(({ scene, index }) => {
    const sceneNumber = index + 1;
    return {
      sceneId: sceneNumber,
      sceneNumber,
      title: slugifyTitle(scene.narration, sceneNumber),
      prompt: scene.visualPrompt,
      assetType: scene.assetType,
      motionPrompt: scene.motionPrompt,
    };
  });
}

function videoDistributionIndexes(project: ProjectDetail, targetPercent: number): Set<number> {
  const indexedActive = activeScenes(project.scenes.map((scene, index) => ({ scene, index, active: scene.active })));
  const activeIndexes = indexedActive.map(({ index }) => index);
  let sceneOffset = 0;
  const chapterSceneCounts = project.chapters.map((chapter) => {
    const count = chapter.scenesCount ?? 0;
    const activeCount = activeScenes(project.scenes.slice(sceneOffset, sceneOffset + count)).length;
    sceneOffset += count;
    return activeCount;
  });
  const activeVideoIndexes = pickVideoSceneIndexes({
    chapterSceneCounts,
    currentTypes: indexedActive.map(({ scene }) => scene.assetType),
    locked: indexedActive.map(({ scene }) => scene.assetFileId !== null || scene.videoKeyframeFileId !== null),
    targetPercent,
  });
  return new Set([...activeVideoIndexes].map((activeIndex) => activeIndexes[activeIndex]!));
}

export async function previewVideoDistribution(projectId: string, targetPercent: number): Promise<VideoDistributionPreview> {
  const project = await getProject(projectId);
  const videoIndexes = videoDistributionIndexes(project, targetPercent);
  const activeIndexedScenes = activeScenes(project.scenes.map((scene, index) => ({ scene, index, active: scene.active })));
  const changes = activeIndexedScenes.flatMap(({ scene, index }) => {
    const to: 'image' | 'video' = videoIndexes.has(index) ? 'video' : 'image';
    return scene.assetType === to ? [] : [{ sceneId: scene.id, sceneNumber: index + 1, from: scene.assetType, to }];
  });
  const lockedCount = activeIndexedScenes.filter(({ scene }) => scene.assetFileId !== null || scene.videoKeyframeFileId !== null).length;
  return {
    total: activeIndexedScenes.length,
    videoCount: videoIndexes.size,
    imageCount: activeIndexedScenes.length - videoIndexes.size,
    lockedCount,
    changes,
    videoSceneNumbers: activeIndexedScenes.flatMap(({ index }) => videoIndexes.has(index) ? [index + 1] : []),
    projectVersion: project.version,
  };
}

export async function applyVideoDistribution(projectId: string, targetPercent: number, expectedVersion: number): Promise<ProjectDetail> {
  const project = await getProject(projectId);
  const videoIndexes = videoDistributionIndexes(project, targetPercent);
  const activeIndexedScenes = activeScenes(project.scenes.map((scene, index) => ({ scene, index, active: scene.active })));
  const toVideoSceneIds = activeIndexedScenes.flatMap(({ scene, index }) => (
    videoIndexes.has(index) && scene.assetFileId === null && scene.videoKeyframeFileId === null && scene.assetType === 'image' ? [scene.id] : []
  ));
  const toImageSceneIds = activeIndexedScenes.flatMap(({ scene, index }) => (
    !videoIndexes.has(index) && scene.assetFileId === null && scene.videoKeyframeFileId === null && scene.assetType === 'video' ? [scene.id] : []
  ));
  if (toVideoSceneIds.length === 0 && toImageSceneIds.length === 0) return project;
  return applyProjectVideoDistribution(projectId, toVideoSceneIds, toImageSceneIds, expectedVersion);
}

export async function fitSceneToClip(projectId: string, sceneId: string, expectedVersion: number): Promise<ProjectDetail> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new AppError('Không tìm thấy cảnh.', 404, 'not_found');
  assertSceneActive(scene);
  if (scene.assetType !== 'video') throw new AppError('Chỉ scene video mới có thể kéo dài theo clip.', 422, 'FIT_TO_CLIP_NOT_VIDEO');
  if (scene.videoDurationSec === null) throw new AppError('Scene video chưa có thời lượng clip đã đo.', 422, 'VIDEO_DURATION_UNAVAILABLE');
  const durationSec = Math.ceil(scene.videoDurationSec);
  if (durationSec <= scene.durationSec) throw new AppError('Thời lượng clip không dài hơn thời lượng scene.', 422, 'CLIP_NOT_LONGER_THAN_SCENE');
  return patchProjectScene(projectId, sceneId, { durationSec }, expectedVersion);
}

const SCENE_FILE_PATTERN = /^SCENE_(\d{3})_([^/\\]+)\.([A-Za-z0-9]+)$/i;

export async function importAssetsFromZip(
  projectId: string,
  zipBuffer: Buffer,
): Promise<{ updated: number; skipped: string[]; skippedInactive: number }> {
  const project = await getProject(projectId);
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new AppError('ZIP file is invalid.', 422, 'INVALID_ZIP');
  }

  const skipped: string[] = [];
  let skippedInactive = 0;
  const updates = new Map<string, { sceneId: string; assetFileId?: string; videoKeyframeFileId?: string; videoTailFileId?: string | null; videoDurationSec?: number | null }>();
  let entries: ReturnType<AdmZip['getEntries']>;
  try {
    entries = zip.getEntries();
  } catch {
    throw new AppError('ZIP file is invalid.', 422, 'INVALID_ZIP');
  }
  for (const entry of entries) {
    const filename = entry.entryName;
    if (entry.isDirectory || filename.includes('/') || filename.includes('\\')) continue;
    const match = filename.match(SCENE_FILE_PATTERN);
    if (!match) {
      skipped.push(filename);
      continue;
    }
    const sceneNumber = Number.parseInt(match[1]!, 10);
    const extension = match[3]!.toLowerCase();
    const type = expectedAssetType(extension);
    const scene = project.scenes[sceneNumber - 1];
    if (!scene) {
      skipped.push(filename);
      continue;
    }
    if (!isSceneActive(scene)) {
      skipped.push(`${filename}: Scene đang tắt.`);
      skippedInactive += 1;
      continue;
    }
    const accepted = scene.assetType === 'video' ? type === 'video' || type === 'image' : type === scene.assetType;
    if (!type || !accepted) {
      skipped.push(filename);
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = entry.getData();
    } catch {
      skipped.push(filename);
      continue;
    }
    const summary = await storeFile({
      projectId,
      originalName: filename,
      mimeType: MIME_BY_EXTENSION[extension]!,
      buffer,
      purpose: 'reference',
    });
    const update = { ...updates.get(scene.id), sceneId: scene.id };
    if (scene.assetType === 'video' && type === 'image') {
      update.videoKeyframeFileId = summary.id;
    } else {
      update.assetFileId = summary.id;
      if (scene.assetType === 'video') {
        const stored = await resolveFilePath(projectId, summary.id);
        try {
          update.videoDurationSec = await probeVideoDurationFn(stored.absolutePath);
        } catch {
          skipped.push(filename);
          continue;
        }
        try {
          const tailBuffer = await extractLastFrameFn(stored.absolutePath);
          const tail = await storeFile({
            projectId,
            originalName: `${path.basename(filename, path.extname(filename))}.tail.png`,
            mimeType: 'image/png',
            buffer: tailBuffer,
            purpose: 'reference',
          });
          update.videoTailFileId = tail.id;
        } catch (error) {
          logger.warn(`Last-frame extraction failed for imported video ${filename}; using keyframe fallback.`, error);
          update.videoTailFileId = null;
        }
      }
    }
    updates.set(scene.id, update);
  }

  await applySceneAssets(projectId, [...updates.values()]);
  const depthSceneIds = [...updates.values()]
    .filter((update) => update.assetFileId && project.scenes.find((scene) => scene.id === update.sceneId)?.assetType === 'image')
    .map((update) => update.sceneId);
  await requestDepthMaps(projectId, depthSceneIds);
  return { updated: updates.size, skipped, skippedInactive };
}

export async function requestDepthMapsForImageScenes(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  await requestDepthMaps(projectId, activeScenes(project.scenes).filter((scene) => scene.assetType === 'image' && scene.assetFileId).map((scene) => scene.id));
}
