import AdmZip from 'adm-zip';
import path from 'node:path';
import type { ProjectDetail } from '../../../contracts/project';
import type { SceneAssetSlot, SceneAssetsResponse, SceneAssetUpdated, VideoDistributionPreview } from '../../../contracts/asset';
import type { FileSummary } from '../../../contracts/file';
import { createFileStoreService } from '../file-store';
import { applyProjectVideoDistribution, applySceneAssets, assertSceneActive, getProject, patchProjectScene, pickVideoSceneIndexes } from '../project';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { expectedAssetType, MIME_BY_EXTENSION, type FlowSceneExport } from './docs';
import { probeVideoDuration } from '../../shared/ffprobe';
import { extractLastFrame } from '../../shared/ffmpeg-frames';
import { activeScenes, isSceneActive } from '../../../contracts/scene-active';
import { deriveReferenceTags } from '../../../contracts/visual-style-pack';

let storeFile = createFileStoreService('./data/files').storeFile;
let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;
let deleteFile = createFileStoreService('./data/files').deleteFile;
let enqueueDepthMapJob: ((projectId: string, sceneId: string) => Promise<void>) | null = null;
let probeVideoDurationFn = probeVideoDuration;
let extractLastFrameFn = extractLastFrame;
let applySceneAssetsFn = applySceneAssets;

export function configureAssetModule(
  filesDir: string,
  depthJobEnqueuer?: (projectId: string, sceneId: string) => Promise<void>,
  options: { probeVideoDuration?: typeof probeVideoDuration; extractLastFrame?: typeof extractLastFrame; applySceneAssets?: typeof applySceneAssets; deleteFile?: (id: string) => Promise<void> } = {},
): void {
  const service = createFileStoreService(filesDir);
  storeFile = service.storeFile;
  resolveFilePath = service.resolveFilePath;
  deleteFile = options.deleteFile ?? service.deleteFile;
  enqueueDepthMapJob = depthJobEnqueuer ?? null;
  probeVideoDurationFn = options.probeVideoDuration ?? probeVideoDuration;
  extractLastFrameFn = options.extractLastFrame ?? extractLastFrame;
  applySceneAssetsFn = options.applySceneAssets ?? applySceneAssets;
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

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 200 * 1024 * 1024;

type AssetInputFile = Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'buffer'>;
type ClassifiedUpload = { file: AssetInputFile; type: 'image' | 'video'; extension: string };

function classifyUpload(file: AssetInputFile): ClassifiedUpload {
  if (file.buffer.byteLength === 0) throw new AppError('Tệp tải lên đang trống.', 422, 'EMPTY_FILE');
  const extension = path.extname(file.originalname).slice(1).toLowerCase();
  const type = expectedAssetType(extension);
  if (!type) throw new AppError('Định dạng tệp không được hỗ trợ.', 422, 'INVALID_FILE_TYPE');
  if (MIME_BY_EXTENSION[extension] !== file.mimetype) throw new AppError('Loại tệp không khớp với phần mở rộng.', 422, 'FILE_TYPE_MISMATCH');
  if (type === 'image' && file.buffer.byteLength > MAX_IMAGE_BYTES) throw new AppError('Ảnh vượt quá giới hạn 25 MB.', 422, 'IMAGE_TOO_LARGE');
  return { file, type, extension };
}

function validateSceneUpload(scene: ProjectDetail['scenes'][number], files: AssetInputFile[]): ClassifiedUpload[] {
  if (files.length === 0) throw new AppError('Vui lòng chọn ít nhất một tệp.', 422, 'FILES_REQUIRED');
  if (files.length > 2 || files.reduce((sum, file) => sum + file.buffer.byteLength, 0) > MAX_REQUEST_BYTES) {
    throw new AppError('Tổng dung lượng tải lên vượt quá 200 MB.', 422, 'REQUEST_TOO_LARGE');
  }
  const classified = files.map(classifyUpload);
  if (scene.assetType === 'image') {
    if (classified.length !== 1 || classified[0]?.type !== 'image') throw new AppError('Scene ảnh chỉ nhận đúng một tệp ảnh.', 422, 'IMAGE_SCENE_REQUIRES_IMAGE');
    return classified;
  }
  if (classified.length === 2 && classified[0]?.type === classified[1]?.type) throw new AppError('Chỉ được chọn một clip và một keyframe.', 422, 'DUPLICATE_ASSET_KIND');
  return classified;
}

async function storeReference(projectId: string, file: AssetInputFile): Promise<FileSummary> {
  return storeFile({ projectId, originalName: file.originalname, mimeType: file.mimetype, buffer: file.buffer, purpose: 'reference' });
}

class VideoProbeError extends Error {
  constructor(readonly cause: unknown) { super('Video probe failed.'); }
}

async function prepareClip(projectId: string, file: AssetInputFile, stored: FileSummary): Promise<{ durationSec: number; tail: FileSummary | null }> {
  const resolved = await resolveFilePath(projectId, stored.id);
  let durationSec: number;
  try { durationSec = await probeVideoDurationFn(resolved.absolutePath); }
  catch (error) { throw new VideoProbeError(error); }
  try {
    const buffer = await extractLastFrameFn(resolved.absolutePath);
    const tail = await storeFile({
      projectId,
      originalName: `${path.basename(file.originalname, path.extname(file.originalname))}.tail.png`,
      mimeType: 'image/png', buffer, purpose: 'reference',
    });
    return { durationSec, tail };
  } catch (error) {
    logger.warn(`Last-frame extraction failed for uploaded video ${file.originalname}; using keyframe fallback.`, error);
    return { durationSec, tail: null };
  }
}

async function attachFileToScene(
  projectId: string,
  scene: ProjectDetail['scenes'][number],
  item: ClassifiedUpload,
  storedFiles: FileSummary[],
): Promise<SceneAssetUpdated> {
  const summary = await storeReference(projectId, item.file);
  storedFiles.push(summary);
  if (scene.assetType === 'video' && item.type === 'image') return { videoKeyframeFileId: summary.id };
  if (scene.assetType !== 'video') return { assetFileId: summary.id };
  const clip = await prepareClip(projectId, item.file, summary);
  if (clip.tail) storedFiles.push(clip.tail);
  return {
    assetFileId: summary.id,
    videoDurationSec: clip.durationSec,
    videoTailFileId: clip.tail?.id ?? null,
  };
}

function collectProjectFileReferences(value: unknown, key = ''): Set<string> {
  const result = new Set<string>();
  const visit = (current: unknown, currentKey: string): void => {
    if (typeof current === 'string' && (currentKey === 'fileId' || currentKey.endsWith('FileId'))) result.add(current);
    else if (Array.isArray(current)) current.forEach((item) => visit(item, currentKey));
    else if (current && typeof current === 'object') Object.entries(current as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(value, key);
  return result;
}

async function deleteFilesBestEffort(fileIds: Iterable<string>, projectId: string, reason: string): Promise<void> {
  for (const fileId of new Set(fileIds)) {
    try { await deleteFile(fileId); }
    catch (error) { logger.warn(`Could not clean ${reason} file ${fileId} for project ${projectId}.`, error); }
  }
}

async function cleanupDisplaced(projectId: string, fileIds: Iterable<string>): Promise<void> {
  let referenced: Set<string>;
  try { referenced = collectProjectFileReferences(await getProject(projectId)); }
  catch (error) { logger.warn(`Could not re-read project ${projectId}; keeping displaced files.`, error); return; }
  await deleteFilesBestEffort([...new Set(fileIds)].filter((fileId) => !referenced.has(fileId)), projectId, 'displaced');
}

export async function uploadSceneAssets(projectId: string, sceneId: string, files: AssetInputFile[]): Promise<SceneAssetsResponse> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new AppError('Không tìm thấy cảnh.', 404, 'not_found');
  assertSceneActive(scene);
  const classified = validateSceneUpload(scene, files);
  const stored: FileSummary[] = [];
  const updated: SceneAssetUpdated = {};
  const displaced = new Set<string>();
  try {
    for (const item of classified) {
      const attachment = await attachFileToScene(projectId, scene, item, stored);
      Object.assign(updated, attachment);
      if (attachment.videoKeyframeFileId) {
        if (scene.videoKeyframeFileId) displaced.add(scene.videoKeyframeFileId);
      }
      if (attachment.assetFileId) {
        if (scene.assetFileId) displaced.add(scene.assetFileId);
        if (scene.depthMap?.assetFileId) displaced.add(scene.depthMap.assetFileId);
        if (scene.depthMap?.fileId) displaced.add(scene.depthMap.fileId);
        if (scene.assetType === 'video') {
          if (scene.videoTailFileId) displaced.add(scene.videoTailFileId);
        }
      }
    }
    await applySceneAssetsFn(projectId, [{ sceneId, ...updated }], {
      expectedVersion: project.version,
      sceneGuards: [{ sceneId, assetType: scene.assetType }],
    });
  } catch (error) {
    await deleteFilesBestEffort(stored.map((file) => file.id), projectId, 'new upload');
    if (error instanceof VideoProbeError) throw new AppError('Không thể đọc thời lượng video.', 422, 'VIDEO_PROBE_FAILED');
    throw error;
  }
  await cleanupDisplaced(projectId, displaced);
  if (scene.assetType === 'image' && updated.assetFileId) await requestDepthMaps(projectId, [sceneId]);
  return { sceneId, updated, files: stored };
}

export async function removeSceneAsset(projectId: string, sceneId: string, slot: SceneAssetSlot): Promise<SceneAssetsResponse> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new AppError('Không tìm thấy cảnh.', 404, 'not_found');
  assertSceneActive(scene);
  if (slot === 'keyframe' && scene.assetType !== 'video') throw new AppError('Keyframe chỉ áp dụng cho scene video.', 422, 'KEYFRAME_REQUIRES_VIDEO');
  if (slot === 'keyframe') {
    if (!scene.videoKeyframeFileId) return { sceneId, updated: { videoKeyframeFileId: null }, files: [] };
    const displaced = [scene.videoKeyframeFileId];
    await applySceneAssetsFn(projectId, [{ sceneId, videoKeyframeFileId: null }], {
      expectedVersion: project.version,
      sceneGuards: [{ sceneId, assetType: scene.assetType }],
    });
    await cleanupDisplaced(projectId, displaced);
    return { sceneId, updated: { videoKeyframeFileId: null }, files: [] };
  }
  if (!scene.assetFileId && !scene.videoTailFileId && scene.videoDurationSec === null && !scene.depthMap) {
    return { sceneId, updated: { assetFileId: null, videoTailFileId: null, videoDurationSec: null }, files: [] };
  }
  const displaced = [scene.assetFileId, scene.videoTailFileId, scene.depthMap?.assetFileId, scene.depthMap?.fileId].filter((id): id is string => Boolean(id));
  const updated = { assetFileId: null, videoTailFileId: null, videoDurationSec: null };
  await applySceneAssetsFn(projectId, [{ sceneId, ...updated }], {
    expectedVersion: project.version,
    sceneGuards: [{ sceneId, assetType: scene.assetType }],
  });
  await cleanupDisplaced(projectId, displaced);
  return { sceneId, updated, files: [] };
}

export function exportScenesJson(project: ProjectDetail): FlowSceneExport[] {
  return activeScenes(project.scenes.map((scene, index) => ({ scene, index, active: scene.active }))).map(({ scene, index }) => {
    const sceneNumber = index + 1;
    const referenceTags = deriveReferenceTags(project.visualStylePresetId, {
      shotType: scene.shotType ?? null,
      lightType: scene.lightType ?? null,
    });
    return {
      sceneId: sceneNumber,
      sceneNumber,
      title: slugifyTitle(scene.narration, sceneNumber),
      prompt: scene.visualPrompt,
      assetType: scene.assetType,
      motionPrompt: scene.motionPrompt,
      ...(referenceTags === undefined ? {} : { referenceTags }),
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
    const inputFile: AssetInputFile = { originalname: filename, mimetype: MIME_BY_EXTENSION[extension]!, buffer };
    const update = { ...updates.get(scene.id), sceneId: scene.id };
    try {
      Object.assign(update, await attachFileToScene(projectId, scene, { file: inputFile, type, extension }, []));
    } catch (error) {
      if (!(error instanceof VideoProbeError)) throw error;
      skipped.push(filename);
      continue;
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
