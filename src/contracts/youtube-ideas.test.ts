import { describe, expect, it } from 'vitest';
import {
  YoutubeIdeaSchema,
  YoutubeIdeaStatusPatchSchema,
  canTransitionYoutubeIdeaStatus,
  YoutubeIdeasGenerateRequestSchema,
  YoutubeIdeaRecordSchema,
} from './youtube-ideas';

const validIdea = {
  id: 'idea-1', title: 'Vì sao kế hoạch hoàn hảo thất bại?', hook: 'Mở đầu bằng khoảnh khắc chiếc bẫy khép lại.',
  brief: 'Người thợ săn chuẩn bị một kế hoạch tưởng như hoàn hảo. Một giả định quan trọng không được kiểm tra. Dấu hiệu cảnh báo xuất hiện trước khi hành động bắt đầu. Nhân vật vẫn tiếp tục theo kế hoạch. Sai lầm khiến chính chiếc bẫy khép lại. Câu chuyện kết thúc bằng hệ quả cần được kiểm chứng.',
  presetId: 'hubris-trap',
  motif: {
    hunter: { text: 'Người chủ động đặt bẫy.', evidence: 'strong' },
    perfectPlan: { text: 'Kế hoạch được chuẩn bị kỹ.', evidence: 'partial' },
    blindSpot: { text: 'Một giả định không được kiểm tra.', evidence: 'partial' },
    selfDestruction: { text: 'Kế hoạch gây hậu quả cho chính người tạo.', evidence: 'strong' },
  },
  whyForThisChannel: 'Hồ sơ kênh dùng tiếng Việt và các video cũ chưa có chủ đề này.',
  testVariable: 'topic', successCriterion: { description: 'So sánh lượt xem 28 ngày đầu sau 3 video.', afterVideos: 3 },
  unverifiedFacts: ['Cần kiểm chứng niên đại của sự kiện.'], risks: ['Nguồn về động cơ có thể mỏng.'],
  rarityGuess: 'unknown', evidenceTier: 'no-performance-data',
  scores: { fit: 4, clarity: 4, riskOfThinSources: 2 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
};

describe('YouTube video idea contracts', () => {
  it('accepts a strict complete hubris-trap idea and rejects undeclared fields', () => {
    expect(YoutubeIdeaSchema.parse(validIdea)).toMatchObject({ presetId: 'hubris-trap', evidenceTier: 'no-performance-data' });
    expect(() => YoutubeIdeaSchema.parse({ ...validIdea, guessedViews: 10000 })).toThrow();
  });

  it('requires a project-ready brief of five to eight sentences', () => {
    expect(() => YoutubeIdeaSchema.parse({ ...validIdea, brief: 'Chỉ một câu.' })).toThrow();
    expect(() => YoutubeIdeaSchema.parse({ ...validIdea, brief: 'Một. Hai. Ba. Bốn. Năm. Sáu. Bảy. Tám. Chín.' })).toThrow();
  });

  it('applies generation defaults and rejects steering or count outside the product bounds', () => {
    expect(YoutubeIdeasGenerateRequestSchema.parse({})).toMatchObject({ backend: 'cli', presetId: 'hubris-trap', count: 6, targetDurationSec: 600 });
    expect(() => YoutubeIdeasGenerateRequestSchema.parse({ steering: 'x'.repeat(501) })).toThrow();
    expect(() => YoutubeIdeasGenerateRequestSchema.parse({ count: 9 })).toThrow();
  });

  it('does not let a client mark an idea used or provide a manual check timestamp', () => {
    expect(() => YoutubeIdeaStatusPatchSchema.parse({ status: 'used' })).toThrow();
    expect(() => YoutubeIdeaStatusPatchSchema.parse({ manualDemand: { note: '   ' } })).toThrow();
    expect(() => YoutubeIdeaStatusPatchSchema.parse({ manualDemand: { note: 'Đã xem 5 kết quả', checkedAt: '2026-10-22T00:00:00.000Z' } })).toThrow();
    expect(() => YoutubeIdeaRecordSchema.parse({ ...validIdea, _id: 'x' })).toThrow();
  });

  it('allows reopening selected/rejected ideas but keeps used ideas terminal', () => {
    expect(canTransitionYoutubeIdeaStatus('new', 'chosen')).toBe(true);
    expect(canTransitionYoutubeIdeaStatus('rejected', 'chosen')).toBe(true);
    expect(canTransitionYoutubeIdeaStatus('chosen', 'rejected')).toBe(true);
    expect(canTransitionYoutubeIdeaStatus('used', 'chosen')).toBe(false);
  });
});
