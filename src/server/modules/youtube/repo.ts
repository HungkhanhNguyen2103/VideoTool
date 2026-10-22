import type { Collection } from 'mongodb';
import { getCollection } from '../../db/client';
import { YoutubeChannelDailyDocSchema, YoutubeChannelTrafficDocSchema, YoutubeCredentialDocSchema, YoutubePendingImportDocSchema, YoutubeQuotaDocSchema, YoutubeRetentionDocSchema, YoutubeReviewDocSchema, YoutubeVideoDocSchema, type YoutubeChannelDailyDoc, type YoutubeChannelTrafficDoc, type YoutubeCredentialDoc, type YoutubePendingImportDoc, type YoutubeQuotaDoc, type YoutubeRetentionDoc, type YoutubeReviewDoc, type YoutubeStoredCredentialDoc, type YoutubeVideoDoc } from './docs';
import type { YoutubeFirst28dSnapshot, YoutubeManualReach, YoutubeTrafficBreakdown } from '../../../contracts/youtube';

const credentials = (): Collection<YoutubeStoredCredentialDoc> => getCollection('youtubeCredentials');
const videos = (): Collection<YoutubeVideoDoc> => getCollection('youtubeVideos');
const daily = (): Collection<YoutubeChannelDailyDoc> => getCollection('youtubeChannelDaily');
const quotas = (): Collection<YoutubeQuotaDoc> => getCollection('youtubeQuota');
const retention = (): Collection<YoutubeRetentionDoc> => getCollection('youtubeRetention');
const reviews = (): Collection<YoutubeReviewDoc> => getCollection('youtubeReviews');
const channelTraffic = (): Collection<YoutubeChannelTrafficDoc> => getCollection('youtubeChannelTraffic');

export async function findCredential(profileId: string): Promise<YoutubeCredentialDoc | null> {
  const doc = await credentials().findOne({ _id: profileId, kind: { $ne: 'pending-import' } });
  return doc ? YoutubeCredentialDocSchema.parse(doc) : null;
}

export async function upsertCredential(doc: YoutubeCredentialDoc): Promise<void> {
  await credentials().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

export async function insertPendingYoutubeImport(doc: YoutubePendingImportDoc): Promise<void> {
  await credentials().insertOne(doc);
}

export async function findPendingYoutubeImport(selectionId: string, now = new Date()): Promise<YoutubePendingImportDoc | null> {
  const doc = await credentials().findOne({ _id: selectionId, kind: 'pending-import', expiresAt: { $gt: now } });
  return doc ? YoutubePendingImportDocSchema.parse(doc) : null;
}

export async function consumePendingYoutubeImport(selectionId: string, now = new Date()): Promise<YoutubePendingImportDoc | null> {
  const doc = await credentials().findOneAndDelete({ _id: selectionId, kind: 'pending-import', expiresAt: { $gt: now } });
  return doc ? YoutubePendingImportDocSchema.parse(doc) : null;
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
  if (rows.length) await videos().bulkWrite(rows.map((row) => {
    const { _id, channelProfileId, first28d, manualReach, excludedFromPlan, trafficSources, ...providerFields } = row;
    return { updateOne: { filter: { channelProfileId: profileId, videoId: row.videoId }, update: {
      $set: { ...providerFields, removed: false },
      $setOnInsert: { _id, channelProfileId, first28d, manualReach, excludedFromPlan, trafficSources },
    }, upsert: true } };
  }));
  await videos().updateMany({ channelProfileId: profileId, fetchedAt: { $lt: seenAt.toISOString() } }, { $set: { removed: true, privacy: 'removed' } });
}

export async function saveFirst28dIfMissing(profileId: string, videoId: string, snapshot: YoutubeFirst28dSnapshot): Promise<boolean> {
  const result = await videos().updateOne({ channelProfileId: profileId, videoId, $or: [{ first28d: null }, { first28d: { $exists: false } }] }, { $set: { first28d: snapshot } });
  return result.modifiedCount === 1;
}

export async function updateVideoManualReach(profileId: string, videoId: string, manualReach: YoutubeManualReach | null): Promise<boolean> {
  const result = await videos().updateOne({ channelProfileId: profileId, videoId, removed: { $ne: true } }, { $set: { manualReach } });
  return result.matchedCount === 1;
}

export async function updateVideoPlanExclusion(profileId: string, videoId: string, excluded: boolean): Promise<boolean> {
  const result = await videos().updateOne({ channelProfileId: profileId, videoId, removed: { $ne: true } }, { $set: { excludedFromPlan: excluded } });
  return result.matchedCount === 1;
}

export async function saveVideoTrafficSources(profileId: string, videoId: string, window: 'last28d' | 'lifetime', breakdown: YoutubeTrafficBreakdown): Promise<void> {
  await videos().updateOne({ channelProfileId: profileId, videoId }, { $set: { [`trafficSources.${window}`]: breakdown } });
}

export async function saveChannelTrafficSources(profileId: string, window: 'last28d' | 'lifetime', breakdown: YoutubeTrafficBreakdown): Promise<void> {
  await channelTraffic().updateOne({ _id: profileId, channelProfileId: profileId }, { $set: { [`${window}`]: breakdown }, $setOnInsert: { _id: profileId, channelProfileId: profileId } }, { upsert: true });
}

export async function findChannelTrafficSources(profileId: string): Promise<YoutubeChannelTrafficDoc | null> {
  const row = await channelTraffic().findOne({ _id: profileId, channelProfileId: profileId });
  return row ? YoutubeChannelTrafficDocSchema.parse(row) : null;
}

export async function replaceChannelDaily(profileId: string, rows: YoutubeChannelDailyDoc[]): Promise<void> {
  if (rows.length) await daily().bulkWrite(rows.map((row) => ({ replaceOne: { filter: { channelProfileId: profileId, date: row.date }, replacement: row, upsert: true } })));
}

export async function listChannelDaily(profileId: string): Promise<YoutubeChannelDailyDoc[]> {
  const rows = await daily().find({ channelProfileId: profileId }).sort({ date: 1 }).toArray();
  return rows.map((row) => YoutubeChannelDailyDocSchema.parse(row));
}

export async function patchVideoAnalytics(profileId: string, videoId: string, windows: Record<string, Record<string, number | null>>): Promise<void> {
  await videos().updateOne({ channelProfileId: profileId, videoId }, { $set: Object.fromEntries(Object.entries(windows).map(([window, metrics]) => [`analytics.${window}`, metrics])) });
}

export async function upsertRetention(doc: YoutubeRetentionDoc): Promise<void> {
  await retention().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

export async function findRetention(profileId: string, videoId: string): Promise<YoutubeRetentionDoc | null> {
  const row = await retention().findOne({ channelProfileId: profileId, videoId });
  return row ? YoutubeRetentionDocSchema.parse(row) : null;
}

export async function upsertReview(doc: YoutubeReviewDoc): Promise<void> {
  await reviews().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

export async function findReview(profileId: string, target: 'channel' | 'video', targetId: string): Promise<YoutubeReviewDoc | null> {
  const row = await reviews().findOne({ channelProfileId: profileId, target, targetId });
  return row ? YoutubeReviewDocSchema.parse(row) : null;
}

export async function deleteSyncedData(profileId: string): Promise<void> {
  await Promise.all([videos().deleteMany({ channelProfileId: profileId }), daily().deleteMany({ channelProfileId: profileId }), retention().deleteMany({ channelProfileId: profileId }), reviews().deleteMany({ channelProfileId: profileId }), channelTraffic().deleteOne({ _id: profileId })]);
}

export async function getQuota(date: string, projectKey: string): Promise<YoutubeQuotaDoc | null> {
  const row = await quotas().findOne({ date, projectKey });
  return row ? YoutubeQuotaDocSchema.parse(row) : null;
}

export async function incrementQuota(date: string, projectKey: string, units: number): Promise<void> {
  const _id = `${projectKey}:${date}`;
  await quotas().updateOne({ _id }, { $setOnInsert: { _id, date, projectKey }, $inc: { estimatedUnits: units } }, { upsert: true });
}
