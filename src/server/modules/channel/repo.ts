import type { Collection, UpdateFilter } from 'mongodb';
import { getCollection } from '../../db/client';
import { ChannelDocSchema, type ChannelDoc } from './docs';

function collection(): Collection<ChannelDoc> {
  return getCollection<ChannelDoc>('channels');
}

export async function insertChannel(doc: ChannelDoc): Promise<void> {
  await collection().insertOne(doc);
}

export async function findChannelById(id: string): Promise<ChannelDoc | null> {
  const doc = await collection().findOne({ _id: id });
  return doc ? ChannelDocSchema.parse(doc) : null;
}

export async function findChannelByNameSearch(nameSearch: string): Promise<ChannelDoc | null> {
  const doc = await collection().findOne({ nameSearch });
  return doc ? ChannelDocSchema.parse(doc) : null;
}

export async function listChannelDocs(): Promise<ChannelDoc[]> {
  const docs = await collection().find({}).sort({ nameSearch: 1, _id: 1 }).toArray();
  return docs.map((doc) => ChannelDocSchema.parse(doc));
}

export async function updateChannelById(id: string, update: UpdateFilter<ChannelDoc>) {
  return collection().updateOne({ _id: id }, update);
}

export async function deleteChannelById(id: string): Promise<number> {
  const result = await collection().deleteOne({ _id: id });
  return result.deletedCount;
}
