import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { FileSummarySchema, type FilePurpose, type FileSummary } from '../../../contracts/file';
import { NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import type { FileDoc } from './docs';
import { deleteFileById, findFileById, findFilesByIds, insertFile, listFilesByProjectId } from './repo';

export type StoreFileParams = {
  projectId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  purpose: FilePurpose;
  extension?: string;
};

export type StoreFileFromPathParams = Omit<StoreFileParams, 'buffer'> & { sourcePath: string };

export type FileStoreServiceOptions = {
  rename?: typeof rename;
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

export function createFileStoreService(filesDir: string, options: FileStoreServiceOptions = {}) {
  const renameFile = options.rename ?? rename;

  async function storeFile(params: StoreFileParams): Promise<FileSummary> {
    await mkdir(filesDir, { recursive: true });
    const id = newId();
    const ext = params.extension ?? extensionFor(params.originalName, params.mimeType);
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

  async function storeFileFromPath(params: StoreFileFromPathParams): Promise<FileSummary> {
    const sourceStats = await stat(params.sourcePath);
    if (sourceStats.size === 0) throw new Error('Cannot store an empty file.');

    await mkdir(filesDir, { recursive: true });
    const id = newId();
    const ext = params.extension ?? extensionFor(params.originalName, params.mimeType);
    const storedPath = `${id}.${ext}`;
    const destinationPath = path.join(filesDir, storedPath);

    try {
      await renameFile(params.sourcePath, destinationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;

      try {
        await pipeline(createReadStream(params.sourcePath), createWriteStream(destinationPath));
        await unlink(params.sourcePath);
      } catch (copyError) {
        await unlink(destinationPath).catch(() => undefined);
        throw copyError;
      }
    }

    const doc: FileDoc = {
      _id: id,
      projectId: params.projectId,
      originalName: params.originalName,
      mimeType: params.mimeType,
      ext,
      sizeBytes: sourceStats.size,
      purpose: params.purpose,
      storedPath,
      createdAt: new Date(),
    };
    try {
      await insertFile(doc);
    } catch (error) {
      try {
        await renameFile(destinationPath, params.sourcePath);
      } catch (rollbackError) {
        if ((rollbackError as NodeJS.ErrnoException).code !== 'EXDEV') throw rollbackError;
        try {
          await pipeline(createReadStream(destinationPath), createWriteStream(params.sourcePath));
          await unlink(destinationPath);
        } catch (copyError) {
          throw new AggregateError([error, copyError], 'File metadata insertion failed and the source file could not be restored.');
        }
      }
      throw error;
    }
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

  async function deleteProjectFiles(projectId: string, fileIds: Array<string | null | undefined>): Promise<void> {
    const ids = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
    const files = await findFilesByIds(ids);
    for (const file of files) {
      if (file.projectId === projectId) await deleteFile(file._id);
    }
  }

  async function resolveFilePath(projectId: string, fileId: string): Promise<{ absolutePath: string; mimeType: string; purpose: FilePurpose }> {
    const doc = await findFileById(fileId);
    if (!doc || doc.projectId !== projectId) throw new NotFound('Không tìm thấy tệp.');
    return { absolutePath: path.join(filesDir, doc.storedPath), mimeType: doc.mimeType, purpose: doc.purpose };
  }

  return { storeFile, storeFileFromPath, deleteFile, deleteProjectFiles, listProjectFiles, resolveFilePath };
}
