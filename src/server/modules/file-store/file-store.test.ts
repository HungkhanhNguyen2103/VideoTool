import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getCollection } from '../../db/client';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { FileDocSchema } from './docs';
import { deleteFileById, findFileById, insertFile, listFilesByProjectId } from './repo';
import { newId } from '../../shared/ids';
import type { FileDoc } from './docs';
import { createFileStoreService } from './service';
import { NotFound } from '../../shared/errors';

let filesDir: string;
let service: ReturnType<typeof createFileStoreService>;

function makeFile(overrides: Partial<FileDoc> = {}): FileDoc {
  return {
    _id: newId(),
    projectId: 'project-1',
    originalName: 'reference.png',
    mimeType: 'image/png',
    ext: 'png',
    sizeBytes: 3,
    purpose: 'reference',
    storedPath: 'stored.png',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('file-store schema and repository', () => {
  beforeAll(async () => startTestMongo());
  beforeEach(async () => {
    await resetTestMongo();
    await getCollection<FileDoc>('files').deleteMany({});
    filesDir = mkdtempSync(path.join(tmpdir(), 'video-tool-files-'));
    service = createFileStoreService(filesDir);
  });
  afterAll(async () => { await closeTestMongo(); if (filesDir) rmSync(filesDir, { recursive: true, force: true }); });

  it('validates the persisted file document', () => {
    expect(FileDocSchema.parse(makeFile()).purpose).toBe('reference');
  });

  it('inserts, finds, deletes, and lists files by project', async () => {
    const first = makeFile({ projectId: 'project-1' });
    const second = makeFile({ projectId: 'project-2' });
    await insertFile(first);
    await insertFile(second);
    expect(await findFileById(first._id)).toMatchObject({ projectId: 'project-1' });
    expect(await listFilesByProjectId('project-1')).toHaveLength(1);
    await deleteFileById(first._id);
    expect(await findFileById(first._id)).toBeNull();
  });

  it('writes a generated safe path and returns a file summary', async () => {
    const summary = await service.storeFile({ projectId: 'project-1', originalName: '../secret.png', mimeType: 'image/png', buffer: Buffer.from('png'), purpose: 'reference' });
    expect(summary).toMatchObject({ projectId: 'project-1', originalName: '../secret.png', ext: 'png', sizeBytes: 3, purpose: 'reference' });
    expect(summary.createdAt).toEqual(expect.any(String));
    expect(summary.id).toMatch(/^[0-9A-Z]{26}$/);
    const doc = await findFileById(summary.id);
    expect(doc?.storedPath).toMatch(/^[0-9A-Z]{26}\.png$/);
    expect(readFileSync(path.join(filesDir, doc!.storedPath))).toEqual(Buffer.from('png'));
  });

  it('derives an extension from MIME when the original name has none', async () => {
    const summary = await service.storeFile({ projectId: 'project-1', originalName: 'README', mimeType: 'application/pdf', buffer: Buffer.from('pdf'), purpose: 'reference' });
    expect(summary.ext).toBe('pdf');
  });

  it('deletes metadata even when the disk file is already gone', async () => {
    const summary = await service.storeFile({ projectId: 'project-1', originalName: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x'), purpose: 'reference' });
    const doc = await findFileById(summary.id);
    unlinkSync(path.join(filesDir, doc!.storedPath));
    await expect(service.deleteFile(summary.id)).resolves.toBeUndefined();
    await expect(service.deleteFile(summary.id)).rejects.toBeInstanceOf(NotFound);
  });

  it('lists only files for the requested project', async () => {
    await service.storeFile({ projectId: 'project-1', originalName: 'a.png', mimeType: 'image/png', buffer: Buffer.from('a'), purpose: 'reference' });
    await service.storeFile({ projectId: 'project-2', originalName: 'b.png', mimeType: 'image/png', buffer: Buffer.from('b'), purpose: 'reference' });
    expect(await service.listProjectFiles('project-1')).toHaveLength(1);
  });

  it('throws NotFound for an unknown file id', async () => {
    await expect(service.deleteFile('missing')).rejects.toBeInstanceOf(NotFound);
  });
});
