import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileSummarySchema, type FilePurpose, type FileSummary } from '../../../contracts/file';
import { NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import type { FileDoc } from './docs';
import { deleteFileById, findFileById, insertFile, listFilesByProjectId } from './repo';

export type StoreFileParams = {
  projectId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  purpose: FilePurpose;
};

const MIME_EXTENSIONS: Record<string, string> = {
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

export function extensionFor(originalName: string, mimeType: string): string {
  const fromName = path.extname(originalName).slice(1).toLowerCase();
  return /^[a-z0-9]+$/.test(fromName) ? fromName : MIME_EXTENSIONS[mimeType] ?? 'bin';
}

function summaryOf(doc: FileDoc): FileSummary {
  return FileSummarySchema.parse({ ...doc, id: doc._id, createdAt: doc.createdAt.toISOString() });
}

export function createFileStoreService(filesDir: string) {
  async function storeFile(params: StoreFileParams): Promise<FileSummary> {
    await mkdir(filesDir, { recursive: true });
    const id = newId();
    const ext = extensionFor(params.originalName, params.mimeType);
    const storedPath = `${id}.${ext}`;
    await writeFile(path.join(filesDir, storedPath), params.buffer);
    const doc: FileDoc = {
      _id: id,
      projectId: params.projectId,
      originalName: params.originalName,
      mimeType: params.mimeType,
      ext,
      sizeBytes: params.buffer.byteLength,
      purpose: params.purpose,
      storedPath,
      createdAt: new Date(),
    };
    await insertFile(doc);
    return summaryOf(doc);
  }

  async function deleteFile(id: string): Promise<void> {
    const doc = await findFileById(id);
    if (!doc) throw new NotFound('Không tìm thấy tệp.');
    try {
      await unlink(path.join(filesDir, doc.storedPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await deleteFileById(id);
  }

  async function listProjectFiles(projectId: string): Promise<FileSummary[]> {
    return (await listFilesByProjectId(projectId)).map(summaryOf);
  }

  async function resolveFilePath(projectId: string, fileId: string): Promise<{ absolutePath: string; mimeType: string; purpose: FilePurpose }> {
    const doc = await findFileById(fileId);
    if (!doc || doc.projectId !== projectId) throw new NotFound('Không tìm thấy tệp.');
    return { absolutePath: path.join(filesDir, doc.storedPath), mimeType: doc.mimeType, purpose: doc.purpose };
  }

  return { storeFile, deleteFile, listProjectFiles, resolveFilePath };
}
