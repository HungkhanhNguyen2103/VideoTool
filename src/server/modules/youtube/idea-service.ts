import { canTransitionYoutubeIdeaStatus, NEXT_VIDEO_IDEAS_MIN_MATURE, YoutubeIdeaCreateProjectResponseSchema, YoutubeIdeaProjectPrefillSchema, YoutubeIdeasListResponseSchema, type YoutubeIdeasGenerateRequest, type YoutubeIdeaRecord } from '../../../contracts/youtube-ideas';
import { getChannel } from '../channel';
import { getProject, listProjects } from '../project';
import { newId } from '../../shared/ids';
import { AppError, NotFound } from '../../shared/errors';
import { getYoutubeGrowthPlanStatus } from './growth-plan-service';
import { findChannelTrafficSources, listVideoDocs } from './repo';
import { deleteYoutubeIdeaDoc, findLatestYoutubeIdeaRun, findYoutubeIdeaDoc, listYoutubeIdeaDocs, patchYoutubeIdeaDoc } from './idea-repo';
import { buildYoutubeIdeaPacket, type IdeaPacketInput } from './idea-packet';

export const YOUTUBE_VIDEO_IDEAS_JOB_TYPE = 'video-ideas';

export function youtubeVideoIdeasJobScope(channelId: string): string {
  return `youtube-ideas:${channelId}`;
}

function publicIdea(row: Awaited<ReturnType<typeof listYoutubeIdeaDocs>>[number]): YoutubeIdeaRecord {
  const { _id, ...data } = row;
  return { id: _id, ...data };
}

function publicRun(row: NonNullable<Awaited<ReturnType<typeof findLatestYoutubeIdeaRun>>>) {
  return {
    id: row._id,
    evidenceTier: row.evidenceTier,
    backend: row.backend,
    model: row.model,
    promptVersion: row.promptVersion,
    generatedAt: row.generatedAt,
    requestedCount: row.requestedCount,
    packetSummary: row.packetSummary,
    coverageFingerprint: row.coverageFingerprint,
    dropped: row.dropped,
    durations: row.durations,
  };
}

async function loadIdeaPacket(profileId: string, request: Pick<YoutubeIdeasGenerateRequest, 'steering' | 'presetId' | 'count' | 'targetDurationSec'>) {
  const [channel, planStatus, savedRows, videoRows, projectSummaries, traffic] = await Promise.all([
    getChannel(profileId),
    getYoutubeGrowthPlanStatus(profileId),
    listYoutubeIdeaDocs(profileId),
    listVideoDocs(profileId, { removed: { $ne: true } }),
    listProjects({}),
    findChannelTrafficSources(profileId),
  ]);
  const projects = await Promise.all(projectSummaries.filter((project) => project.channelId === profileId).map(async (summary) => {
    const detail = await getProject(summary.id);
    return {
      id: detail.id,
      title: detail.title,
      scriptPresetId: detail.scriptPresetId,
      brief: detail.brief,
      youtubeVideoId: detail.youtubeVideoId,
      status: detail.status,
    };
  }));
  const searchTerms: NonNullable<IdeaPacketInput['searchTerms']> = (['last28d', 'lifetime'] as const).flatMap((window) => {
    const row = traffic?.searchTerms[window];
    return row ? [{ window, status: row.status, terms: row.terms.map(({ term, views }) => ({ term, views })) }] : [];
  });
  const trafficMix: NonNullable<IdeaPacketInput['trafficMix']> = (['last28d', 'lifetime'] as const).flatMap((window) => {
    const row = traffic?.[window];
    if (!row) return [];
    const total = row.sources.reduce((sum, source) => sum + (source.views ?? 0), 0);
    return [{ window, sources: row.sources.map((source) => ({ sourceType: source.sourceType, views: source.views, share: source.views === null || total <= 0 ? null : source.views / total })) }];
  });
  const packet = buildYoutubeIdeaPacket({
    channel: { id: channel.id, name: channel.name, language: channel.language, tagline: channel.tagline, description: channel.description },
    plan: { nicheStartDate: planStatus.plan.nicheStartDate, cadencePerWeek: planStatus.plan.cadencePerWeek, experiments: planStatus.plan.experiments },
    planStatus,
    projects,
    syncedVideos: videoRows.filter((video) => video.privacy === 'public').map(({ videoId, title, publishedAt, privacy }) => ({ videoId, title, publishedAt, privacy })),
    savedIdeas: savedRows.map(({ idea, status }) => ({ title: idea.title, status })),
    steering: request.steering,
    presetId: request.presetId,
    count: request.count,
    targetDurationSec: request.targetDurationSec,
    searchTerms,
    trafficMix,
  });
  return { channel, planStatus, savedRows, packet };
}

export async function getYoutubeIdeas(profileId: string) {
  const request = { steering: '', presetId: 'hubris-trap', count: 6, targetDurationSec: 600 } as const;
  const [{ savedRows, packet }, latestRun] = await Promise.all([loadIdeaPacket(profileId, request), findLatestYoutubeIdeaRun(profileId)]);
  return YoutubeIdeasListResponseSchema.parse({
    ideas: savedRows.map(publicIdea),
    latestRun: latestRun ? publicRun(latestRun) : null,
    currentTier: packet.evidenceTier,
    matureVideoCount: packet.packetSummary.matureVideoCount,
    minimumMatureForDataInformed: NEXT_VIDEO_IDEAS_MIN_MATURE,
    currentCoverageFingerprint: packet.coverageFingerprint,
    stale: latestRun ? latestRun.coverageFingerprint !== packet.coverageFingerprint : false,
  });
}

export async function buildYoutubeIdeaRunPacket(profileId: string, request: YoutubeIdeasGenerateRequest) {
  return loadIdeaPacket(profileId, request);
}

export async function updateYoutubeIdea(profileId: string, ideaId: string, patch: {
  status?: 'new' | 'chosen' | 'rejected';
  statusNote?: string | null;
  manualDemand?: { note: string };
}): Promise<YoutubeIdeaRecord> {
  const existing = await findYoutubeIdeaDoc(profileId, ideaId);
  if (!existing) throw new NotFound('Không tìm thấy ý tưởng video.');
  if (patch.status && !canTransitionYoutubeIdeaStatus(existing.status, patch.status)) {
    throw new AppError('Ý tưởng đã dùng không thể đổi trạng thái.', 409, 'YOUTUBE_IDEA_STATUS_LOCKED');
  }
  const updated = await patchYoutubeIdeaDoc(profileId, ideaId, {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.statusNote !== undefined ? { statusNote: patch.statusNote } : {}),
    ...(patch.manualDemand !== undefined ? { manualDemand: { ...patch.manualDemand, checkedAt: new Date().toISOString() } } : {}),
  });
  if (!updated) throw new NotFound('Không tìm thấy ý tưởng video.');
  return publicIdea(updated);
}

function buildProjectPrefill(idea: NonNullable<Awaited<ReturnType<typeof findYoutubeIdeaDoc>>>, profileId: string, language: 'vi' | 'en') {
  return YoutubeIdeaProjectPrefillSchema.parse({
    title: idea.idea.title,
    language,
    brief: idea.idea.brief,
    referencesText: '',
    scriptPresetId: idea.idea.presetId,
    targetDurationSec: idea.idea.suggestedDurationSec,
    chapterCount: idea.idea.suggestedChapterCount,
    channelId: profileId,
    researchNote: 'Chưa có nguồn: cần research có dẫn nguồn trước khi viết kịch bản',
  });
}

export async function handoffYoutubeIdeaToProject(profileId: string, ideaId: string, projectId?: string) {
  const [channel, idea] = await Promise.all([getChannel(profileId), findYoutubeIdeaDoc(profileId, ideaId)]);
  if (!idea) throw new NotFound('Không tìm thấy ý tưởng video.');
  if (!projectId && idea.status === 'rejected') throw new AppError('Hãy chọn lại ý tưởng trước khi tạo dự án.', 409, 'YOUTUBE_IDEA_REJECTED');
  const prefill = buildProjectPrefill(idea, profileId, channel.language);
  if (projectId) {
    const project = await getProject(projectId);
    if (project.channelId !== profileId) throw new AppError('Dự án không thuộc kênh của ý tưởng này.', 409, 'YOUTUBE_IDEA_PROJECT_CHANNEL_MISMATCH');
    if (idea.status === 'used' && idea.usedProjectId !== projectId) throw new AppError('Ý tưởng đã được dùng cho một dự án khác.', 409, 'YOUTUBE_IDEA_ALREADY_USED');
    if (idea.status !== 'used') {
      const saved = await patchYoutubeIdeaDoc(profileId, ideaId, { status: 'used', usedProjectId: projectId });
      if (!saved) throw new NotFound('Không tìm thấy ý tưởng video.');
    }
  }
  return YoutubeIdeaCreateProjectResponseSchema.parse({ ideaId, prefill });
}

export async function deleteYoutubeIdea(profileId: string, ideaId: string): Promise<void> {
  if (!(await findYoutubeIdeaDoc(profileId, ideaId))) throw new NotFound('Không tìm thấy ý tưởng video.');
  if (!await deleteYoutubeIdeaDoc(profileId, ideaId)) throw new NotFound('Không tìm thấy ý tưởng video.');
}

export function newYoutubeIdeaRunId(): string {
  return newId();
}
