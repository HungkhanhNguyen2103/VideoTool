import { MongoServerError } from 'mongodb';
import { ChannelSchema, CreateChannelRequestSchema, UpdateChannelRequestSchema, type Channel, type CreateChannelRequest, type UpdateChannelRequest } from '../../../contracts/channel';
import { AppError, NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { countProjectsByChannelId } from '../project';
import { ChannelDocSchema, type ChannelDoc } from './docs';
import { deleteChannelById, findChannelById, findChannelByNameSearch, insertChannel, listChannelDocs, updateChannelById } from './repo';

function normalizeChannelName(name: string): string {
  return name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/\s+/g, ' ').toLowerCase();
}

function toChannel(doc: ChannelDoc): Channel {
  const profile: Record<string, unknown> = { ...doc };
  delete profile._id;
  delete profile.schemaVersion;
  delete profile.nameSearch;
  const createdAt = doc.createdAt.toISOString();
  const updatedAt = doc.updatedAt.toISOString();
  return ChannelSchema.parse({ ...profile, id: doc._id, createdAt, updatedAt });
}

function isDuplicateKey(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

function nameTaken(): AppError {
  return new AppError('Tên kênh này đã được sử dụng.', 409, 'CHANNEL_NAME_TAKEN');
}

async function assertNameAvailable(name: string, exceptId?: string): Promise<string> {
  const nameSearch = normalizeChannelName(name);
  const existing = await findChannelByNameSearch(nameSearch);
  if (existing && existing._id !== exceptId) throw nameTaken();
  return nameSearch;
}

export async function listChannels(): Promise<Channel[]> {
  return (await listChannelDocs()).map(toChannel);
}

export async function getChannel(id: string): Promise<Channel> {
  const doc = await findChannelById(id);
  if (!doc) throw new NotFound('Không tìm thấy kênh.');
  return toChannel(doc);
}

export async function assertChannelExists(id: string): Promise<void> {
  await getChannel(id);
}

export async function createChannel(request: CreateChannelRequest): Promise<Channel> {
  const input = CreateChannelRequestSchema.parse(request);
  const nameSearch = await assertNameAvailable(input.name);
  const now = new Date();
  const doc = ChannelDocSchema.parse({
    ...input,
    _id: newId(),
    schemaVersion: 1,
    nameSearch,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await insertChannel(doc);
  } catch (error) {
    if (isDuplicateKey(error)) throw nameTaken();
    throw error;
  }
  return toChannel(doc);
}

export async function updateChannel(id: string, request: UpdateChannelRequest): Promise<Channel> {
  const input = UpdateChannelRequestSchema.parse(request);
  const current = await findChannelById(id);
  if (!current) throw new NotFound('Không tìm thấy kênh.');
  const set: Record<string, unknown> = { ...input, updatedAt: new Date() };
  const unset: Record<string, 1> = {};
  if (input.name !== undefined) set.nameSearch = await assertNameAvailable(input.name, id);
  if (input.handle === null) {
    delete set.handle;
    unset.handle = 1;
  }
  if (Object.keys(input).length === 0) return toChannel(current);
  try {
    const result = await updateChannelById(id, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (result.matchedCount === 0) throw new NotFound('Không tìm thấy kênh.');
  } catch (error) {
    if (isDuplicateKey(error)) throw nameTaken();
    throw error;
  }
  return getChannel(id);
}

export async function deleteChannel(id: string): Promise<void> {
  if (!(await findChannelById(id))) throw new NotFound('Không tìm thấy kênh.');
  const count = await countProjectsByChannelId(id);
  if (count > 0) throw new AppError(`Không thể xóa kênh vì đang có ${count} dự án sử dụng.`, 409, 'CHANNEL_IN_USE');
  if ((await deleteChannelById(id)) === 0) throw new NotFound('Không tìm thấy kênh.');
}
