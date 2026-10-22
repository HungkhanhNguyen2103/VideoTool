import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createChannel } from '../channel';
import { loadConfig } from '../../config';
import { findYoutubeReviewV2, upsertReview } from './repo';
import { ensureYoutubeIndexes } from './indexes';
import { generateYoutubeReviewV2, getYoutubeReviewV2, type YoutubeReviewV2JobContext } from './review-v2-service';

type TestDoc = Document & { _id: string; [key: string]: unknown };
const config = loadConfig({ DEFAULT_AI_PROVIDER: 'deepseek' });

beforeAll(async () => { await startTestMongo(); await ensureYoutubeIndexes(); });
beforeEach(async () => {
  for (const collection of ['youtubeVideos', 'youtubeChannelDaily', 'youtubeChannelTraffic', 'youtubeGrowthPlans', 'youtubeRetention', 'youtubeReviews', 'youtubeCredentials', 'channels']) {
    await getCollection<TestDoc>(collection).deleteMany({});
  }
});
afterAll(async () => closeTestMongo());

async function addVideo(profileId: string): Promise<void> {
  const now = new Date().toISOString();
  await getCollection<TestDoc>('youtubeVideos').insertOne({
    _id: `${profileId}:video-1`, channelProfileId: profileId, videoId: 'video-1', title: 'Existing Documentary',
    publishedAt: now, durationSec: 600, isShort: false, privacy: 'public', viewCount: 20, likeCount: 1, commentCount: 0,
    fetchedAt: now, analytics: {}, removed: false,
  });
}

function jobContext(): YoutubeReviewV2JobContext {
  return {
    reportProgress: async () => undefined,
    isCancelled: async () => false,
    appendLog: async () => undefined,
  };
}

const validAnalysis = JSON.stringify({
  summary: 'Mẫu hiện còn nhỏ nên chưa đủ căn cứ kết luận.', strengths: [], weaknesses: [],
  diagnosis: { classification: 'unclear', reasoning: 'Chưa đủ dữ liệu để phân biệt ngách và cách thực hiện.', metricIds: [] },
  actionPlan: [], limits: [],
});
const validVideoAnalysis = JSON.stringify({
  summary: 'Dữ liệu về search terms của video chưa khả dụng.', strengths: [], weaknesses: [], retentionFindings: [], searchFindings: [],
  nextChange: { variable: 'hook', why: 'Giữ nguyên cấu trúc để thu thập thêm dữ liệu.', metricIds: ['v:video-1:duration_sec'], successCriterion: { metricId: 'v:video-1:duration_sec', comparator: '<=', value: 600, afterVideos: 1 } },
  limits: [],
});

describe('YouTube review v2 persistence', () => {
  it('stores versioned review metadata only and preserves the legacy review', async () => {
    const profile = await createChannel({ name: 'Review versioning' });
    await addVideo(profile.id);
    const generatedAt = new Date();
    await upsertReview({
      _id: `${profile.id}:channel:channel:youtube-review-v1`, channelProfileId: profile.id, target: 'channel', targetId: 'channel',
      promptVersion: 'youtube-review-v1', dataWindow: '28d', result: { observations: ['Legacy'], hypotheses: [], experiments: [] }, generatedAt,
    });
    const context = jobContext();
    const result = await generateYoutubeReviewV2({
      profileId: profile.id, target: 'channel', request: { backend: 'api' }, context, config,
      clientFactory: () => ({ chat: async () => validAnalysis }),
    });
    expect(result).toMatchObject({ target: 'channel', promptVersion: 'youtube-review-v2-channel', backend: 'api', stale: false });
    const rows = await getCollection<TestDoc>('youtubeReviews').find({ channelProfileId: profile.id }).toArray();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/accessToken|refreshToken|refresh_token|narration|packetJson|client_secret/i);
    expect(JSON.stringify(result)).not.toMatch(/accessToken|refreshToken|refresh_token|narration|packetJson|client_secret/i);
    expect(await getCollection<TestDoc>('youtubeReviews').findOne({ promptVersion: 'youtube-review-v1' })).toMatchObject({ result: { observations: ['Legacy'] } });
    expect(await findYoutubeReviewV2(profile.id, 'channel', 'channel')).toMatchObject({ backend: 'api', promptVersion: 'youtube-review-v2-channel' });
    expect(await getYoutubeReviewV2({ profileId: profile.id, target: 'channel', config })).toMatchObject({ stale: false });
    await getCollection<TestDoc>('youtubeVideos').updateOne({ channelProfileId: profile.id, videoId: 'video-1' }, { $set: { viewCount: 21 } });
    expect(await getYoutubeReviewV2({ profileId: profile.id, target: 'channel', config })).toMatchObject({ stale: true });
  });

  it('leaves an existing versioned review untouched when cancellation arrives before persistence', async () => {
    const profile = await createChannel({ name: 'Review cancellation' });
    await addVideo(profile.id);
    const prior = {
      _id: `${profile.id}:channel:channel:youtube-review-v2-channel`, channelProfileId: profile.id, target: 'channel' as const, targetId: 'channel',
      promptVersion: 'youtube-review-v2-channel' as const, backend: 'api' as const, model: 'previous-model', dataFingerprint: 'b'.repeat(64),
      packetSummary: { matureCount: 0, includedVideoCount: 0, truncatedVideoCount: 0 }, groundingReport: { checked: 0, repaired: 0, dropped: [] }, metricMap: {},
      analysis: { summary: 'Previous result.', strengths: [], weaknesses: [], diagnosis: { classification: 'unclear' as const, reasoning: 'Previously checked.', metricIds: [] }, actionPlan: [], limits: [] }, generatedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    await upsertReview(prior);
    let cancelled = false;
    const context: YoutubeReviewV2JobContext = { reportProgress: async () => undefined, isCancelled: async () => cancelled, appendLog: async () => undefined };
    const result = await generateYoutubeReviewV2({
      profileId: profile.id, target: 'channel', request: { backend: 'api' }, context, config,
      clientFactory: () => ({ chat: async () => { cancelled = true; return validAnalysis; } }),
    });
    expect(result).toBeUndefined();
    expect(await findYoutubeReviewV2(profile.id, 'channel', 'channel')).toMatchObject({ model: 'previous-model', analysis: { summary: 'Previous result.' }, generatedAt: prior.generatedAt });
  });

  it('continues video review when search terms are missing and the channel has no Analytics credential', async () => {
    const profile = await createChannel({ name: 'Review without search terms' });
    await addVideo(profile.id);
    await getCollection<TestDoc>('youtubeRetention').insertOne({
      _id: `${profile.id}:video-1`, channelProfileId: profile.id, videoId: 'video-1', fetchedAt: new Date(), curve: [],
    });
    const logs: string[] = [];
    const context: YoutubeReviewV2JobContext = { ...jobContext(), appendLog: async (line) => { logs.push(line); } };
    const result = await generateYoutubeReviewV2({
      profileId: profile.id, target: 'video', videoId: 'video-1', request: { backend: 'api' }, context, config,
      fetcher: async () => { throw new Error('unexpected Analytics request'); },
      clientFactory: () => ({ chat: async () => validVideoAnalysis }),
    });

    expect(result?.target).toBe('video');
    expect(result?.videoContext?.searchTerms).toMatchObject([{ window: 'last28d', status: 'unavailable' }, { window: 'lifetime', status: 'unavailable' }]);
    expect(logs.join('\n')).toMatch(/chưa kết nối Analytics/i);
  });
});
