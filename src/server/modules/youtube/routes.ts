import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config';
import { getChannel, listChannels } from '../channel';
import { AppError, NotFound } from '../../shared/errors';
import type { JobSummary } from '../../../contracts/job';
import { RefreshYoutubeProfileRequestSchema, YoutubeVideoStatsSchema, type YoutubeVideoStats } from '../../../contracts/youtube';
import { countVideoDocs, findCredential, listVideoDocs } from './repo';
import type { YoutubeVideoDoc } from './docs';
import { assertYoutubeConfigured, assertYoutubeQuotaAllowsSync, beginYoutubeImport, beginYoutubeOauth, completeYoutubeOauth, disconnectYoutube, discardYoutubeOauthState, getYoutubeConnection, getYoutubeImportOptions, getYoutubeOauthOpenerOrigin, refreshYoutubeProfile, selectYoutubeChannel, selectYoutubeImportChannels, youtubeIsConfigured, YOUTUBE_SETUP_MESSAGE } from './service';
import { clearYoutubeAccessToken, getYoutubeAccessToken } from './sync';
import { buildChannelHealth, buildChannelTrend, buildVideoCohorts, compareVideoToChannelMedian, getRetentionDropSegments, getVideoRanking, YOUTUBE_PARTNER_PROGRAM_THRESHOLDS } from './analysis';
import { getSuggestedYoutubeLinks } from './link-service';
import { generateYoutubeReview, getYoutubeReview } from './review-service';
import { getYoutubeRetention, getStoredChannelDaily } from './analytics-service';
import { getProject, listProjects } from '../project';
import { YoutubeChannelsOverviewSchema, YoutubeChannelOverviewRowSchema, YoutubeSyncAllResultSchema } from '../../../contracts/youtube-overview';
import { buildYoutubeOverviewWindows } from './channel-overview';

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

function callbackPage(message: string, success: boolean, openerOrigin?: string): string {
  const safeMessage = escapeHtml(message);
  const targetOrigin = openerOrigin ? JSON.stringify(openerOrigin) : 'location.origin';
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>YouTube</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#111;color:#eee"><h1>${success ? 'Đã kết nối' : 'Không thể kết nối'}</h1><p>${safeMessage}</p><button onclick="window.close()">Đóng cửa sổ</button> <a href="/" style="color:#ffd36a">Quay lại Video Tool</a><script>if(window.opener){window.opener.postMessage({type:'youtube-oauth-finished',success:${success}},${targetOrigin});window.close()}</script></body></html>`;
}

function trustedLocalOpenerOrigin(req: import('express').Request, apiPort: number): string | undefined {
  const rawOrigin = req.get('origin');
  if (!rawOrigin) return undefined;
  try {
    const parsed = new URL(rawOrigin);
    const allowed = new Set([
      `http://localhost:${apiPort}`,
      `http://127.0.0.1:${apiPort}`,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    return parsed.origin === rawOrigin && allowed.has(parsed.origin) ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

function choicePage(profileId: string, selectionId: string, options: { youtubeChannelId: string; title: string; handle?: string }[]): string {
  const action = `/api/youtube/oauth/select/${encodeURIComponent(profileId)}`;
  const rows = options.map((option, index) => `<label style="display:block;padding:1rem;border:1px solid #555;margin:.5rem 0"><input type="radio" name="youtubeChannelId" value="${escapeHtml(option.youtubeChannelId)}" ${index === 0 ? 'checked' : ''}> ${escapeHtml(option.title)} ${option.handle ? `(${escapeHtml(option.handle)})` : ''}</label>`).join('');
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Chọn kênh YouTube</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#111;color:#eee"><h1>Chọn kênh YouTube</h1><p>Tài khoản Google có nhiều kênh. Chọn kênh sẽ gắn với hồ sơ Video Tool này.</p><form method="post" action="${action}"><input type="hidden" name="selectionId" value="${escapeHtml(selectionId)}">${rows}<button type="submit">Xác nhận kênh</button></form></body></html>`;
}

function importPage(selectionId: string, options: Awaited<ReturnType<typeof getYoutubeImportOptions>>): string {
  const rows = options.map((option) => {
    const disabled = Boolean(option.boundProfileName);
    const image = option.thumbnailUrl ? `<img src="${escapeHtml(option.thumbnailUrl)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover">` : '';
    const owner = disabled ? `<small style="display:block;color:#f3c568">Đã gắn với hồ sơ ${escapeHtml(option.boundProfileName!)}</small>` : '';
    const handle = option.handle ? `<span style="color:#aaa">${escapeHtml(option.handle)}</span>` : '';
    return `<label style="display:flex;align-items:center;gap:.8rem;padding:.8rem;border:1px solid #555;border-radius:.5rem;margin:.5rem 0;${disabled ? 'opacity:.65' : ''}"><input type="checkbox" name="youtubeChannelIds" value="${escapeHtml(option.youtubeChannelId)}" ${disabled ? 'disabled' : 'checked'}><span>${image}</span><span><strong>${escapeHtml(option.title || 'Kênh chưa có tên')}</strong> ${handle}${owner}</span></label>`;
  }).join('');
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Thêm kênh YouTube</title><body style="font:16px system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem;background:#111;color:#eee"><h1>Thêm kênh từ YouTube</h1><p>Google quyết định kênh nào được liệt kê; một kênh khác đôi khi cần một lần đăng nhập khác.</p><form method="post" action="/api/youtube/import/select"><input type="hidden" name="selectionId" value="${escapeHtml(selectionId)}">${rows}<button type="submit" ${options.every((option) => option.boundProfileName) ? 'disabled' : ''}>Thêm kênh đã chọn</button></form><p><button onclick="window.close()">Đóng cửa sổ</button></p></body></html>`;
}

function importResultPage(results: Awaited<ReturnType<typeof selectYoutubeImportChannels>>['results'], openerOrigin?: string): string {
  const imported = results.filter((result) => result.ok).length;
  const skipped = results.length - imported;
  const alreadyBound = results.filter((result) => !result.ok && result.reason?.includes('đã được gắn')).length;
  const failed = skipped - alreadyBound;
  const profileIds = JSON.stringify(results.flatMap((result) => result.ok && result.profileId ? [result.profileId] : [])).replace(/</g, '\\u003c');
  const rows = results.map((result) => `<li>${escapeHtml(result.youtubeChannelId)}: ${result.ok ? 'Đã thêm hồ sơ.' : escapeHtml(result.reason ?? 'Không thể thêm hồ sơ.')}</li>`).join('');
  const targetOrigin = openerOrigin ? JSON.stringify(openerOrigin) : 'location.origin';
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết quả thêm kênh</title><body style="font:16px system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem;background:#111;color:#eee"><h1>Đã xử lý lựa chọn kênh</h1><p>Đã thêm ${imported} kênh, bỏ qua ${skipped} kênh.</p><ul>${rows}</ul><button onclick="window.close()">Đóng cửa sổ</button><script>if(window.opener){window.opener.postMessage({type:'youtube-oauth-finished',success:true,imported:${imported},skipped:${skipped},alreadyBound:${alreadyBound},failed:${failed},profileIds:${profileIds}},${targetOrigin});window.close()}</script></body></html>`;
}

export function createYoutubeRouter(options: { config: Config; enqueueJob: EnqueueYoutubeJob; getActiveJob: GetActiveYoutubeJob; fetcher?: typeof fetch }): Router {
  const router = Router();

  router.get('/setup', (_req, res) => {
    const configured = youtubeIsConfigured(options.config);
    res.json({ configured, ...(!configured ? { message: YOUTUBE_SETUP_MESSAGE } : {}) });
  });

  router.get('/channels-overview', async (_req, res) => {
    const profiles = await listChannels();
    const channels = await Promise.all(profiles.map(async (profile) => {
      const [connection, daily, videos, credential, activeJob] = await Promise.all([
        getYoutubeConnection(profile.id, options.config),
        getStoredChannelDaily(profile.id),
        listVideoDocs(profile.id, { removed: { $ne: true } }),
        findCredential(profile.id),
        options.getActiveJob(profile.id, 'youtube-sync'),
      ]);
      const windows = buildYoutubeOverviewWindows(daily);
      const rankings = getVideoRanking(videos);
      const topRank = rankings.viewsPerDay[0];
      const topVideo = topRank ? videos.find((video) => video.videoId === topRank.videoId) : undefined;
      return YoutubeChannelOverviewRowSchema.parse({
        channelId: profile.id,
        name: profile.name,
        ...(profile.handle ? { handle: profile.handle } : {}),
        language: profile.language,
        connection,
        subscriberCount: credential?.subscriberCount ?? null,
        videoCount: videos.length,
        longCount: videos.filter((video) => !video.isShort).length,
        shortCount: videos.filter((video) => video.isShort).length,
        last28: windows.last28,
        previous28: windows.previous28,
        trend: windows.trend,
        health: buildChannelHealth({ subscriberCount: credential?.subscriberCount ?? null, videos, dataSynced: Boolean(connection.lastSyncAt) }),
        activeSyncJobId: activeJob?.id ?? null,
        topVideo: topRank && topVideo ? { videoId: topVideo.videoId, title: topVideo.title, viewsPerDay: topRank.value } : null,
      });
    }));
    const connected = channels.filter((channel) => channel.connection.connected);
    const sumKnown = (values: readonly (number | null)[]) => {
      const known = values.filter((value): value is number => value !== null);
      return known.length ? known.reduce((total, value) => total + value, 0) : null;
    };
    res.json(YoutubeChannelsOverviewSchema.parse({
      channels,
      totals: {
        subscriberCount: sumKnown(connected.map((channel) => channel.subscriberCount)),
        views28: sumKnown(connected.map((channel) => channel.last28.views)),
        watchHours28: (() => {
          const known = connected.flatMap((channel) => channel.last28.estimatedMinutesWatched === null ? [] : [channel.last28.estimatedMinutesWatched / 60]);
          return known.length ? known.reduce((total, value) => total + value, 0) : null;
        })(),
        subscribersGained28: sumKnown(connected.map((channel) => channel.last28.subscribersGained)),
        channelsConnected: connected.length,
        channelsNeedReconnect: channels.filter((channel) => channel.connection.needsReconnect).length,
      },
    }));
  });

  router.post('/connect/:channelId', async (req, res) => {
    await getChannel(req.params.channelId);
    const host = String(req.headers.host ?? '').split(':')[0]?.toLowerCase();
    const redirectHost = host === '127.0.0.1' ? '127.0.0.1' : 'localhost';
    res.json({ authorizationUrl: beginYoutubeOauth(req.params.channelId, options.config, redirectHost, trustedLocalOpenerOrigin(req, options.config.PORT)) });
  });

  router.post('/import/start', async (req, res) => {
    const host = String(req.headers.host ?? '').split(':')[0]?.toLowerCase();
    const redirectHost = host === '127.0.0.1' ? '127.0.0.1' : 'localhost';
    res.json({ authorizationUrl: beginYoutubeImport(options.config, redirectHost, trustedLocalOpenerOrigin(req, options.config.PORT)) });
  });

  router.get('/oauth/callback', async (req, res) => {
    const openerOrigin = getYoutubeOauthOpenerOrigin(typeof req.query.state === 'string' ? req.query.state : undefined);
    const host = String(req.headers.host ?? '').split(':')[0]?.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1') {
      res.status(400).type('html').send(callbackPage('Hãy mở Video Tool từ localhost rồi thử kết nối lại.', false));
      return;
    }
    if (typeof req.query.error === 'string') {
      discardYoutubeOauthState(typeof req.query.state === 'string' ? req.query.state : undefined);
      res.status(400).type('html').send(callbackPage('Google đã hủy hoặc từ chối quyền đọc YouTube.', false, openerOrigin));
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
      if (result.mode === 'import') {
        res.type('html').send(importPage(result.selectionId, await getYoutubeImportOptions(result.selectionId)));
        return;
      }
      if (!result.selected && result.selectionId) {
        res.type('html').send(choicePage(result.profileId, result.selectionId, result.channelOptions));
        return;
      }
      res.type('html').send(callbackPage('Kênh đã được liên kết. Bạn có thể quay lại Video Tool.', true, result.openerOrigin));
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Không thể hoàn tất kết nối YouTube. Hãy thử lại.';
      res.status(error instanceof AppError ? error.status : 502).type('html').send(callbackPage(message, false, openerOrigin));
    }
  });

  router.post('/import/select', async (req, res) => {
    const rawIds = req.body?.youtubeChannelIds;
    const form = z.object({ selectionId: z.string().min(1), youtubeChannelIds: z.array(z.string().min(1)).min(1) }).safeParse({
      selectionId: req.body?.selectionId,
      youtubeChannelIds: Array.isArray(rawIds) ? rawIds : typeof rawIds === 'string' ? [rawIds] : [],
    });
    if (!form.success) throw new AppError('Chọn ít nhất một kênh chưa được gắn với hồ sơ rồi thử lại.', 400, 'YOUTUBE_IMPORT_SELECTION_INVALID');
    const result = await selectYoutubeImportChannels(form.data.selectionId, form.data.youtubeChannelIds, options.config);
    res.type('html').send(importResultPage(result.results, result.openerOrigin));
  });

  router.post('/oauth/select/:channelId', async (req, res) => {
    const form = z.object({ youtubeChannelId: z.string().min(1), selectionId: z.string().min(1) }).safeParse({
      youtubeChannelId: req.body?.youtubeChannelId,
      selectionId: req.body?.selectionId,
    });
    if (!form.success) throw new AppError('Chọn một kênh YouTube rồi thử lại.', 400, 'YOUTUBE_CHANNEL_CHOICE_INVALID');
    try {
      const selection = await selectYoutubeChannel(req.params.channelId, form.data.youtubeChannelId, form.data.selectionId, options.config);
      res.type('html').send(callbackPage('Kênh đã được liên kết. Bạn có thể quay lại Video Tool.', true, selection.openerOrigin));
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

  router.post('/sync-all', async (_req, res) => {
    assertYoutubeConfigured(options.config);
    const profiles = await listChannels();
    const results = await Promise.all(profiles.map(async (profile) => {
      try {
        const connection = await getYoutubeConnection(profile.id, options.config);
        if (connection.needsReconnect) {
          return { channelId: profile.id, jobId: null, skipped: 'needs-reconnect' as const, message: 'Cần kết nối lại YouTube.' };
        }
        if (!connection.connected) {
          return { channelId: profile.id, jobId: null, skipped: 'not-connected' as const, message: 'Chưa kết nối YouTube.' };
        }
        await assertYoutubeQuotaAllowsSync(profile.id, options.config, await countVideoDocs(profile.id));
        const active = await options.getActiveJob(profile.id, 'youtube-sync');
        if (active) return { channelId: profile.id, jobId: active.id, skipped: 'already-running' as const, message: 'Đang có lượt đồng bộ chạy.' };
        const job = await options.enqueueJob({ type: 'youtube-sync', projectId: profile.id, payload: { channelProfileId: profile.id }, maxAttempts: 1 });
        return { channelId: profile.id, jobId: job.id };
      } catch (error) {
        if (error instanceof AppError && error.code === 'YOUTUBE_QUOTA_LIMIT') {
          return { channelId: profile.id, jobId: null, skipped: 'quota' as const, message: error.message };
        }
        return {
          channelId: profile.id,
          jobId: null,
          message: error instanceof AppError ? error.message : 'Không thể xếp hàng đồng bộ kênh này. Hãy thử lại.',
        };
      }
    }));
    res.json(YoutubeSyncAllResultSchema.parse({ results }));
  });

  router.get('/channels/:channelId/sync-job', async (req, res) => {
    await getChannel(req.params.channelId);
    const active = await options.getActiveJob(req.params.channelId, 'youtube-sync');
    res.json({ jobId: active?.id ?? null });
  });

  router.post('/channels/:channelId/refresh-profile', async (req, res) => {
    await getChannel(req.params.channelId);
    const body = RefreshYoutubeProfileRequestSchema.parse(req.body ?? {});
    res.json(await refreshYoutubeProfile(req.params.channelId, options.config, body, options.fetcher));
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
