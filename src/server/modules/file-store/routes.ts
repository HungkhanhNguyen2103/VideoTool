import { Router } from 'express';
import { ALLOWED_MIME_TYPES } from '../../../contracts/file';
import { getProject } from '../project';
import { AppError, NotFound } from '../../shared/errors';
import { uploadReference, uploadZip } from '../../shared/upload';
import { findFileById } from './repo';
import { createFileStoreService, type StoreFileParams } from './service';

let configuredService = createFileStoreService('./data/files');
export function configureFileStore(filesDir: string): void { configuredService = createFileStoreService(filesDir); }
export const fileStoreRouter = Router();

fileStoreRouter.post('/:id/files', uploadReference, async (req, res) => {
  const projectId = String(req.params.id);
  const project = await getProject(projectId);
  const file = req.file;
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  }
  const params: StoreFileParams = { projectId: project.id, originalName: file.originalname, mimeType: file.mimetype, buffer: file.buffer, purpose: 'reference' };
  res.status(201).json(await configuredService.storeFile(params));
});

fileStoreRouter.get('/:id/files', async (req, res) => {
  const projectId = String(req.params.id);
  await getProject(projectId);
  res.json(await configuredService.listProjectFiles(projectId));
});

fileStoreRouter.delete('/:id/files/:fileId', async (req, res) => {
  const projectId = String(req.params.id);
  const fileId = String(req.params.fileId);
  await getProject(projectId);
  const file = await findFileById(fileId);
  if (!file || file.projectId !== projectId) throw new NotFound('Không tìm thấy tệp.');
  await configuredService.deleteFile(fileId);
  res.status(204).end();
});

fileStoreRouter.post('/:id/import-zip', uploadZip, async () => {
  throw new AppError('ZIP import is not implemented yet.', 501, 'NOT_IMPLEMENTED');
});
