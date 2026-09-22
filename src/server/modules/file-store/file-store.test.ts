import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getCollection } from '../../db/client';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { FileDocSchema } from './docs';
import { deleteFileById, findFileById, insertFile, listFilesByProjectId } from './repo';
import { newId } from '../../shared/ids';
import type { FileDoc } from './docs';

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
  beforeEach(async () => { await resetTestMongo(); await getCollection<FileDoc>('files').deleteMany({}); });
  afterAll(async () => closeTestMongo());

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
});
