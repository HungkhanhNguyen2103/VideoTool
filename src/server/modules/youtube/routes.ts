import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config';
import { getChannel } from '../channel';
import { AppError, NotFound } from '../../shared/errors';
import type { JobSummary } from '../../../contracts/job';
import { YoutubeVideoStatsSchema, type YoutubeVideoStats } from '../../../contracts/youtube';
import { countVideoDocs, findCredential, listVideoDocs } from './repo';
import type { YoutubeVideoDoc } from './docs';
import { assertYoutubeConfigured, assertYoutubeQuotaAllowsSync, beginYoutubeOauth, completeYoutubeOauth, disconnectYoutube, discardYoutubeOauthState, getYoutubeConnection, selectYoutubeChannel } from './service';
import { clearYoutubeAccessToken, getYoutubeAccessToken } from './sync';
import { buildChannelHealth, buildChannelTrend, buildVideoCohorts, compareVideoToChannelMedian, getRetentionDropSegments, getVideoRanking, YOUTUBE_PARTNER_PROGRAM_THRESHOLDS } from './analysis';
import { getSuggestedYoutubeLinks } from './link-service';
import { generateYoutubeReview, getYoutubeReview } from './review-service';
import { getYoutubeRetention, getStoredChannelDaily } from './analytics-service';
import { getProject, listProjects } from '../project';

type EnqueueYoutubeJob = (input: { type: string; projectId: string; payload: unknown; maxAttempts?: number }) => Promise<JobSummary>;
type GetActiveYoutubeJob = (projectId: string, type: string) => Promise<JobSummary | null>;

const DisconnectSchema = z.object({ deleteSyncedData: z.boolean().default(false) }).strict();

function toPublicVideoStats(video: YoutubeVideoDoc): YoutubeVideoStats {
  return YoutubeVideoStatsSchema.parse({
    videoId: video.videoId,
    title: video.title,
    publishedAt: video.publishedAt,
    durationSec: video.durationSec,
    isShort: video.isShort,
    privacy: video.privacy,
    viewCount: video.viewCount,
    likeCount: video.likeCount,
    commentCount: video.commentCount,
    fetchedAt: video.fetchedAt,
    analytics: video.analytics,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function callbackPage(message: string, success: boolean): string {
  const safeMessage = escapeHtml(message);
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>YouTube</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#111;color:#eee"><h1>${success ? 'Đã kết nối' : 'Không thể kết nối'}</h1><p>${safeMessage}</p><button onclick="window.close()">Đóng cửa sổ</button> <a href="/" style="color:#ffd36a">Quay lại Video Tool</a><script>if(window.opener){window.opener.postMessage({type:'youtube-oauth-finished',success:${success}},location.origin);window.close()}</script></body></html>`;
}

function choicePage(profileId: string, selectionId: string, options: { youtubeChannelId: string; title: string; handle?: string }[]): string {
  const action = `/api/youtube/oauth/select/${encodeURIComponent(profileId)}`;
  const rows = options.map((option, index) => `<label style="display:block;padding:1rem;border:1px solid #555;margin:.5rem 0"><input type="radio" name="youtubeChannelId" value="${escapeHtml(option.youtubeChannelId)}" ${index === 0 ? 'checked' : ''}> ${escapeHtml(option.title)} ${option.handle ? `(${escapeHtml(option.handle)})` : ''}</label>`).join('');
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Chọn kênh YouTube</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#111;color:#eee"><h1>Chọn kênh YouTube</h1><p>Tài khoản Google có nhiều kênh. Chọn kênh sẽ gắn với hồ sơ Video Tool này.</p><form method="post" action="${action}"><input type="hidden" name="selectionId" value="${escapeHtml(selectionId)}">${rows}<button type="submit">Xác nhận kênh</button></form></body></html>`;
}

export function createYoutubeRouter(options: { config: Config; enqueueJob: EnqueueYoutubeJob; getActiveJob: GetActiveYoutubeJob; fetcher?: typeof fetch }): Router {
  const router = Router();

  router.post('/connect/:channelId', async (req, res) => {
    await getChannel(req.params.channelId);
    const host = String(req.headers.host ?? '').split(':')[0]?.toLowerCase();
    const redirectHost = host === '127.0.0.1' ? '127.0.0.1' : 'localhost';
    res.json({ authorizationUrl: beginYoutubeOauth(req.params.channelId, options.config, redirectHost) });
  });

  router.get('/oauth/callback', async (req, res) => {
    const host = String(req.headers.host ?? '').split(':')[0]?.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1') {
      res.status(400).type('html').send(callbackPage('Hãy mở Video Tool từ localhost rồi thử kết nối lại.', false));
      return;
    }
    if (typeof req.query.error === 'string') {
      discardYoutubeOauthState(typeof req.query.state === 'string' ? req.query.state : undefined);
      res.status(400).type('html').send(callbackPage('Google đã hủy hoặc từ chối quyền đọc YouTube.', false));
      return;
    }
    try {
      const result = await completeYoutubeOauth({
        state: typeof req.query.state === 'string' ? req.query.state : undefined,
        code: typeof req.query.code === 'string' ? req.query.code : undefined,
        callbackHost: host,
        config: options.config,
        fetcher: options.fetcher,
      });
      if (!result.selected && result.selectionId) {
        res.type('html').send(choicePage(result.profileId, result.selectionId, result.channelOptions));
        return;
      }
      res.type('html').send(callbackPage('Kênh đã được liên kết. Bạn có thể quay lại Video Tool.', true));
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Không thể hoàn tất kết nối YouTube. Hãy thử lại.';
      res.status(error instanceof AppError ? error.status : 502).type('html').send(callbackPage(message, false));
    }
  });

  router.post('/oauth/select/:channelId', async (req, res) => {
    const form = z.object({ youtubeChannelId: z.string().min(1), selectionId: z.string().min(1) }).safeParse({
      youtubeChannelId: req.body?.youtubeChannelId,
      selectionId: req.body?.selectionId,
    });
    if (!form.success) throw new AppError('Chọn một kênh YouTube rồi thử lại.', 400, 'YOUTUBE_CHANNEL_CHOICE_INVALID');
    try {
      await selectYoutubeChannel(req.params.channelId, form.data.youtubeChannelId, form.data.selectionId, options.config);
      res.type('html').send(callbackPage('Kênh đã được liên kết. Bạn có thể quay lại Video Tool.', true));
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Không thể gắn kênh YouTube đã chọn.';
      res.status(error instanceof AppError ? error.status : 502).type('html').send(callbackPage(message, false));
    }
  });

  router.get('/connection/:channelId', async (req, res) => {
    await getChannel(req.params.channelId);
    res.json(await getYoutubeConnection(req.params.channelId, options.config));
  });

  router.post('/disconnect/:channelId', async (req, res) => {
    await getChannel(req.params.channelId);
    const body = DisconnectSchema.parse(req.body ?? {});
    await disconnectYoutube(req.params.channelId, options.config, body.deleteSyncedData, options.fetcher);
    clearYoutubeAccessToken(req.params.channelId);
    res.status(204).end();
  });

  router.post('/sync/:channelId', async (req, res) => {
    assertYoutubeConfigured(options.config);
    await getChannel(req.params.channelId);
    const connection = await getYoutubeConnection(req.params.channelId, options.config);
    if (!connection.connected) throw new AppError('Cần kết nối YouTube trước khi đồng bộ.', 409, 'YOUTUBE_NOT_CONNECTED');
    await assertYoutubeQuotaAllowsSync(req.params.channelId, options.config, await countVideoDocs(req.params.channelId));
    const active = await options.getActiveJob(req.params.channelId, 'youtube-sync');
    if (active) { res.status(200).json({ jobId: active.id }); return; }
    const job = await options.enqueueJob({ type: 'youtube-sync', projectId: req.params.channelId, payload: { channelProfileId: req.params.channelId }, maxAttempts: 1 });
    res.status(201).json({ jobId: job.id });
  });

  router.get('/channels/:channelId/sync-job', async (req, res) => {
    await getChannel(req.params.channelId);
    const active = await options.getActiveJob(req.params.channelId, 'youtube-sync');
    res.json({ jobId: active?.id ?? null });
  });

  router.get('/channels/:channelId/overview', async (req, res) => {
    await getChannel(req.params.channelId);
    const connection = await getYoutubeConnection(req.params.channelId, options.config);
    if (!connection.connected) throw new AppError('Kết nối kênh YouTube rồi đồng bộ để xem số liệu.', 409, 'YOUTUBE_NOT_CONNECTED');
    const [daily, videos, credential, summaries] = await Promise.all([
      getStoredChannelDaily(req.params.channelId),
      listVideoDocs(req.params.channelId, { removed: { $ne: true } }),
      findCredential(req.params.channelId),
      listProjects({}),
    ]);
    const projects = await Promise.all(summaries.filter((project) => project.channelId === req.params.channelId && project.youtubeVideoId).map((project) => getProject(project.id)));
    const byVideo = new Map(projects.filter((project) => project.youtubeVideoId).map((project) => [project.youtubeVideoId!, project]));
    const profile = await getChannel(req.params.channelId);
    const timezone = profile.publishSchedule?.timezone ?? 'Asia/Ho_Chi_Minh';
    const cohortRows = videos.map((video) => {
      const project = byVideo.get(video.videoId);
      return { video, project: project ? { scriptPresetId: project.scriptPresetId, visualStylePresetId: project.visualStylePresetId } : null };
    });
    const channelReview = await getYoutubeReview(req.params.channelId, 'channel');
    res.json({
      connection, daily, videoCount: videos.length, synced: videos.length > 0,
      trend: buildChannelTrend(daily),
      health: buildChannelHealth({ subscriberCount: credential?.subscriberCount ?? null, videos, dataSynced: Boolean(connection.lastSyncAt) }),
      thresholds: YOUTUBE_PARTNER_PROGRAM_THRESHOLDS,
      rankings: getVideoRanking(videos),
      cohorts: buildVideoCohorts(cohortRows, timezone),
      channelReview,
      analyticsStatus: credential?.lastSyncReport ?? {},
    });
  });

  router.get('/channels/:channelId/videos', async (req, res) => {
    await getChannel(req.params.channelId);
    let videos = await listVideoDocs(req.params.channelId, { removed: { $ne: true } });
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'publishedAt';
    const window = typeof req.query.window === 'string' ? req.query.window : '28d';
    if (!['28d', '90d', '365d', 'lifetime'].includes(window)) throw new AppError('Khung thời gian video không hợp lệ.', 400, 'YOUTUBE_WINDOW_INVALID');
    const type = typeof req.query.type === 'string' ? req.query.type : 'all';
    if (!['all', 'long', 'short'].includes(type)) throw new AppError('Bộ lọc video không hợp lệ.', 400, 'YOUTUBE_VIDEO_FILTER_INVALID');
    if (type !== 'all') videos = videos.filter((video) => type === 'short' ? video.isShort : !video.isShort);
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase() : '';
    if (search) videos = videos.filter((video) => video.title.toLocaleLowerCase().includes(search));
    const allowed = new Set(['publishedAt', 'viewCount', 'durationSec', 'title', 'viewsPerDay', 'averageViewPercentage', 'clickThroughRate', 'subscribersPerThousandViews']);
    if (!allowed.has(sort)) throw new AppError('Cách sắp xếp video không hợp lệ.', 400, 'YOUTUBE_SORT_INVALID');
    const rankings = getVideoRanking(videos, new Date(), window);
    const rankMaps = new Map<string, Map<string, number>>([
      ['viewsPerDay', new Map(rankings.viewsPerDay.map((row) => [row.videoId, row.value]))],
      ['averageViewPercentage', new Map(rankings.averageViewPercentage.map((row) => [row.videoId, row.value]))],
      ['clickThroughRate', new Map(rankings.clickThroughRate.map((row) => [row.videoId, row.value]))],
      ['subscribersPerThousandViews', new Map(rankings.subscribersPerThousandViews.map((row) => [row.videoId, row.value]))],
    ]);
    const sorted = [...videos].sort((a, b) => {
      const map = rankMaps.get(sort);
      if (map) return (map.get(b.videoId) ?? -Infinity) - (map.get(a.videoId) ?? -Infinity);
      const left = a[sort as keyof typeof a]; const right = b[sort as keyof typeof b];
      return typeof left === 'number' && typeof right === 'number' ? right - left : String(right ?? '').localeCompare(String(left ?? ''));
    });
    const linked = await listProjects({});
    const linkedByVideo = new Map(await Promise.all(linked.filter((project) => project.channelId === req.params.channelId && project.youtubeVideoId).map(async (summary) => {
      const project = await getProject(summary.id);
      return [project.youtubeVideoId!, { id: project.id, title: project.title, scriptPresetId: project.scriptPresetId, visualStylePresetId: project.visualStylePresetId }] as const;
    })));
    res.json(sorted.map((video) => ({ ...toPublicVideoStats(video), ranking: Object.fromEntries([...rankMaps.entries()].map(([key, map]) => [key, map.get(video.videoId) ?? null])), linkedProject: linkedByVideo.get(video.videoId) ?? null })));
  });

  router.get('/videos/:channelId/:videoId', async (req, res) => {
    await getChannel(req.params.channelId);
    const credential = await findCredential(req.params.channelId);
    if (!credential?.youtubeChannelId) throw new NotFound('Không tìm thấy video đã đồng bộ.');
    const video = (await listVideoDocs(req.params.channelId, { videoId: req.params.videoId, removed: { $ne: true } }))[0];
    if (!video) throw new NotFound('Không tìm thấy video đã đồng bộ.');
    const channelVideos = await listVideoDocs(req.params.channelId, { removed: { $ne: true } });
    const channelComparison = compareVideoToChannelMedian(video, channelVideos);
    const retention = await getYoutubeRetention(req.params.channelId, video, () => getYoutubeAccessToken(req.params.channelId, options.fetcher, options.config), options.fetcher);
    const linked = (await listProjects({})).find((project) => project.channelId === req.params.channelId && project.youtubeVideoId === video.videoId);
    const linkedProject = linked ? await getProject(linked.id) : null;
    const dropSegments = retention.curve ? getRetentionDropSegments(retention.curve, video.durationSec) : null;
    const review = await getYoutubeReview(req.params.channelId, 'video', video.videoId);
    res.json({ ...toPublicVideoStats(video), retentionCurve: retention.curve, retentionUnavailableReason: retention.reason, dropSegments, channelComparison, linkedProject: linkedProject ? { id: linkedProject.id, title: linkedProject.title, scriptPresetId: linkedProject.scriptPresetId, visualStylePresetId: linkedProject.visualStylePresetId } : null, review });
  });

  router.get('/channels/:channelId/suggested-links', async (req, res) => {
    await getChannel(req.params.channelId);
    res.json(await getSuggestedYoutubeLinks(req.params.channelId));
  });

  router.post('/channels/:channelId/review', async (req, res) => {
    await getChannel(req.params.channelId);
    res.json(await generateYoutubeReview({ profileId: req.params.channelId, target: 'channel', fetcher: options.fetcher, config: options.config }));
  });

  router.post('/videos/:channelId/:videoId/review', async (req, res) => {
    await getChannel(req.params.channelId);
    res.json(await generateYoutubeReview({ profileId: req.params.channelId, target: 'video', videoId: req.params.videoId, fetcher: options.fetcher, config: options.config }));
  });

  return router;
}
