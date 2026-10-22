import { getDefaultAiModelId, isAiModelForProvider } from '../../../contracts/ai-models';
import { CLAUDE_CLI_DEFAULT_MODEL } from '../../../contracts/claude-cli';
import { YoutubeVideoStatsSchema } from '../../../contracts/youtube';
import { YoutubeReviewVideoContextSchema, YoutubeReviewV2ResultSchema } from '../../../contracts/youtube-review';
import type { AiProvider } from '../../../contracts/project';
import type { Config } from '../../config';
import { loadConfig } from '../../config';
import { getAiClient, type AiClient } from '../../shared/ai';
import { createClaudeCliChat } from '../../shared/claude-cli/cli-chat';
import type { ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import { AppError, NotFound } from '../../shared/errors';
import { getProject, listProjects } from '../project';
import { getYoutubeGrowthPlanStatus } from './growth-plan-service';
import { buildChannelEvidence, buildVideoEvidence, type ReviewProject } from './review-evidence';
import { findChannelTrafficSources, findCredential, findRetention, findYoutubeReviewV2, listVideoDocs, upsertReview } from './repo';
import { YoutubeReviewV2DocSchema } from './docs';
import { getYoutubeRetention, refreshYoutubeSearchTermsForVideo, RETENTION_CACHE_MS } from './analytics-service';
import { getYoutubeAccessToken } from './sync';
import { runYoutubeReviewV2Analysis, type YoutubeReviewEvidencePacket, type YoutubeReviewJobContext } from './review-v2-engine';

export type YoutubeReviewV2Target = 'channel' | 'video';
export type YoutubeReviewV2Request = { backend: 'cli' | 'api'; cliModel?: string };
export type YoutubeReviewV2JobContext = YoutubeReviewJobContext;

async function buildCurrentEvidence(input: {
  profileId: string; target: YoutubeReviewV2Target; videoId?: string; config: Config; fetcher?: typeof fetch;
  context?: YoutubeReviewV2JobContext; allowRetentionFetch: boolean; now?: Date;
}): Promise<YoutubeReviewEvidencePacket> {
  const now = input.now ?? new Date();
  const [planStatus, videoDocs, credential, channelTraffic] = await Promise.all([
    getYoutubeGrowthPlanStatus(input.profileId, now),
    listVideoDocs(input.profileId, { removed: { $ne: true } }),
    findCredential(input.profileId),
    findChannelTrafficSources(input.profileId),
  ]);
  if (videoDocs.length === 0) throw new AppError('Đồng bộ ít nhất một video trước khi phân tích kênh.', 409, 'YOUTUBE_REVIEW_NO_DATA');
  const videos = videoDocs.map((video) => {
    const safeVideo: Record<string, unknown> = { ...video };
    delete safeVideo._id;
    delete safeVideo.channelProfileId;
    delete safeVideo.removed;
    return YoutubeVideoStatsSchema.parse(safeVideo);
  });
  const syncedAt = credential?.lastSyncAt?.toISOString() ?? null;
  if (input.target === 'channel') {
    const selectedIds = [...planStatus.videos]
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || right.videoId.localeCompare(left.videoId))
      .slice(0, 20)
      .map((video) => video.videoId);
    const retained = await Promise.all(selectedIds.map((videoId) => findRetention(input.profileId, videoId)));
    const retentionByVideoId = Object.fromEntries(retained.flatMap((row) => row?.curve ? [[row.videoId, { curve: row.curve, fetchedAt: row.fetchedAt.toISOString() }]] : []));
    return buildChannelEvidence({ planStatus, videos, channelSearchTerms: channelTraffic?.searchTerms, retentionByVideoId, syncedAt });
  }

  let video = videos.find((row) => row.videoId === input.videoId);
  if (!video) throw new NotFound('Không tìm thấy video đã đồng bộ.');
  let retention = await findRetention(input.profileId, video.videoId);
  if (input.allowRetentionFetch && (!retention || now.getTime() - retention.fetchedAt.getTime() >= RETENTION_CACHE_MS)) {
    await input.context?.appendLog('Đang kiểm tra retention qua YouTube Analytics cho riêng video này; Analytics quota là hạn mức riêng.');
    await getYoutubeRetention(input.profileId, video, () => getYoutubeAccessToken(input.profileId, input.fetcher, input.config), input.fetcher, now);
    retention = await findRetention(input.profileId, video.videoId);
  }
  if (input.allowRetentionFetch && (!video.searchTerms.last28d || !video.searchTerms.lifetime)) {
    if (credential?.youtubeChannelId && !credential.needsReconnect) {
      await input.context?.appendLog('Đang lấy từ khóa tìm kiếm cho video qua YouTube Analytics (2 báo cáo); Analytics quota là hạn mức riêng.');
      try {
        const searchTerms = await refreshYoutubeSearchTermsForVideo(
          input.profileId,
          video,
          await getYoutubeAccessToken(input.profileId, input.fetcher, input.config),
          input.fetcher,
          now,
        );
        video = { ...video, searchTerms: { ...video.searchTerms, ...searchTerms } };
        const available = [searchTerms.last28d, searchTerms.lifetime].filter((row) => row?.status === 'ok').length;
        await input.context?.appendLog(available === 2
          ? 'Đã lấy đủ hai cửa sổ từ khóa tìm kiếm cho video.'
          : `YouTube ẩn các từ khóa ít lượt hoặc không cung cấp báo cáo (${available}/2 cửa sổ); tiếp tục review với phần còn khả dụng.`);
      } catch {
        await input.context?.appendLog('Không thể lấy từ khóa tìm kiếm qua Analytics; tiếp tục review và ghi nhận đây là dữ liệu chưa khả dụng.');
      }
    } else {
      await input.context?.appendLog('Từ khóa tìm kiếm của video chưa có sẵn và kênh chưa kết nối Analytics; tiếp tục review không có dữ liệu này.');
    }
  }
  const linkedSummary = (await listProjects({})).find((project) => project.channelId === input.profileId && project.youtubeVideoId === video.videoId);
  let linkedProject: ReviewProject | null = null;
  if (linkedSummary) {
    const project = await getProject(linkedSummary.id);
    linkedProject = {
      id: project.id,
      title: project.title,
      updatedAt: project.updatedAt,
      seo: {
        titles: project.seo.titles.map(({ id, text }) => ({ id, text })),
        chosenTitleId: project.seo.chosenTitleId,
        descriptionIntro: project.seo.descriptionIntro,
        descriptionKeywords: project.seo.descriptionKeywords,
        tags: project.seo.tags,
      },
      scenes: project.scenes.map((scene) => ({ id: scene.id, narration: scene.narration, visualPrompt: scene.visualPrompt, durationSec: scene.durationSec, active: scene.active !== false })),
    };
  }
  return buildVideoEvidence({
    planStatus,
    video,
    videos,
    retentionCurve: retention?.curve ?? null,
    retentionFetchedAt: retention?.fetchedAt.toISOString() ?? null,
    project: linkedProject,
    syncedAt,
    channelSearchTerms: channelTraffic?.searchTerms,
  });
}

async function selectedApi(input: { profileId: string; target: YoutubeReviewV2Target; videoId?: string; config: Config }): Promise<{ provider: AiProvider; model: string }> {
  if (input.target === 'video') {
    const linked = (await listProjects({})).find((project) => project.channelId === input.profileId && project.youtubeVideoId === input.videoId);
    if (linked) {
      const project = await getProject(linked.id);
      return { provider: project.aiProvider, model: project.aiModel ?? getDefaultAiModelId(project.aiProvider) };
    }
  }
  return { provider: input.config.DEFAULT_AI_PROVIDER, model: getDefaultAiModelId(input.config.DEFAULT_AI_PROVIDER) };
}

export function youtubeReviewJobScope(profileId: string, target: YoutubeReviewV2Target, videoId?: string): string {
  return `youtube-review:${profileId}:${target}:${target === 'video' ? videoId ?? '' : 'channel'}`;
}

function videoContext(packet: YoutubeReviewEvidencePacket): ReturnType<typeof YoutubeReviewVideoContextSchema.parse> {
  const retention = packet.packet.retention as { mappingQuality?: unknown; drops?: unknown } | undefined;
  const project = packet.packet.project as { id?: unknown } | null | undefined;
  const terms = packet.packet.searchTerms as { window?: unknown; status?: unknown; terms?: unknown }[] | undefined;
  return YoutubeReviewVideoContextSchema.parse({
    mappingQuality: retention?.mappingQuality ?? 'none',
    linkedProjectId: typeof project?.id === 'string' ? project.id : null,
    retentionDrops: Array.isArray(retention?.drops) ? retention.drops.map((value) => {
      const drop = value as Record<string, unknown>;
      return { fromSec: drop.fromSec, toSec: drop.toSec, dropPercent: drop.dropPercent, sceneIndexes: drop.sceneIndexes, narrationExcerpt: drop.sceneNarrationExcerpt ?? '' };
    }) : [],
    searchTerms: Array.isArray(terms) ? terms.filter((row) => row.window === 'last28d' || row.window === 'lifetime').map((row) => ({
      window: row.window,
      status: row.status,
      terms: Array.isArray(row.terms) ? row.terms.map((value) => {
        const term = value as { rank?: unknown; term?: unknown; views?: unknown; metricIds?: unknown };
        const shareId = Array.isArray(term.metricIds) ? term.metricIds.find((id) => typeof id === 'string' && id.endsWith(':share')) : undefined;
        const shareValue = typeof shareId === 'string' ? packet.metricMap[shareId]?.value : null;
        return { rank: term.rank, term: term.term, views: term.views, share: shareValue === null || shareValue === undefined ? null : shareValue * 100 };
      }) : [],
    })) : [],
  });
}

export async function generateYoutubeReviewV2(input: {
  profileId: string; target: YoutubeReviewV2Target; videoId?: string; request: YoutubeReviewV2Request;
  context: YoutubeReviewV2JobContext; config?: Config; fetcher?: typeof fetch;
  getClaudeCliStatus?: (options: { executablePath: string; env?: NodeJS.ProcessEnv }) => Promise<ClaudeCliStatus>;
  clientFactory?: (provider: AiProvider, model: string) => Pick<AiClient, 'chat'>;
  cliChatFactory?: typeof createClaudeCliChat;
}): Promise<ReturnType<typeof YoutubeReviewV2ResultSchema.parse> | undefined> {
  const config = input.config ?? loadConfig();
  const targetId = input.target === 'channel' ? 'channel' : input.videoId;
  if (!targetId) throw new AppError('Thiếu mã video cần phân tích.', 400, 'YOUTUBE_VIDEO_ID_REQUIRED');
  const packet = await buildCurrentEvidence({ profileId: input.profileId, target: input.target, videoId: input.videoId, config, fetcher: input.fetcher, context: input.context, allowRetentionFetch: input.target === 'video' });
  let backend;
  if (input.request.backend === 'cli') {
    const model = input.request.cliModel ?? CLAUDE_CLI_DEFAULT_MODEL;
    if (!isAiModelForProvider('claude', model)) throw new AppError('Model Claude CLI không còn khả dụng; hãy chọn model khác.', 422, 'AI_MODEL_UNAVAILABLE');
    const cli = await (input.cliChatFactory ?? createClaudeCliChat)({
      projectId: input.profileId,
      chapterId: `youtube-review-${input.target}`,
      label: input.target === 'channel' ? 'Đánh giá kênh YouTube' : 'Đánh giá video YouTube',
      model,
      config,
      context: input.context,
      getStatus: input.getClaudeCliStatus,
    });
    backend = { kind: 'cli' as const, model: cli.model, chat: cli.chat };
  } else {
    const ai = await selectedApi({ profileId: input.profileId, target: input.target, videoId: input.videoId, config });
    const client = input.clientFactory?.(ai.provider, ai.model) ?? getAiClient(ai.provider, ai.model);
    backend = { kind: 'api' as const, model: ai.model, chat: (messages: Parameters<typeof client.chat>[0]) => client.chat(messages, { json: true }) };
  }
  await input.context.appendLog(`Bắt đầu phân tích ${input.target === 'channel' ? 'kênh' : 'video'} bằng ${backend.kind === 'cli' ? 'Claude CLI' : `API ${backend.model}`}; gói chứng cứ ${packet.serialized.length} ký tự.`);
  const result = await runYoutubeReviewV2Analysis({ target: input.target, packet, backend, context: input.context });
  if (!result || await input.context.isCancelled()) return undefined;
  const generatedAt = new Date();
  const promptVersion = input.target === 'channel' ? 'youtube-review-v2-channel' : 'youtube-review-v2-video';
  const stored = YoutubeReviewV2DocSchema.parse({
    _id: `${input.profileId}:${input.target}:${targetId}:${promptVersion}`,
    channelProfileId: input.profileId,
    target: input.target,
    targetId,
    promptVersion,
    backend: backend.kind,
    model: backend.model,
    dataFingerprint: packet.fingerprint,
    packetSummary: packet.packetSummary,
    groundingReport: result.groundingReport,
    metricMap: packet.metricMap,
    analysis: result.analysis,
    ...(result.ideas ? { ideas: result.ideas } : {}),
    generatedAt,
  });
  if (await input.context.isCancelled()) return undefined;
  await upsertReview(stored);
  await input.context.appendLog('Đã lưu kết quả và số liệu trích dẫn; không lưu gói narration hoặc token OAuth.');
  return YoutubeReviewV2ResultSchema.parse({
    target: stored.target,
    targetId: stored.targetId,
    promptVersion: stored.promptVersion,
    backend: stored.backend,
    model: stored.model,
    dataFingerprint: stored.dataFingerprint,
    packetSummary: stored.packetSummary,
    groundingReport: stored.groundingReport,
    generatedAt: stored.generatedAt.toISOString(),
    stale: false,
    metricMap: stored.metricMap,
    analysis: stored.analysis,
    ...(stored.ideas ? { ideas: stored.ideas } : {}),
    ...(input.target === 'video' ? { videoContext: videoContext(packet) } : {}),
  });
}

export async function getYoutubeReviewV2(input: {
  profileId: string; target: YoutubeReviewV2Target; videoId?: string; config?: Config; fetcher?: typeof fetch;
}): Promise<ReturnType<typeof YoutubeReviewV2ResultSchema.parse> | null> {
  const targetId = input.target === 'channel' ? 'channel' : input.videoId;
  if (!targetId) throw new AppError('Thiếu mã video cần phân tích.', 400, 'YOUTUBE_VIDEO_ID_REQUIRED');
  const stored = await findYoutubeReviewV2(input.profileId, input.target, targetId);
  if (!stored) return null;
  const current = await buildCurrentEvidence({ profileId: input.profileId, target: input.target, videoId: input.videoId, config: input.config ?? loadConfig(), fetcher: input.fetcher, allowRetentionFetch: false });
  return YoutubeReviewV2ResultSchema.parse({
    target: stored.target,
    targetId: stored.targetId,
    promptVersion: stored.promptVersion,
    backend: stored.backend,
    model: stored.model,
    dataFingerprint: stored.dataFingerprint,
    packetSummary: stored.packetSummary,
    groundingReport: stored.groundingReport,
    generatedAt: stored.generatedAt.toISOString(),
    stale: stored.dataFingerprint !== current.fingerprint,
    metricMap: stored.metricMap,
    analysis: stored.analysis,
    ...(stored.ideas ? { ideas: stored.ideas } : {}),
    ...(input.target === 'video' ? { videoContext: videoContext(current) } : {}),
  });
}
