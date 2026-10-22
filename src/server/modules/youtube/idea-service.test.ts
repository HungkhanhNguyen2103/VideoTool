import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { loadConfig } from '../../config';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createChannel } from '../channel';
import { listYoutubeIdeaDocs } from './idea-repo';
import { ensureYoutubeIndexes } from './indexes';
import { generateYoutubeVideoIdeas, getYoutubeIdeas } from './idea-service';
import type { YoutubeIdeaJobContext } from './idea-engine';

type TestDoc = Document & { _id: string; [key: string]: unknown };
const config = loadConfig({ DEFAULT_AI_PROVIDER: 'deepseek' });

beforeAll(async () => { await startTestMongo(); await ensureYoutubeIndexes(); });
beforeEach(async () => {
  for (const collection of ['youtubeVideos', 'youtubeChannelDaily', 'youtubeChannelTraffic', 'youtubeGrowthPlans', 'youtubeRetention', 'youtubeCredentials', 'youtubeVideoIdeas', 'youtubeIdeaRuns', 'channels', 'projects']) {
    await getCollection<TestDoc>(collection).deleteMany({});
  }
});
afterAll(async () => closeTestMongo());

function context(overrides: Partial<YoutubeIdeaJobContext> = {}): YoutubeIdeaJobContext {
  return { reportProgress: async () => undefined, isCancelled: async () => false, appendLog: async () => undefined, ...overrides };
}

function draft(id: string, title: string) {
  return {
    id, title, hook: 'Cánh cửa vừa khép khi người đi săn bước qua.',
    brief: 'Một nhân vật chuẩn bị một kế hoạch tỉ mỉ. Một giả định quan trọng không được kiểm tra. Dấu hiệu đầu tiên xuất hiện khi kế hoạch bắt đầu. Nhân vật quyết định tiếp tục. Hành động ấy khiến cái bẫy khép lại. Câu chuyện kết thúc bằng hệ quả do chính kế hoạch tạo ra.',
    presetId: 'hubris-trap',
    motif: {
      hunter: { text: 'Nhân vật chủ động dựng bẫy.', evidence: 'strong' },
      perfectPlan: { text: 'Một kế hoạch được chuẩn bị.', evidence: 'partial' },
      blindSpot: { text: 'Một giả định bị bỏ qua.', evidence: 'partial' },
      selfDestruction: { text: 'Kế hoạch quay lại gây hại.', evidence: 'strong' },
    },
    whyForThisChannel: 'Hồ sơ kênh chưa có câu chuyện xoay quanh một điểm mù.', testVariable: 'topic',
    successCriterion: { description: 'So sánh mức giữ chân đầu video sau khi đăng.', afterVideos: 3 },
    unverifiedFacts: ['Tên và thời điểm của sự kiện cần kiểm chứng.'], risks: [], rarityGuess: 'unknown',
    evidenceTier: 'no-performance-data', suggestedDurationSec: 600, suggestedChapterCount: 5,
  };
}

function outputs() {
  return [
    JSON.stringify({ ideas: [draft('idea-1', 'Kế hoạch tự khép thành chiếc bẫy'), draft('idea-2', 'Điểm mù khiến kế hoạch phản tác dụng')] }),
    JSON.stringify({ ideas: [
      { id: 'idea-1', decision: 'keep', scores: { fit: 4, clarity: 4, riskOfThinSources: 2 } },
      { id: 'idea-2', decision: 'keep', scores: { fit: 5, clarity: 4, riskOfThinSources: 1 } },
    ] }),
  ];
}

describe('YouTube video idea generation service', () => {
  it('runs both API calls, persists metadata and ideas without storing raw packet or credentials', async () => {
    const channel = await createChannel({ name: 'Task 120 no-data demo' });
    const responses = outputs();
    const calls: string[] = [];
    const result = await generateYoutubeVideoIdeas({
      profileId: channel.id, request: { backend: 'api', steering: 'lịch sử Việt Nam', presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
      context: context(), config,
      clientFactory: () => ({ chat: async (messages) => { calls.push(messages[1]!.content); return responses.shift()!; } }),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('video-ideas-v1-generate');
    expect(calls[1]).toContain('video-ideas-v1-critique');
    expect(result).toMatchObject({ dropped: 0, evidenceTier: 'no-performance-data' });
    expect((await listYoutubeIdeaDocs(channel.id)).map((row) => row.idea.title).sort()).toEqual(['Điểm mù khiến kế hoạch phản tác dụng', 'Kế hoạch tự khép thành chiếc bẫy'].sort());
    const publicResult = await getYoutubeIdeas(channel.id);
    expect(publicResult).toMatchObject({ currentTier: 'no-performance-data', matureVideoCount: 0, stale: false });
    expect(publicResult.ideas).toEqual(expect.arrayContaining([expect.objectContaining({ backend: 'api' })]));
    const stored = await getCollection<TestDoc>('youtubeIdeaRuns').findOne({ channelProfileId: channel.id });
    expect(JSON.stringify({ publicResult, stored })).not.toMatch(/refreshToken|accessToken|client_secret|packetJson|steering|narration|promptText/i);
  });

  it('leaves idea and run collections untouched when cancellation arrives after generation', async () => {
    const channel = await createChannel({ name: 'Task 120 cancelled demo' });
    let cancelled = false;
    const responses = outputs();
    const result = await generateYoutubeVideoIdeas({
      profileId: channel.id, request: { backend: 'api', steering: '', presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
      context: context({ isCancelled: async () => cancelled }), config,
      clientFactory: () => ({ chat: async () => { const response = responses.shift()!; cancelled = true; return response; } }),
    });
    expect(result).toBeUndefined();
    expect(await getCollection<TestDoc>('youtubeVideoIdeas').countDocuments({ channelProfileId: channel.id })).toBe(0);
    expect(await getCollection<TestDoc>('youtubeIdeaRuns').countDocuments({ channelProfileId: channel.id })).toBe(0);
  });

  it('uses a filesystem-safe CLI audit scope for colon-scoped channel jobs', async () => {
    const channel = await createChannel({ name: 'Task 120 CLI audit scope' });
    const responses = outputs();
    const projectIds: string[] = [];
    await generateYoutubeVideoIdeas({
      profileId: channel.id, request: { backend: 'cli', steering: '', presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
      context: context(), config,
      getClaudeCliStatus: async () => ({ available: true, version: '2.1.306', authPathLikely: 'subscription' }),
      cliChatFactory: async (options) => {
        projectIds.push(options.projectId);
        return { label: 'test-cli', model: options.model ?? 'claude-sonnet-4-5', chat: async () => responses.shift()! };
      },
    });
    expect(projectIds).toEqual([`youtube-ideas-${channel.id}`]);
    expect(projectIds[0]).toMatch(/^[a-zA-Z0-9_-]+$/u);
  });
});
