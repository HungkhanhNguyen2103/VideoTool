import AdmZip from 'adm-zip';
import type { ProjectDetail } from '../../../contracts/project';
import { createFileStoreService } from '../file-store';
import { applySceneAssets, getProject } from '../project';
import { AppError } from '../../shared/errors';
import { expectedAssetType, MIME_BY_EXTENSION, type FlowSceneExport } from './docs';
import { probeVideoDuration } from '../../shared/ffprobe';

let storeFile = createFileStoreService('./data/files').storeFile;
let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;
let enqueueDepthMapJob: ((projectId: string, sceneId: string) => Promise<void>) | null = null;
let probeVideoDurationFn = probeVideoDuration;

export function configureAssetModule(
  filesDir: string,
  depthJobEnqueuer?: (projectId: string, sceneId: string) => Promise<void>,
  options: { probeVideoDuration?: typeof probeVideoDuration } = {},
): void {
  const service = createFileStoreService(filesDir);
  storeFile = service.storeFile;
  resolveFilePath = service.resolveFilePath;
  enqueueDepthMapJob = depthJobEnqueuer ?? null;
  probeVideoDurationFn = options.probeVideoDuration ?? probeVideoDuration;
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
  return project.scenes.map((scene, index) => {
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

const SCENE_FILE_PATTERN = /^SCENE_(\d{3})_([^/\\]+)\.([A-Za-z0-9]+)$/i;

export async function importAssetsFromZip(
  projectId: string,
  zipBuffer: Buffer,
): Promise<{ updated: number; skipped: string[] }> {
  const project = await getProject(projectId);
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new AppError('ZIP file is invalid.', 422, 'INVALID_ZIP');
  }

  const skipped: string[] = [];
  const updates = new Map<string, { sceneId: string; assetFileId?: string; videoKeyframeFileId?: string; videoDurationSec?: number | null }>();
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
    const accepted = scene?.assetType === 'video' ? type === 'video' || type === 'image' : type === scene?.assetType;
    if (!scene || !type || !accepted) {
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
      }
    }
    updates.set(scene.id, update);
  }

  await applySceneAssets(projectId, [...updates.values()]);
  const depthSceneIds = [...updates.values()]
    .filter((update) => update.assetFileId && project.scenes.find((scene) => scene.id === update.sceneId)?.assetType === 'image')
    .map((update) => update.sceneId);
  await requestDepthMaps(projectId, depthSceneIds);
  return { updated: updates.size, skipped };
}

export async function requestDepthMapsForImageScenes(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  await requestDepthMaps(projectId, project.scenes.filter((scene) => scene.assetType === 'image' && scene.assetFileId).map((scene) => scene.id));
}
