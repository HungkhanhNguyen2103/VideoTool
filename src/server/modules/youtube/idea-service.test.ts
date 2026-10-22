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

const archetypes = ['military', 'political', 'economic', 'technological', 'diplomatic', 'institutional'] as const;

function seeds() {
  return archetypes.map((hunterArchetype, index) => ({
    id: `idea-${index + 1}`, episode: `Chỉ huy đổi tuyến tiếp tế trong lĩnh vực ${hunterArchetype}.`,
    yearOrPeriod: `thế kỷ ${['XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII'][index]}`, place: `đồng bằng ${hunterArchetype}`,
    hunterArchetype, domain: 'logistics', famousnessGuess: 'obscure',
  }));
}

function expanded(seed: ReturnType<typeof seeds>[number], score: number) {
  return {
    id: seed.id, episode: seed.episode, period: seed.yearOrPeriod, place: seed.place, hunterArchetype: seed.hunterArchetype,
    famousnessGuess: seed.famousnessGuess, famousnessFallback: false, angle: `góc ${seed.hunterArchetype}`,
    title: `Kế hoạch tự khép lại trong lĩnh vực ${seed.hunterArchetype}`, hook: 'Người chỉ huy tin đường tiếp tế vẫn an toàn.',
    brief: 'Người chỉ huy tin rằng đường tiếp tế đã an toàn. Kế hoạch kéo dài cuộc vây hãm. Một lối vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô lực lượng khiến kế hoạch khó xoay chuyển.',
    presetId: 'hubris-trap',
    motif: {
      hunter: { text: 'Người chỉ huy tin đường tiếp tế an toàn.', evidence: 'strong' },
      perfectPlan: { text: 'Kế hoạch kéo dài cuộc vây hãm dựa vào quân số đông.', evidence: 'partial' },
      blindSpot: { text: 'Tuyến tiếp tế kéo dài nằm ngoài dự tính.', evidence: 'partial' },
      selfDestruction: { text: 'Chính quy mô quân số kéo dài tuyến tiếp tế và khiến lực lượng mắc kẹt.', evidence: 'strong' },
    },
    trap: {
      hunterBelief: 'Người chỉ huy tin đường tiếp tế an toàn.',
      outsideVariable: 'Tuyến tiếp tế kéo dài nằm ngoài khung nhìn.',
      exploitedBy: 'Bên phòng thủ dùng lối vòng để cắt tuyến tiếp tế.',
      advantageThatBackfired: 'Chính quy mô quân số kéo dài tuyến tiếp tế và làm lực lượng mắc kẹt.',
    },
    trapSketch: 'Người chỉ huy tin đường tiếp tế an toàn, nên kéo dài cuộc vây hãm; nhưng tuyến tiếp tế nằm ngoài khung nhìn; kết quả lực lượng mắc kẹt vì chính quy mô của mình.',
    whyForThisChannel: 'Hồ sơ kênh chưa có câu chuyện xoay quanh một điểm mù.', testVariable: 'topic',
    successCriterion: { description: 'So sánh mức giữ chân đầu video sau khi đăng.', afterVideos: 3 },
    claims: [{ text: `Tuyến tiếp tế kéo dài khiến đội hình mắc kẹt trong ${seed.yearOrPeriod}; quy mô lực lượng khiến kế hoạch khó xoay chuyển.`, confidence: 'medium' }],
    risks: ['Cần kiểm chứng địa điểm và bối cảnh.'], rarityGuess: 'unknown', evidenceTier: 'no-performance-data',
    scores: { fit: score, clarity: score, riskOfThinSources: 1 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
  };
}

function outputs() {
  const rows = seeds();
  return [
    JSON.stringify({ seeds: rows }),
    JSON.stringify({ selected: rows.map(({ id }) => ({ id, trapSketch: 'Một giả định trở thành điểm gãy do chính lợi thế của người ra quyết định.' })), rejected: [] }),
    JSON.stringify({ ideas: rows.slice(0, 4).map((row, index) => expanded(row, 5 - index)) }),
    JSON.stringify({ ideas: rows.slice(4).map((row, index) => expanded(row, 3 - index)) }),
  ];
}

describe('YouTube video idea generation service', () => {
  it('runs all v2 API stages, persists per-stage metadata and ideas without storing raw packet or credentials', async () => {
    const channel = await createChannel({ name: 'Task 120 no-data demo' });
    const responses = outputs();
    const calls: string[] = [];
    const result = await generateYoutubeVideoIdeas({
      profileId: channel.id, request: { backend: 'api', steering: 'lịch sử Việt Nam', presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
      context: context(), config,
      clientFactory: () => ({ chat: async (messages) => { calls.push(messages[1]!.content); return responses.shift()!; } }),
    });
    expect(calls).toHaveLength(4);
    expect(calls[0]).toContain('video-ideas-v2-seeds');
    expect(calls[1]).toContain('video-ideas-v2-select');
    expect(calls[2]).toContain('video-ideas-v2-expand');
    expect(calls[3]).toContain('video-ideas-v2-expand');
    expect(result).toMatchObject({ dropped: 2, evidenceTier: 'no-performance-data', repairCalls: { seeds: 0, select: 0, expand: 0 } });
    expect((await listYoutubeIdeaDocs(channel.id)).map((row) => row.idea.title)).toHaveLength(4);
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

  it('uses the idea Sonnet default and filesystem-safe CLI audit scope for channel jobs', async () => {
    const channel = await createChannel({ name: 'Task 120 CLI audit scope' });
    const responses = outputs();
    const projectIds: string[] = [];
    const models: string[] = [];
    await generateYoutubeVideoIdeas({
      profileId: channel.id, request: { backend: 'cli', steering: '', presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
      context: context(), config,
      getClaudeCliStatus: async () => ({ available: true, version: '2.1.306', authPathLikely: 'subscription' }),
      cliChatFactory: async (options) => {
        projectIds.push(options.projectId);
        models.push(options.model ?? '');
        return { label: 'test-cli', model: options.model ?? 'claude-sonnet-5-5', chat: async () => responses.shift()! };
      },
    });
    expect(projectIds).toEqual([`youtube-ideas-${channel.id}`]);
    expect(projectIds[0]).toMatch(/^[a-zA-Z0-9_-]+$/u);
    expect(models).toEqual(['claude-sonnet-5-5']);
  });
});
