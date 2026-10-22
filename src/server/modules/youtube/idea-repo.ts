import type { Collection, Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { AppError } from '../../shared/errors';
import { YoutubeIdeaRunDocSchema, YoutubeVideoIdeaDocSchema, type YoutubeIdeaRunDoc, type YoutubeVideoIdeaDoc } from './docs';

export const YOUTUBE_IDEA_MAX_PER_CHANNEL = 200;

function ideas(): Collection<YoutubeVideoIdeaDoc> {
  return getCollection('youtubeVideoIdeas');
}

function runs(): Collection<YoutubeIdeaRunDoc> {
  return getCollection('youtubeIdeaRuns');
}

export async function saveYoutubeIdeaRun(input: { run: YoutubeIdeaRunDoc; ideas: YoutubeVideoIdeaDoc[] }): Promise<void> {
  const run = YoutubeIdeaRunDocSchema.parse(input.run);
  const rows = input.ideas.map((idea) => YoutubeVideoIdeaDocSchema.parse(idea));
  if (rows.some((row) => row.channelProfileId !== run.channelProfileId || row.runId !== run._id)) {
    throw new Error('YouTube idea rows must belong to the run channel and run id.');
  }
  const protectedCount = await ideas().countDocuments({ channelProfileId: run.channelProfileId, status: { $in: ['chosen', 'used'] } });
  const incomingProtectedCount = rows.filter((row) => row.status === 'chosen' || row.status === 'used').length;
  if (protectedCount + incomingProtectedCount > YOUTUBE_IDEA_MAX_PER_CHANNEL) {
    throw new AppError('Đã có 200 ý tưởng được chọn hoặc dùng; hãy xóa bớt ý tưởng đã lưu trước khi tạo lượt mới.', 409, 'YOUTUBE_IDEA_LIMIT_REACHED');
  }
  await runs().insertOne(run);
  if (rows.length) await ideas().insertMany(rows, { ordered: true });
  await pruneYoutubeIdeas(run.channelProfileId);
}

async function deleteOldest(input: { channelProfileId: string; status: 'rejected' | 'new'; limit: number }): Promise<number> {
  if (input.limit <= 0) return 0;
  const rows = await ideas().find({ channelProfileId: input.channelProfileId, status: input.status })
    .sort({ generatedAt: 1, _id: 1 }).limit(input.limit).project({ _id: 1 }).toArray();
  if (!rows.length) return 0;
  const result = await ideas().deleteMany({ channelProfileId: input.channelProfileId, _id: { $in: rows.map((row) => row._id) } });
  return result.deletedCount;
}

async function pruneYoutubeIdeas(channelProfileId: string): Promise<void> {
  let excess = await ideas().countDocuments({ channelProfileId }) - YOUTUBE_IDEA_MAX_PER_CHANNEL;
  if (excess <= 0) return;
  excess -= await deleteOldest({ channelProfileId, status: 'rejected', limit: excess });
  if (excess > 0) await deleteOldest({ channelProfileId, status: 'new', limit: excess });
}

export async function listYoutubeIdeaDocs(channelProfileId: string): Promise<YoutubeVideoIdeaDoc[]> {
  const rows = await ideas().find({ channelProfileId }).sort({ generatedAt: -1, _id: -1 }).limit(YOUTUBE_IDEA_MAX_PER_CHANNEL).toArray();
  return rows.map((row) => YoutubeVideoIdeaDocSchema.parse(row));
}

export async function findYoutubeIdeaDoc(channelProfileId: string, ideaId: string): Promise<YoutubeVideoIdeaDoc | null> {
  const row = await ideas().findOne({ _id: ideaId, channelProfileId });
  return row ? YoutubeVideoIdeaDocSchema.parse(row) : null;
}

export async function findLatestYoutubeIdeaRun(channelProfileId: string): Promise<YoutubeIdeaRunDoc | null> {
  const row = await runs().find({ channelProfileId }).sort({ generatedAt: -1, _id: -1 }).limit(1).next();
  return row ? YoutubeIdeaRunDocSchema.parse(row) : null;
}

export async function patchYoutubeIdeaDoc(channelProfileId: string, ideaId: string, patch: {
  status?: YoutubeVideoIdeaDoc['status'];
  statusNote?: string | null;
  usedProjectId?: string;
  manualDemand?: { note: string; checkedAt: string };
}): Promise<YoutubeVideoIdeaDoc | null> {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.statusNote === null) unset.statusNote = '';
  else if (patch.statusNote !== undefined) set.statusNote = patch.statusNote;
  if (patch.usedProjectId !== undefined) set.usedProjectId = patch.usedProjectId;
  if (patch.manualDemand !== undefined) set.manualDemand = patch.manualDemand;
  const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
  if (Object.keys(update).length === 0) return findYoutubeIdeaDoc(channelProfileId, ideaId);
  await ideas().updateOne({ _id: ideaId, channelProfileId }, update as Document);
  return findYoutubeIdeaDoc(channelProfileId, ideaId);
}

export async function deleteYoutubeIdeaDoc(channelProfileId: string, ideaId: string): Promise<boolean> {
  const result = await ideas().deleteOne({ _id: ideaId, channelProfileId });
  return result.deletedCount === 1;
}
