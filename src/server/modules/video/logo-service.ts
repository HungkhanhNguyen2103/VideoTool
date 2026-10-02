import { logger } from '../../shared/logger';
import { AppError } from '../../shared/errors';
import { createFileStoreService, type StoreFileParams } from '../file-store';
import { getProject, setProjectLogo } from '../project';

const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

let fileStore = createFileStoreService('./data/files');

export function configureLogoService(filesDir: string): void {
  fileStore = createFileStoreService(filesDir);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function deleteBestEffort(fileId: string, projectId: string): Promise<void> {
  try {
    await fileStore.deleteFile(fileId);
  } catch (error) {
    if (!isMissingFile(error)) logger.warn(`Logo cleanup failed for project ${projectId}.`, error);
  }
}

export async function replaceProjectLogo(
  projectId: string,
  file: Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'buffer'>,
): Promise<Awaited<ReturnType<typeof getProject>>> {
  if (!LOGO_MIME_TYPES.has(file.mimetype)) throw new AppError('Logo phải là PNG, JPEG hoặc WebP.', 400, 'INVALID_FILE_TYPE');
  const project = await getProject(projectId);
  const previousLogoFileId = project.logoFileId;
  const params: StoreFileParams = {
    projectId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
    purpose: 'logo',
  };
  const stored = await fileStore.storeFile(params);
  try {
    const updated = await setProjectLogo(projectId, stored.id);
    if (previousLogoFileId) await deleteBestEffort(previousLogoFileId, projectId);
    return updated;
  } catch (error) {
    await deleteBestEffort(stored.id, projectId);
    throw error;
  }
}

export async function removeProjectLogo(projectId: string): Promise<Awaited<ReturnType<typeof getProject>>> {
  const project = await getProject(projectId);
  if (!project.logoFileId) return project;
  const previousLogoFileId = project.logoFileId;
  const updated = await setProjectLogo(projectId, null);
  await deleteBestEffort(previousLogoFileId, projectId);
  return updated;
}

export { LOGO_MIME_TYPES };
