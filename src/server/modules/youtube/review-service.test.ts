import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { generateYoutubeReview } from './review-service';
import { findReview, findYoutubeReviewV2, upsertReview } from './repo';

type TestDoc = Document & { _id: string; [key: string]: unknown };

beforeAll(async () => startTestMongo());
beforeEach(async () => {
  await getCollection<TestDoc>('youtubeVideos').deleteMany({});
  await getCollection<TestDoc>('youtubeChannelDaily').deleteMany({});
  await getCollection<TestDoc>('youtubeReviews').deleteMany({});
});
afterAll(async () => closeTestMongo());

describe('stored YouTube AI review', () => {
  it('refuses an empty channel before calling the provider', async () => {
    let calls = 0;
    await expect(generateYoutubeReview({
      profileId: 'empty-profile', target: 'channel',
      clientFactory: () => ({ chat: async () => { calls += 1; return ''; } }),
    })).rejects.toMatchObject({ code: 'YOUTUBE_REVIEW_NO_DATA' });
    expect(calls).toBe(0);
  });

  it('stores only the validated aggregate review and prompt version', async () => {
    await getCollection<TestDoc>('youtubeVideos').insertOne({
      _id: 'profile-1:video-1', channelProfileId: 'profile-1', videoId: 'video-1', title: 'My own upload',
      publishedAt: '2026-10-01T00:00:00.000Z', durationSec: 600, isShort: false, privacy: 'public', viewCount: 25,
      likeCount: 1, commentCount: 0, fetchedAt: new Date().toISOString(), analytics: {}, removed: false,
    });
    const sent: string[] = [];
    const result = await generateYoutubeReview({
      profileId: 'profile-1', target: 'channel',
      clientFactory: () => ({ chat: async (messages) => {
        sent.push(messages.map((message) => message.content).join('\n'));
        return '{"observations":["25 views in the supplied window"],"hypotheses":[],"experiments":[]}';
      } }),
    });
    expect(result).toMatchObject({ target: 'channel', targetId: 'channel', promptVersion: 'youtube-review-v1' });
    expect(sent.join('\n')).toContain('videoCount');
    expect(sent.join('\n')).not.toContain('My own upload');
    expect(sent.join('\n')).not.toMatch(/access_token|refresh_token|rawPayload|client_secret/i);
    const saved = await getCollection<TestDoc>('youtubeReviews').findOne({ channelProfileId: 'profile-1', target: 'channel' });
    expect(saved).toMatchObject({ promptVersion: 'youtube-review-v1', dataWindow: '28d vs previous 28d' });
    expect(JSON.stringify(saved)).not.toMatch(/refresh_token|client_secret/i);
  });

  it('keeps legacy and v2 reviews side by side and reads each with its own schema', async () => {
    const generatedAt = new Date('2026-10-22T12:00:00.000Z');
    await upsertReview({
      _id: 'profile-versioned:channel:channel:youtube-review-v1', channelProfileId: 'profile-versioned', target: 'channel', targetId: 'channel',
      promptVersion: 'youtube-review-v1', dataWindow: '28d vs previous 28d',
      result: { observations: ['Legacy finding'], hypotheses: [], experiments: [] }, generatedAt,
    });
    await upsertReview({
      _id: 'profile-versioned:channel:channel:youtube-review-v2-channel', channelProfileId: 'profile-versioned', target: 'channel', targetId: 'channel',
      promptVersion: 'youtube-review-v2-channel', backend: 'cli', model: 'claude-opus-4-5', dataFingerprint: 'a'.repeat(64),
      packetSummary: { matureCount: 2, includedVideoCount: 2, truncatedVideoCount: 0 }, groundingReport: { checked: 3, repaired: 0, dropped: [] },
      metricMap: {}, analysis: { summary: 'Small sample.', strengths: [], weaknesses: [], diagnosis: { classification: 'unclear', reasoning: 'Too little evidence.', metricIds: [] }, actionPlan: [], limits: [] },
      ideas: { status: 'gated', reason: 'Cần ít nhất 10 video đã đủ 28 ngày; hiện có 2.', items: [] }, generatedAt,
    });

    expect(await findReview('profile-versioned', 'channel', 'channel')).toMatchObject({ promptVersion: 'youtube-review-v1', result: { observations: ['Legacy finding'] } });
    expect(await findYoutubeReviewV2('profile-versioned', 'channel', 'channel')).toMatchObject({ promptVersion: 'youtube-review-v2-channel', backend: 'cli' });
  });
});
