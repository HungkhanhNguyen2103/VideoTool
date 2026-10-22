import type { Collection } from 'mongodb';
import { getCollection } from '../../db/client';
import { YoutubeChannelDailyDocSchema, YoutubeChannelTrafficDocSchema, YoutubeCredentialDocSchema, YoutubeGrowthPlanDocSchema, YoutubePendingImportDocSchema, YoutubeQuotaDocSchema, YoutubeRetentionDocSchema, YoutubeReviewDocSchema, YoutubeReviewV2DocSchema, YoutubeStoredReviewDocSchema, YoutubeVideoDocSchema, type YoutubeChannelDailyDoc, type YoutubeChannelTrafficDoc, type YoutubeCredentialDoc, type YoutubeGrowthPlanDoc, type YoutubePendingImportDoc, type YoutubeQuotaDoc, type YoutubeRetentionDoc, type YoutubeReviewDoc, type YoutubeReviewV2Doc, type YoutubeStoredCredentialDoc, type YoutubeStoredReviewDoc, type YoutubeVideoDoc } from './docs';
import type { YoutubeFirst28dSnapshot, YoutubeManualReach, YoutubeSearchTermsBreakdown, YoutubeTrafficBreakdown } from '../../../contracts/youtube';
import { YOUTUBE_GROWTH_PLAN_DEFAULTS, YoutubeGrowthPlanConfigSchema, type YoutubeGrowthExperiment, type YoutubeGrowthPlanConfig } from '../../../contracts/youtube-plan';

const credentials = (): Collection<YoutubeStoredCredentialDoc> => getCollection('youtubeCredentials');
const videos = (): Collection<YoutubeVideoDoc> => getCollection('youtubeVideos');
const daily = (): Collection<YoutubeChannelDailyDoc> => getCollection('youtubeChannelDaily');
const quotas = (): Collection<YoutubeQuotaDoc> => getCollection('youtubeQuota');
const retention = (): Collection<YoutubeRetentionDoc> => getCollection('youtubeRetention');
const reviews = (): Collection<YoutubeStoredReviewDoc> => getCollection('youtubeReviews');
const channelTraffic = (): Collection<YoutubeChannelTrafficDoc> => getCollection('youtubeChannelTraffic');
const growthPlans = (): Collection<YoutubeGrowthPlanDoc> => getCollection('youtubeGrowthPlans');

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
    const { _id, channelProfileId, first28d, manualReach, excludedFromPlan, trafficSources, searchTerms, ...providerFields } = row;
    return { updateOne: { filter: { channelProfileId: profileId, videoId: row.videoId }, update: {
      $set: { ...providerFields, removed: false },
      $setOnInsert: { _id, channelProfileId, first28d, manualReach, excludedFromPlan, trafficSources, searchTerms },
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

export async function saveVideoSearchTerms(profileId: string, videoId: string, window: 'last28d' | 'lifetime', breakdown: YoutubeSearchTermsBreakdown): Promise<void> {
  await videos().updateOne({ channelProfileId: profileId, videoId }, { $set: { [`searchTerms.${window}`]: breakdown } });
}

export async function saveChannelTrafficSources(profileId: string, window: 'last28d' | 'lifetime', breakdown: YoutubeTrafficBreakdown): Promise<void> {
  await channelTraffic().updateOne({ _id: profileId, channelProfileId: profileId }, { $set: { [`${window}`]: breakdown }, $setOnInsert: { _id: profileId, channelProfileId: profileId } }, { upsert: true });
}

export async function saveChannelSearchTerms(profileId: string, window: 'last28d' | 'lifetime', breakdown: YoutubeSearchTermsBreakdown): Promise<void> {
  await channelTraffic().updateOne({ _id: profileId, channelProfileId: profileId }, { $set: { [`searchTerms.${window}`]: breakdown }, $setOnInsert: { _id: profileId, channelProfileId: profileId } }, { upsert: true });
}

export async function findChannelTrafficSources(profileId: string): Promise<YoutubeChannelTrafficDoc | null> {
  const row = await channelTraffic().findOne({ _id: profileId, channelProfileId: profileId });
  return row ? YoutubeChannelTrafficDocSchema.parse(row) : null;
}

export async function findYoutubeGrowthPlan(profileId: string): Promise<YoutubeGrowthPlanDoc | null> {
  const row = await growthPlans().findOne({ _id: profileId });
  return row ? YoutubeGrowthPlanDocSchema.parse(row) : null;
}

export async function replaceYoutubeGrowthPlan(profileId: string, config: YoutubeGrowthPlanConfig, now: Date): Promise<YoutubeGrowthPlanDoc> {
  const normalized = YoutubeGrowthPlanConfigSchema.parse(config);
  await growthPlans().updateOne({ _id: profileId }, {
    $set: { ...normalized, updatedAt: now.toISOString() },
    $setOnInsert: { _id: profileId, channelProfileId: profileId, experiments: [], createdAt: now.toISOString() },
  }, { upsert: true });
  const saved = await findYoutubeGrowthPlan(profileId);
  if (!saved) throw new Error('Growth plan upsert completed without a stored document.');
  return saved;
}

async function ensureYoutubeGrowthPlan(profileId: string, now: Date): Promise<void> {
  const defaults = YoutubeGrowthPlanConfigSchema.parse({});
  await growthPlans().updateOne({ _id: profileId }, { $setOnInsert: { ...defaults, _id: profileId, channelProfileId: profileId, experiments: [], createdAt: now.toISOString(), updatedAt: now.toISOString() } }, { upsert: true });
}

export async function appendYoutubeGrowthExperiment(profileId: string, experiment: YoutubeGrowthExperiment, now: Date): Promise<boolean> {
  await ensureYoutubeGrowthPlan(profileId, now);
  const max = YOUTUBE_GROWTH_PLAN_DEFAULTS.experimentLimit;
  const result = await growthPlans().updateOne({ _id: profileId, [`experiments.${max - 1}`]: { $exists: false } }, { $push: { experiments: experiment }, $set: { updatedAt: now.toISOString() } });
  return result.modifiedCount === 1;
}

export async function removeYoutubeGrowthExperiment(profileId: string, experimentId: string, now: Date): Promise<boolean> {
  const result = await growthPlans().updateOne({ _id: profileId, 'experiments.id': experimentId }, { $pull: { experiments: { id: experimentId } }, $set: { updatedAt: now.toISOString() } });
  return result.modifiedCount === 1;
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

export async function upsertReview(doc: YoutubeStoredReviewDoc): Promise<void> {
  await reviews().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

export async function findReview(profileId: string, target: 'channel' | 'video', targetId: string): Promise<YoutubeReviewDoc | null> {
  const row = await reviews().findOne({ channelProfileId: profileId, target, targetId, promptVersion: { $not: /^youtube-review-v2/u } });
  return row ? YoutubeReviewDocSchema.parse(row) : null;
}

export async function findYoutubeReviewV2(profileId: string, target: 'channel' | 'video', targetId: string): Promise<YoutubeReviewV2Doc | null> {
  const promptVersion = target === 'channel' ? 'youtube-review-v2-channel' : 'youtube-review-v2-video';
  const row = await reviews().findOne({ channelProfileId: profileId, target, targetId, promptVersion });
  return row ? YoutubeReviewV2DocSchema.parse(row) : null;
}

export function parseStoredYoutubeReview(value: unknown): YoutubeStoredReviewDoc {
  return YoutubeStoredReviewDocSchema.parse(value);
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
