import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Document } from 'mongodb';
import type { JobSummary } from '../../../contracts/job';
import type { ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import { getCollection } from '../../db/client';
import { errorHandler } from '../../error-handler';
import { loadConfig } from '../../config';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createChannel } from '../channel';
import { createProject } from '../project';
import { enqueueJob, ensureJobIndexes, getActiveJobByType } from '../job';
import { ensureYoutubeIndexes } from './indexes';
import { createYoutubeRouter } from './routes';
import { saveYoutubeIdeaRun } from './idea-repo';

type TestDoc = Document & { _id: string; [key: string]: unknown };
const config = loadConfig({ DEFAULT_AI_PROVIDER: 'deepseek', PORT: '3000' });
let server: Server | null = null;

const content = {
  id: 'candidate-1', title: 'Kế hoạch hoàn hảo tự sụp đổ', hook: 'Mở đầu khi cái bẫy khép lại.',
  brief: 'Một người dựng kế hoạch hoàn hảo. Một điểm mù bị bỏ qua. Dấu hiệu cảnh báo xuất hiện. Nhân vật vẫn tiếp tục hành động. Cái bẫy dần khép lại. Thất bại đến từ chính kế hoạch ấy.',
  presetId: 'hubris-trap' as const,
  motif: {
    hunter: { text: 'Người chủ động đặt bẫy.', evidence: 'strong' as const },
    perfectPlan: { text: 'Kế hoạch được chuẩn bị.', evidence: 'partial' as const },
    blindSpot: { text: 'Một giả định bị bỏ qua.', evidence: 'partial' as const },
    selfDestruction: { text: 'Kế hoạch quay lại gây hại.', evidence: 'strong' as const },
  },
  whyForThisChannel: 'Phù hợp với ngôn ngữ và chủ đề trong hồ sơ kênh.', testVariable: 'topic' as const,
  successCriterion: { description: 'Đánh giá sau ba video.', afterVideos: 3 },
  unverifiedFacts: ['Tên sự kiện cần kiểm chứng.'], risks: [], evidenceTier: 'no-performance-data' as const,
  scores: { fit: 4, clarity: 4, riskOfThinSources: 2 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
};

async function saveIdea(channelId: string) {
  await saveYoutubeIdeaRun({
    run: {
      _id: 'run-idea-1', channelProfileId: channelId, evidenceTier: 'no-performance-data', backend: 'cli', model: 'claude-opus-4-5',
      promptVersion: 'video-ideas-v1', generatedAt: '2026-10-22T10:00:00.000Z', requestedCount: 6,
      packetSummary: { projectCount: 0, syncedVideoCount: 0, savedIdeaCount: 0, matureVideoCount: 2 }, coverageFingerprint: 'a'.repeat(64),
      dropped: [], durations: { generateMs: 100, critiqueMs: 200, totalMs: 300 },
    },
    ideas: [{
      _id: 'idea-1', channelProfileId: channelId, runId: 'run-idea-1', evidenceTier: 'no-performance-data', backend: 'cli', model: 'claude-opus-4-5',
      promptVersion: 'video-ideas-v1', generatedAt: '2026-10-22T10:00:00.000Z', idea: content, status: 'new',
    }],
  });
}

beforeAll(async () => { await startTestMongo(); await ensureYoutubeIndexes(); await ensureJobIndexes(); });
beforeEach(async () => {
  for (const collection of ['youtubeVideos', 'youtubeChannelDaily', 'youtubeChannelTraffic', 'youtubeGrowthPlans', 'youtubeRetention', 'youtubeCredentials', 'youtubeVideoIdeas', 'youtubeIdeaRuns', 'channels', 'projects', 'jobs']) {
    await getCollection<TestDoc>(collection).deleteMany({});
  }
});
afterEach(async () => { const current = server; server = null; if (current) await new Promise<void>((resolve) => current.close(() => resolve())); });
afterAll(async () => closeTestMongo());

async function startApi(options: {
  enqueueJob?: (input: { type: string; projectId: string; payload: unknown; maxAttempts?: number }) => Promise<JobSummary>;
  getActiveJob?: (projectId: string, type: string) => Promise<JobSummary | null>;
  getClaudeCliStatus?: () => Promise<ClaudeCliStatus>;
} = {}): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/api/youtube', createYoutubeRouter({
    config,
    enqueueJob: options.enqueueJob ?? (async () => ({ id: 'job-idea-1' } as JobSummary)),
    getActiveJob: options.getActiveJob ?? (async () => null),
    ...(options.getClaudeCliStatus ? { getClaudeCliStatus: options.getClaudeCliStatus } : {}),
  }));
  app.use(errorHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('YouTube video idea routes', () => {
  it('returns a no-performance-data gate and reports a duplicate job id for a second generation request', async () => {
    const channel = await createChannel({ name: 'Ideas no data' });
    const getActiveJob = vi.fn(async () => ({ id: 'active-ideas' } as JobSummary));
    const base = await startApi({ getActiveJob, getClaudeCliStatus: async () => ({ available: true, version: '2.1.306', authPathLikely: 'subscription' }) });
    const list = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas`);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ ideas: [], currentTier: 'no-performance-data', matureVideoCount: 0, latestRun: null, stale: false });
    const generate = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(generate.status).toBe(409);
    expect(await generate.json()).toMatchObject({ error: { code: 'YOUTUBE_IDEAS_ALREADY_RUNNING', jobId: 'active-ideas' } });
  });

  it('checks CLI availability and model validity before enqueueing', async () => {
    const channel = await createChannel({ name: 'Ideas unavailable' });
    const enqueueJob = vi.fn(async () => ({ id: 'queued' } as JobSummary));
    const unavailable = await startApi({ enqueueJob, getClaudeCliStatus: async () => ({ available: false, reason: 'missing', authPathLikely: 'subscription' }) });
    const unavailableResponse = await fetch(`${unavailable}/api/youtube/channels/${channel.id}/ideas/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'cli' }) });
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.json()).toMatchObject({ error: { code: 'CLAUDE_CLI_UNAVAILABLE' } });
    expect(enqueueJob).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => server!.close(() => resolve())); server = null;

    const available = await startApi({ enqueueJob, getClaudeCliStatus: async () => ({ available: true, version: '2.1.306', authPathLikely: 'subscription' }) });
    const invalidModel = await fetch(`${available}/api/youtube/channels/${channel.id}/ideas/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'cli', cliModel: 'not-a-claude-model' }) });
    expect(invalidModel.status).toBe(422);
    expect(await invalidModel.json()).toMatchObject({ error: { code: 'AI_MODEL_UNAVAILABLE' } });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('enqueues CLI generation with defaults and returns no credentials', async () => {
    const channel = await createChannel({ name: 'Ideas enqueue' });
    const enqueueJob = vi.fn(async () => ({ id: 'queued-idea-job' } as JobSummary));
    const base = await startApi({ enqueueJob, getClaudeCliStatus: async () => ({ available: true, version: '2.1.306', authPathLikely: 'subscription' }) });
    const response = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ steering: 'lịch sử Việt Nam' }) });
    expect(response.status).toBe(202);
    const result = await response.json();
    expect(result).toEqual({ jobId: 'queued-idea-job' });
    expect(JSON.stringify(result)).not.toMatch(/token|credential|secret/i);
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: 'video-ideas', projectId: `youtube-ideas:${channel.id}`, maxAttempts: 1,
      payload: { channelId: channel.id, backend: 'cli', steering: 'lịch sử Việt Nam', presetId: 'hubris-trap', count: 6, targetDurationSec: 600 },
    }));
  });

  it('maps a concurrent active-job uniqueness race to the existing job response', async () => {
    const channel = await createChannel({ name: 'Ideas concurrent generation' });
    const base = await startApi({ enqueueJob, getActiveJob: getActiveJobByType, getClaudeCliStatus: async () => ({ available: true, version: '2.1.306', authPathLikely: 'subscription' }) });
    const create = () => fetch(`${base}/api/youtube/channels/${channel.id}/ideas/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    const responses = await Promise.all([create(), create()]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    const conflict = await responses.find((response) => response.status === 409)!.json();
    expect(conflict).toMatchObject({ error: { code: 'YOUTUBE_IDEAS_ALREADY_RUNNING', jobId: expect.any(String) } });
    expect(await getCollection<TestDoc>('jobs').countDocuments({ type: 'video-ideas', projectId: `youtube-ideas:${channel.id}`, status: { $in: ['queued', 'running'] } })).toBe(1);
  });

  it('defaults the duration to the channel’s most recently updated project', async () => {
    const channel = await createChannel({ name: 'Ideas duration default' });
    await createProject({
      title: 'Recent channel project', language: 'vi', brief: 'A long enough project brief for setup.', referencesText: '',
      scriptPresetId: 'documentary', visualStylePresetId: 'cinematic', targetDurationSec: 240, chapterCount: 4, voiceId: null,
      channelId: channel.id, renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
    });
    const enqueueJob = vi.fn(async () => ({ id: 'duration-job' } as JobSummary));
    const base = await startApi({ enqueueJob });
    const response = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'api' }) });
    expect(response.status).toBe(202);
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ targetDurationSec: 240 }) }));
  });

  it('stores user statuses and manual checks, returns an empty-reference project prefill and marks used after a matching project exists', async () => {
    const channel = await createChannel({ name: 'Ideas handoff' });
    await saveIdea(channel.id);
    const base = await startApi();
    const patch = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas/idea-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'chosen', manualDemand: { note: 'Hai kênh nhỏ có video trên 10k view.' } }),
    });
    expect(patch.status).toBe(200);
    const patchBody = await patch.json();
    expect(patchBody).toMatchObject({ status: 'chosen', manualDemand: { note: 'Hai kênh nhỏ có video trên 10k view.', checkedAt: expect.any(String) } });
    expect(JSON.stringify(patchBody)).not.toMatch(/refreshToken|accessToken|credential/i);

    const handoff = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas/idea-1/create-project`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(handoff.status).toBe(200);
    const { prefill } = await handoff.json() as { prefill: Record<string, unknown> };
    expect(prefill).toMatchObject({ title: content.title, language: 'vi', brief: content.brief, scriptPresetId: 'hubris-trap', targetDurationSec: 600, chapterCount: 5, channelId: channel.id, referencesText: '', researchNote: 'Chưa có nguồn: cần research có dẫn nguồn trước khi viết kịch bản' });

    const project = await createProject({
      title: content.title, language: 'vi', brief: content.brief, referencesText: '', scriptPresetId: 'hubris-trap', visualStylePresetId: 'cinematic',
      targetDurationSec: 600, chapterCount: 5, voiceId: null, channelId: channel.id,
      renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
    });
    const markUsed = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas/idea-1/create-project`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id }) });
    expect(markUsed.status).toBe(200);
    expect(await markUsed.json()).toMatchObject({ ideaId: 'idea-1' });
    const listed = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas`);
    expect((await listed.json() as { ideas: { status: string; usedProjectId?: string }[] }).ideas[0]).toMatchObject({ status: 'used', usedProjectId: project.id });

    const locked = await fetch(`${base}/api/youtube/channels/${channel.id}/ideas/idea-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'chosen' }),
    });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ error: { code: 'YOUTUBE_IDEA_STATUS_LOCKED' } });
  });
});
