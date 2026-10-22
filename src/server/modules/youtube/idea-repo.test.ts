import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { ensureYoutubeIndexes } from './indexes';
import { deleteYoutubeIdeaDoc, findLatestYoutubeIdeaRun, findYoutubeIdeaDoc, listYoutubeIdeaDocs, patchYoutubeIdeaDoc, saveYoutubeIdeaRun } from './idea-repo';

type TestDoc = Document & { _id: string; [key: string]: unknown };

const baseIdea = {
  hook: 'Mở đầu tại khoảnh khắc kế hoạch đổ vỡ.',
  brief: 'Một nhân vật dựng kế hoạch rất kỹ, bỏ qua một điểm mù và phải đối mặt với hậu quả do chính mình tạo ra.',
  presetId: 'hubris-trap' as const,
  motif: {
    hunter: { text: 'Người chủ động đặt bẫy.', evidence: 'strong' as const },
    perfectPlan: { text: 'Kế hoạch được chuẩn bị.', evidence: 'partial' as const },
    blindSpot: { text: 'Một giả định không được xét lại.', evidence: 'partial' as const },
    selfDestruction: { text: 'Kế hoạch gây hại cho người tạo.', evidence: 'strong' as const },
  },
  whyForThisChannel: 'Hồ sơ kênh và chủ đề đã làm.', testVariable: 'topic' as const,
  successCriterion: { description: 'So sánh sau ba video.', afterVideos: 3 },
  unverifiedFacts: ['Cần kiểm chứng tên sự kiện.'], risks: [], rarityGuess: 'unknown' as const,
  evidenceTier: 'no-performance-data' as const,
  scores: { fit: 4, clarity: 4, riskOfThinSources: 2 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
};

function row(channelId: string, id: string, status: 'new' | 'chosen' | 'rejected' | 'used', generatedAt: string, runId = `run-${id}`) {
  return {
    _id: id, channelProfileId: channelId, runId, evidenceTier: 'no-performance-data' as const,
    backend: 'cli' as const, model: 'claude-opus-4-5', promptVersion: 'video-ideas-v1' as const,
    generatedAt, idea: { ...baseIdea, id: `candidate-${id}`, title: `Ý tưởng ${id}` }, status,
    ...(status === 'used' ? { usedProjectId: `project-${id}` } : {}),
  };
}

function run(channelId: string, id: string, generatedAt: string) {
  return {
    _id: id, channelProfileId: channelId, evidenceTier: 'no-performance-data' as const,
    backend: 'cli' as const, model: 'claude-opus-4-5', promptVersion: 'video-ideas-v1' as const,
    generatedAt, requestedCount: 6,
    packetSummary: { projectCount: 1, syncedVideoCount: 2, savedIdeaCount: 0, matureVideoCount: 2 },
    coverageFingerprint: 'a'.repeat(64), dropped: [], durations: { generateMs: 100, critiqueMs: 200, totalMs: 300 },
  };
}

beforeAll(async () => { await startTestMongo(); await ensureYoutubeIndexes(); });
beforeEach(async () => {
  await getCollection<TestDoc>('youtubeVideoIdeas').deleteMany({});
  await getCollection<TestDoc>('youtubeIdeaRuns').deleteMany({});
});
afterAll(async () => closeTestMongo());

describe('YouTube idea repository', () => {
  it('persists ideas and a metadata-only run, and updates status/manual demand under the channel scope', async () => {
    await saveYoutubeIdeaRun({ run: run('channel-a', 'run-1', '2026-10-22T10:00:00.000Z'), ideas: [row('channel-a', 'idea-1', 'new', '2026-10-22T10:00:00.000Z', 'run-1')] });
    const saved = await patchYoutubeIdeaDoc('channel-a', 'idea-1', {
      status: 'chosen', manualDemand: { note: 'Hai kênh nhỏ có video trên 10k view.', checkedAt: '2026-10-22T11:00:00.000Z' },
    });
    expect(saved).toMatchObject({ status: 'chosen', manualDemand: { note: 'Hai kênh nhỏ có video trên 10k view.', checkedAt: '2026-10-22T11:00:00.000Z' } });
    expect(await findLatestYoutubeIdeaRun('channel-a')).toMatchObject({ _id: 'run-1', requestedCount: 6 });
    expect(await listYoutubeIdeaDocs('channel-a')).toHaveLength(1);
    expect(await findYoutubeIdeaDoc('channel-b', 'idea-1')).toBeNull();
    expect(JSON.stringify(await getCollection<TestDoc>('youtubeIdeaRuns').findOne({ _id: 'run-1' }))).not.toMatch(/brief|narration|token|refresh/i);
  });

  it('prunes oldest rejected rows before new rows and never deletes chosen or used ideas', async () => {
    const firstRows = Array.from({ length: 198 }, (_, index) => row('channel-cap', `old-${String(index).padStart(3, '0')}`, index === 0 ? 'chosen' : index === 1 ? 'used' : 'rejected', new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), 'run-old'));
    await saveYoutubeIdeaRun({ run: run('channel-cap', 'run-old', '2026-01-01T00:00:00.000Z'), ideas: firstRows });
    const newRows = Array.from({ length: 4 }, (_, index) => row('channel-cap', `new-${index}`, 'new', '2026-10-22T10:00:00.000Z', 'run-new'));
    await saveYoutubeIdeaRun({ run: run('channel-cap', 'run-new', '2026-10-22T10:00:00.000Z'), ideas: newRows });
    const rows = await listYoutubeIdeaDocs('channel-cap');
    expect(rows).toHaveLength(200);
    expect(rows.find((item) => item._id === 'old-000')?.status).toBe('chosen');
    expect(rows.find((item) => item._id === 'old-001')?.status).toBe('used');
    expect(rows.some((item) => item._id === 'old-002' || item._id === 'old-003')).toBe(false);
  });

  it('deletes only the requested channel-owned idea', async () => {
    await saveYoutubeIdeaRun({ run: run('channel-a', 'run-1', '2026-10-22T10:00:00.000Z'), ideas: [row('channel-a', 'idea-1', 'new', '2026-10-22T10:00:00.000Z', 'run-1')] });
    expect(await deleteYoutubeIdeaDoc('channel-b', 'idea-1')).toBe(false);
    expect(await deleteYoutubeIdeaDoc('channel-a', 'idea-1')).toBe(true);
  });
});
