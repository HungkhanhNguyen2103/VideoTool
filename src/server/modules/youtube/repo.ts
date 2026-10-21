import type { Collection } from 'mongodb';
import { getCollection } from '../../db/client';
import { YoutubeChannelDailyDocSchema, YoutubeCredentialDocSchema, YoutubeQuotaDocSchema, YoutubeVideoDocSchema, type YoutubeChannelDailyDoc, type YoutubeCredentialDoc, type YoutubeQuotaDoc, type YoutubeVideoDoc } from './docs';

const credentials = (): Collection<YoutubeCredentialDoc> => getCollection('youtubeCredentials');
const videos = (): Collection<YoutubeVideoDoc> => getCollection('youtubeVideos');
const daily = (): Collection<YoutubeChannelDailyDoc> => getCollection('youtubeChannelDaily');
const quotas = (): Collection<YoutubeQuotaDoc> => getCollection('youtubeQuota');

export async function findCredential(profileId: string): Promise<YoutubeCredentialDoc | null> {
  const doc = await credentials().findOne({ _id: profileId });
  return doc ? YoutubeCredentialDocSchema.parse(doc) : null;
}

export async function upsertCredential(doc: YoutubeCredentialDoc): Promise<void> {
  await credentials().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

export async function patchCredential(profileId: string, patch: Partial<YoutubeCredentialDoc>): Promise<void> {
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) unset[key] = 1;
    else set[key] = value;
  }
  await credentials().updateOne({ _id: profileId }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
}

export async function deleteCredential(profileId: string): Promise<void> {
  await credentials().deleteOne({ _id: profileId });
}

export async function findProfileForYoutubeChannel(youtubeChannelId: string, exceptProfileId?: string): Promise<string | null> {
  const doc = await credentials().findOne({ youtubeChannelId, _id: { $ne: exceptProfileId ?? '' } }, { projection: { _id: 1 } });
  return doc?._id ?? null;
}

export async function listVideoDocs(profileId: string, filter: Record<string, unknown> = {}): Promise<YoutubeVideoDoc[]> {
  const rows = await videos().find({ channelProfileId: profileId, ...filter }).sort({ publishedAt: -1 }).toArray();
  return rows.map((row) => YoutubeVideoDocSchema.parse(row));
}

export async function countVideoDocs(profileId: string): Promise<number> {
  return videos().countDocuments({ channelProfileId: profileId, removed: { $ne: true } });
}

export async function upsertVideoDocs(profileId: string, rows: YoutubeVideoDoc[], seenAt: Date): Promise<void> {
  if (rows.length) await videos().bulkWrite(rows.map((row) => ({ updateOne: { filter: { channelProfileId: profileId, videoId: row.videoId }, update: { $set: { ...row, removed: false } }, upsert: true } })));
  await videos().updateMany({ channelProfileId: profileId, fetchedAt: { $lt: seenAt.toISOString() } }, { $set: { removed: true, privacy: 'removed' } });
}

export async function replaceChannelDaily(profileId: string, rows: YoutubeChannelDailyDoc[]): Promise<void> {
  if (rows.length) await daily().bulkWrite(rows.map((row) => ({ replaceOne: { filter: { channelProfileId: profileId, date: row.date }, replacement: row, upsert: true } })));
}

export async function listChannelDaily(profileId: string): Promise<YoutubeChannelDailyDoc[]> {
  const rows = await daily().find({ channelProfileId: profileId }).sort({ date: 1 }).toArray();
  return rows.map((row) => YoutubeChannelDailyDocSchema.parse(row));
}

export async function deleteSyncedData(profileId: string): Promise<void> {
  await Promise.all([videos().deleteMany({ channelProfileId: profileId }), daily().deleteMany({ channelProfileId: profileId })]);
}

export async function getQuota(date: string, projectKey: string): Promise<YoutubeQuotaDoc | null> {
  const row = await quotas().findOne({ date, projectKey });
  return row ? YoutubeQuotaDocSchema.parse(row) : null;
}

export async function incrementQuota(date: string, projectKey: string, units: number): Promise<void> {
  const _id = `${projectKey}:${date}`;
  await quotas().updateOne({ _id }, { $setOnInsert: { _id, date, projectKey }, $inc: { estimatedUnits: units } }, { upsert: true });
}
