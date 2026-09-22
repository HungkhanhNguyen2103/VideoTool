import { getCollection } from '../../db/client';
import type { FileDoc } from './docs';

const files = () => getCollection<FileDoc>('files');

export async function insertFile(doc: FileDoc): Promise<void> {
  await files().insertOne(doc);
}

export async function findFileById(id: string): Promise<FileDoc | null> {
  return files().findOne({ _id: id });
}

export async function deleteFileById(id: string): Promise<void> {
  await files().deleteOne({ _id: id });
}

export async function listFilesByProjectId(projectId: string): Promise<FileDoc[]> {
  return files().find({ projectId }).sort({ createdAt: -1 }).toArray();
}
