import { Router } from 'express';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import { ALLOWED_MIME_TYPES, FILE_PURPOSES } from '../../../contracts/file';
import { getProject, replaceProjectScenes, SceneDocSchema } from '../project';
import { AppError, FieldAppError, NotFound } from '../../shared/errors';
import { uploadReference, uploadZip } from '../../shared/upload';
import { findFileById } from './repo';
import { createFileStoreService, type StoreFileParams } from './service';
import { extractReferenceText, isReferenceDocument } from './reference-text';
import { parseProjectImportSeed } from './project-import';
import { ProjectImportSeedSchema } from '../../../contracts/project';

let configuredService = createFileStoreService('./data/files');
export function configureFileStore(filesDir: string): void { configuredService = createFileStoreService(filesDir); }
export const fileStoreRouter = Router();
const UploadPurposeSchema = z.object({ purpose: z.enum(FILE_PURPOSES).default('reference') }).strict();

fileStoreRouter.post('/import-seed', uploadZip, async (req, res) => {
  const file = req.file;
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
    throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  }
  try {
    res.json(ProjectImportSeedSchema.parse(parseProjectImportSeed(file.buffer)));
  } catch (error) {
    throw new FieldAppError(error instanceof Error ? error.message : 'ZIP file is invalid.', 400, 'INVALID_PROJECT_SEED', []);
  }
});

fileStoreRouter.post('/reference-text', uploadReference, async (req, res) => {
  const file = req.file;
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (!isReferenceDocument(file.originalname, file.mimetype)) throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  try {
    res.json({ text: extractReferenceText(file.originalname, file.mimetype, file.buffer) });
  } catch (error) {
    throw new FieldAppError(error instanceof Error ? error.message : 'Cannot read reference document.', 422, 'REFERENCE_TEXT_FAILED', []);
  }
});

fileStoreRouter.post('/:id/files', uploadReference, async (req, res) => {
  const projectId = String(req.params.id);
  const project = await getProject(projectId);
  const file = req.file;
  const { purpose } = UploadPurposeSchema.parse(req.body);
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  }
  if (purpose === 'style-reference' && !file.mimetype.startsWith('image/')) {
    throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  }
  const params: StoreFileParams = { projectId: project.id, originalName: file.originalname, mimeType: file.mimetype, buffer: file.buffer, purpose };
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

fileStoreRouter.post('/:id/import-zip', uploadZip, async (req, res) => {
  const projectId = String(req.params.id);
  await getProject(projectId);
  const file = req.file;
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
    throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(file.buffer);
  } catch {
    throw new FieldAppError('ZIP file is invalid.', 422, 'INVALID_ZIP', []);
  }
  const entry = zip.getEntry('scenes.json');
  if (!entry) throw new FieldAppError('ZIP must contain scenes.json at the root.', 422, 'MISSING_SCENES_JSON', []);

  let raw: unknown;
  try {
    raw = JSON.parse(entry.getData().toString('utf8'));
  } catch {
    throw new FieldAppError('scenes.json is invalid JSON.', 422, 'INVALID_SCENES_JSON', []);
  }
  const parsed = z.array(SceneDocSchema).safeParse(raw);
  if (!parsed.success) {
    throw new FieldAppError(
      'scenes.json has invalid scene data.',
      422,
      'INVALID_SCENES_JSON',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  await replaceProjectScenes(projectId, parsed.data);
  res.json(await getProject(projectId));
});
