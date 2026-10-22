import { describe, expect, it } from 'vitest';
import {
  YoutubeIdeaSchema,
  YoutubeIdeaStatusPatchSchema,
  canTransitionYoutubeIdeaStatus,
  YoutubeIdeasGenerateRequestSchema,
  YoutubeIdeaRecordSchema,
  YoutubeIdeaV2Schema,
  YoutubeIdeaStoredSchema,
  YoutubeIdeaRunSummarySchema,
  IDEA_DEFAULT_CLI_MODEL,
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

  it('accepts a v2 episode idea with a structured trap and confidence-ranked claims', () => {
    const { unverifiedFacts: _legacyFacts, ...legacyFields } = validIdea;
    void _legacyFacts;
    const v2 = {
      ...legacyFields,
      episode: 'A commander extends the siege line after assuming the river crossing is secure',
      period: 'Late 13th century',
      place: 'River crossing',
      hunterArchetype: 'military',
      famousnessGuess: 'obscure',
      famousnessFallback: false,
      angle: 'supply line',
      trap: {
        hunterBelief: 'The crossing would remain safe behind the main force.',
        outsideVariable: 'A second route remained outside the command plan.',
        exploitedBy: 'The defending force used the unguarded route.',
        advantageThatBackfired: 'The larger force stretched its own supply line.',
      },
      trapSketch: 'Người chỉ huy tin rằng lối vượt sông đã an toàn, nên kéo dài đội hình; nhưng tuyến tiếp tế nằm ngoài khung nhìn; kết quả lực lượng tự mắc kẹt vì chính quy mô của mình.',
      claims: [{ text: 'The episode, commander and river crossing need source checks.', confidence: 'medium' }],
    };
    expect(YoutubeIdeaV2Schema.parse(v2)).toMatchObject({ hunterArchetype: 'military', claims: [{ confidence: 'medium' }] });
    expect(() => YoutubeIdeaV2Schema.parse({ ...v2, trap: { ...v2.trap, outsideVariable: 'x'.repeat(201) } })).toThrow();
  });

  it('keeps v1 stored rows readable through the versioned idea union', () => {
    expect(YoutubeIdeaStoredSchema.parse(validIdea)).toMatchObject({ unverifiedFacts: ['Cần kiểm chứng niên đại của sự kiện.'] });
    expect(() => YoutubeIdeaV2Schema.parse(validIdea)).toThrow();
    expect(IDEA_DEFAULT_CLI_MODEL).toBe('claude-sonnet-5-5');
  });

  it('accepts v2 records and per-stage durations alongside v1 summaries', () => {
    const { unverifiedFacts: _legacyFacts, ...legacyFields } = validIdea;
    void _legacyFacts;
    const idea = {
      ...legacyFields, episode: 'A commander extends the siege line.', period: '13th century', place: 'River crossing',
      hunterArchetype: 'military', famousnessGuess: 'obscure', famousnessFallback: false, angle: 'supply',
      trap: { hunterBelief: 'The crossing was safe.', outsideVariable: 'A second route was hidden.', exploitedBy: 'The defender used it.', advantageThatBackfired: 'The larger force stretched supplies.' },
      trapSketch: 'Một giả định trở thành điểm gãy.', claims: [{ text: 'The episode needs source checks.', confidence: 'medium' }],
    };
    expect(YoutubeIdeaRecordSchema.parse({
      id: 'record-v2', channelProfileId: 'channel-1', runId: 'run-v2', evidenceTier: 'no-performance-data', backend: 'cli',
      model: 'claude-sonnet-5-5', promptVersion: 'video-ideas-v2', generatedAt: '2026-10-22T00:00:00.000Z', idea, status: 'new',
    })).toMatchObject({ promptVersion: 'video-ideas-v2', idea: { claims: [{ confidence: 'medium' }] } });
    expect(YoutubeIdeaRunSummarySchema.parse({
      id: 'run-v2', evidenceTier: 'no-performance-data', backend: 'cli', model: 'claude-sonnet-5-5', promptVersion: 'video-ideas-v2',
      generatedAt: '2026-10-22T00:00:00.000Z', requestedCount: 6,
      packetSummary: { projectCount: 0, syncedVideoCount: 2, savedIdeaCount: 0, matureVideoCount: 2 },
      coverageFingerprint: 'a'.repeat(64), dropped: [], durations: { seedsMs: 10, selectMs: 20, expandMs: 30, totalMs: 60 },
    })).toMatchObject({ durations: { seedsMs: 10, selectMs: 20, expandMs: 30 } });
  });
});
