import { canTransitionYoutubeIdeaStatus, NEXT_VIDEO_IDEAS_MIN_MATURE, YoutubeIdeaCreateProjectResponseSchema, YoutubeIdeaProjectPrefillSchema, YoutubeIdeasListResponseSchema, type YoutubeIdeasGenerateRequest, type YoutubeIdeaRecord } from '../../../contracts/youtube-ideas';
import { getDefaultAiModelId, isAiModelForProvider } from '../../../contracts/ai-models';
import type { AiProvider } from '../../../contracts/project';
import type { Config } from '../../config';
import { loadConfig } from '../../config';
import { getAiClient, type AiClient } from '../../shared/ai';
import { createClaudeCliChat } from '../../shared/claude-cli/cli-chat';
import type { ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import type { YoutubeIdeaJobContext, YoutubeIdeaBackend } from './idea-engine';
import { runYoutubeIdeaPipeline } from './idea-engine';
import { getChannel } from '../channel';
import { getProject, listProjects } from '../project';
import { newId } from '../../shared/ids';
import { AppError, NotFound } from '../../shared/errors';
import { getYoutubeGrowthPlanStatus } from './growth-plan-service';
import { findChannelTrafficSources, listVideoDocs } from './repo';
import { claimYoutubeIdeaProjectDoc, deleteYoutubeIdeaDoc, findLatestYoutubeIdeaRun, findYoutubeIdeaDoc, listYoutubeIdeaDocs, patchYoutubeIdeaDoc } from './idea-repo';
import { buildYoutubeIdeaPacket, type IdeaPacketInput } from './idea-packet';
import { saveYoutubeIdeaRun } from './idea-repo';

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
    return [{ window, status: row.status, sources: row.sources.map((source) => ({ sourceType: source.sourceType, views: source.views, share: source.views === null || total <= 0 ? null : source.views / total })) }];
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

export async function getYoutubeIdeasDefaultTargetDuration(profileId: string): Promise<number> {
  const latest = (await listProjects({}))
    .filter((project) => project.channelId === profileId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!latest) return 600;
  return (await getProject(latest.id)).targetDurationSec;
}

export async function generateYoutubeVideoIdeas(input: {
  profileId: string;
  request: YoutubeIdeasGenerateRequest;
  context: YoutubeIdeaJobContext;
  config?: Config;
  getClaudeCliStatus?: (options: { executablePath: string; env?: NodeJS.ProcessEnv }) => Promise<ClaudeCliStatus>;
  cliChatFactory?: typeof createClaudeCliChat;
  clientFactory?: (provider: AiProvider, model: string) => Pick<AiClient, 'chat'>;
}): Promise<{ runId: string; ideaIds: string[]; dropped: number; evidenceTier: string } | undefined> {
  const config = input.config ?? loadConfig();
  const { packet } = await buildYoutubeIdeaRunPacket(input.profileId, input.request);
  let backend: YoutubeIdeaBackend;
  if (input.request.backend === 'cli') {
    const model = input.request.cliModel ?? getDefaultAiModelId('claude');
    if (!isAiModelForProvider('claude', model)) throw new AppError('Model Claude CLI không còn khả dụng; hãy chọn model khác.', 422, 'AI_MODEL_UNAVAILABLE');
    const cli = await (input.cliChatFactory ?? createClaudeCliChat)({
      projectId: `youtube-ideas-${input.profileId}`,
      chapterId: 'youtube-ideas',
      label: 'Ý tưởng video tiếp theo',
      model,
      config,
      context: input.context,
      getStatus: input.getClaudeCliStatus,
    });
    backend = { kind: 'cli', model: cli.model, chat: cli.chat };
  } else {
    const provider = config.DEFAULT_AI_PROVIDER;
    const model = getDefaultAiModelId(provider);
    const client = input.clientFactory?.(provider, model) ?? getAiClient(provider, model);
    backend = { kind: 'api', model, chat: (messages) => client.chat(messages, { json: true }) };
  }
  await input.context.appendLog(`Bắt đầu gợi ý bằng ${backend.kind === 'cli' ? 'Claude CLI' : `API ${backend.model}`}; Claude CLI không có web hoặc tệp, sự kiện lịch sử đều cần kiểm chứng; gói ${packet.serialized.length} ký tự.`);
  const result = await runYoutubeIdeaPipeline({ packet, backend, context: input.context, request: input.request });
  if (!result || await input.context.isCancelled()) return undefined;
  const generatedAt = new Date().toISOString();
  const runId = newYoutubeIdeaRunId();
  const ideaRows = result.ideas.map((idea) => ({
    _id: newId(),
    channelProfileId: input.profileId,
    runId,
    evidenceTier: packet.evidenceTier,
    backend: backend.kind,
    model: backend.model,
    promptVersion: result.promptVersion,
    generatedAt,
    idea,
    status: 'new' as const,
  }));
  const saved = await saveYoutubeIdeaRun({
    run: {
      _id: runId,
      channelProfileId: input.profileId,
      evidenceTier: packet.evidenceTier,
      backend: backend.kind,
      model: backend.model,
      promptVersion: result.promptVersion,
      generatedAt,
      requestedCount: input.request.count,
      packetSummary: packet.packetSummary,
      coverageFingerprint: packet.coverageFingerprint,
      dropped: result.dropped,
      durations: result.durations,
    },
    ideas: ideaRows,
    isCancelled: input.context.isCancelled,
  });
  if (!saved) return undefined;
  input.context.markCommitComplete?.();
  await input.context.appendLog(`Đã lưu ${ideaRows.length} ý tưởng và tóm tắt lượt chạy; không lưu prompt, gói coverage, token hoặc nội dung phản hồi thô.`);
  await input.context.reportProgress(100, { step: 'Hoàn tất', runId, ideaCount: ideaRows.length, droppedCount: result.dropped.length });
  return { runId, ideaIds: ideaRows.map((idea) => idea._id), dropped: result.dropped.length, evidenceTier: packet.evidenceTier };
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
  if (patch.status && !canTransitionYoutubeIdeaStatus(updated.status, patch.status)) {
    throw new AppError('Ý tưởng đã dùng không thể đổi trạng thái.', 409, 'YOUTUBE_IDEA_STATUS_LOCKED');
  }
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
      const claimed = await claimYoutubeIdeaProjectDoc(profileId, ideaId, projectId);
      if (!claimed) {
        const latest = await findYoutubeIdeaDoc(profileId, ideaId);
        if (!latest) throw new NotFound('Không tìm thấy ý tưởng video.');
        if (latest.status === 'used' && latest.usedProjectId === projectId) return YoutubeIdeaCreateProjectResponseSchema.parse({ ideaId, prefill });
        if (latest.status === 'used') throw new AppError('Ý tưởng đã được dùng cho một dự án khác.', 409, 'YOUTUBE_IDEA_ALREADY_USED');
        if (latest.status === 'rejected') throw new AppError('Hãy chọn lại ý tưởng trước khi tạo dự án.', 409, 'YOUTUBE_IDEA_REJECTED');
        throw new AppError('Trạng thái ý tưởng vừa thay đổi; hãy mở lại ý tưởng rồi thử lại.', 409, 'YOUTUBE_IDEA_STATUS_CHANGED');
      }
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
