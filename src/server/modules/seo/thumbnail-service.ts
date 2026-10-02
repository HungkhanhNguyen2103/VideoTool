import { logger } from '../../shared/logger';
import { AppError } from '../../shared/errors';
import { createFileStoreService, type StoreFileParams } from '../file-store';
import { getProject, setSeoThumbnailFile } from '../project';

export const THUMBNAIL_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

let fileStore = createFileStoreService('./data/files');

export function configureThumbnailService(filesDir: string): void {
  fileStore = createFileStoreService(filesDir);
}

async function deleteBestEffort(fileId: string, projectId: string): Promise<void> {
  try {
    await fileStore.deleteFile(fileId);
  } catch (error) {
    logger.warn(`Thumbnail cleanup failed for project ${projectId}: ${String(error)}`);
  }
}

function extensionForMime(mimeType: string): 'png' | 'jpg' {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

export async function replaceProjectThumbnail(
  projectId: string,
  file: Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'buffer'>,
): Promise<Awaited<ReturnType<typeof getProject>>> {
  if (!THUMBNAIL_MIME_TYPES.has(file.mimetype)) throw new AppError('Thumbnail phải là PNG hoặc JPEG.', 400, 'INVALID_FILE_TYPE');
  const project = await getProject(projectId);
  const previousFileId = project.seo.thumbnail.fileId;
  const params: StoreFileParams = {
    projectId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
    purpose: 'thumbnail',
    extension: extensionForMime(file.mimetype),
  };
  const stored = await fileStore.storeFile(params);
  try {
    const updated = await setSeoThumbnailFile(projectId, stored.id);
    if (previousFileId) await deleteBestEffort(previousFileId, projectId);
    return updated;
  } catch (error) {
    await deleteBestEffort(stored.id, projectId);
    throw error;
  }
}

export async function removeProjectThumbnail(projectId: string): Promise<Awaited<ReturnType<typeof getProject>>> {
  const project = await getProject(projectId);
  const previousFileId = project.seo.thumbnail.fileId;
  if (!previousFileId) return project;
  const updated = await setSeoThumbnailFile(projectId, null);
  await deleteBestEffort(previousFileId, projectId);
  return updated;
}
