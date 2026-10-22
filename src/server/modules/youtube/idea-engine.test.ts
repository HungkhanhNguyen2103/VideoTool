import { describe, expect, it, vi } from 'vitest';
import type { YoutubeIdea } from '../../../contracts/youtube-ideas';
import type { YoutubeIdeaPacket } from './idea-packet';
import { runYoutubeIdeaPipeline, validateYoutubeIdea, type YoutubeIdeaJobContext } from './idea-engine';

const baseIdea: YoutubeIdea = {
  id: 'idea-1', title: 'Kế hoạch hoàn hảo tự sụp đổ', hook: 'Cánh cửa khép lại đúng lúc người đi săn bước vào.',
  brief: 'Một nhân vật chuẩn bị một kế hoạch tỉ mỉ. Một giả định quan trọng không được kiểm tra. Khi kế hoạch bắt đầu, dấu hiệu đầu tiên đã xuất hiện. Nhân vật bỏ qua dấu hiệu đó. Hành động tiếp theo khiến cái bẫy khép lại. Câu chuyện kết thúc bằng hệ quả do chính kế hoạch tạo ra.',
  presetId: 'hubris-trap', motif: {
    hunter: { text: 'Nhân vật chủ động dựng bẫy.', evidence: 'strong' },
    perfectPlan: { text: 'Kế hoạch có nhiều bước chuẩn bị.', evidence: 'partial' },
    blindSpot: { text: 'Một giả định quan trọng bị bỏ qua.', evidence: 'partial' },
    selfDestruction: { text: 'Kế hoạch quay lại gây hại cho chính người dựng.', evidence: 'strong' },
  },
  whyForThisChannel: 'Hồ sơ kênh đang thiếu câu chuyện có một điểm mù rõ ràng.', testVariable: 'topic',
  successCriterion: { description: 'So sánh mức giữ chân đầu video sau khi đăng.', afterVideos: 3 },
  unverifiedFacts: ['Tên và niên đại của sự kiện cần kiểm chứng.'], risks: [], rarityGuess: 'unknown', evidenceTier: 'no-performance-data',
  scores: { fit: 4, clarity: 4, riskOfThinSources: 2 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
};

const packet: YoutubeIdeaPacket = {
  evidenceTier: 'no-performance-data' as const,
  packet: {
    evidence: { tier: 'no-performance-data', matureVideoCount: 2 },
    request: { presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
    coverage: { projects: [{ title: 'Một câu chuyện cũ' }], syncedVideos: [{ title: 'Video cũ' }], savedIdeas: [{ title: 'Ý tưởng đã lưu' }] },
  },
  serialized: JSON.stringify({ evidence: { tier: 'no-performance-data', matureVideoCount: 2 }, request: { targetDurationSec: 600 } }),
  coverageFingerprint: 'a'.repeat(64), fingerprint: 'b'.repeat(64),
  packetSummary: { projectCount: 1, syncedVideoCount: 1, savedIdeaCount: 1, matureVideoCount: 2 },
};

describe('validateYoutubeIdea', () => {
  it('accepts a well-formed hubris-trap idea with enough non-thin motif links', () => {
    expect(validateYoutubeIdea(baseIdea, packet).reasons).toEqual([]);
  });

  it('drops normalized duplicate titles even when diacritics differ', () => {
    const result = validateYoutubeIdea({ ...baseIdea, title: 'Mot cau chuyen cu' }, packet);
    expect(result.reasons.join(' ')).toContain('trùng hoặc gần trùng');
  });

  it('requires all four hubris motifs and at least two non-thin links', () => {
    const missing = validateYoutubeIdea({ ...baseIdea, motif: { ...baseIdea.motif!, hunter: undefined } }, packet);
    expect(missing.reasons.join(' ')).toContain('thiếu mắt xích');
    const thinMotifs = Object.fromEntries(Object.entries(baseIdea.motif!).map(([key, value]) => [key, { ...value, evidence: 'thin' }])) as unknown as YoutubeIdea['motif'];
    const thin = validateYoutubeIdea({ ...baseIdea, title: 'Một kế hoạch hoàn hảo tự phá hủy', motif: thinMotifs }, packet);
    expect(thin.reasons.join(' ')).toContain('không đủ khớp mẫu');
  });

  it('rejects unsupported numbers, promise language, and rarity claims in title or brief', () => {
    const numeric = validateYoutubeIdea({ ...baseIdea, title: 'Kế hoạch có 99 bước', whyForThisChannel: 'Hồ sơ kênh có 99 video.' }, packet);
    expect(numeric.reasons.join(' ')).toContain('số chưa có trong gói dữ liệu');
    const promise = validateYoutubeIdea({ ...baseIdea, title: 'Kế hoạch chắc chắn viral' }, packet);
    expect(promise.reasons.join(' ')).toContain('hứa hẹn hoặc dự đoán');
    const rarity = validateYoutubeIdea({ ...baseIdea, title: 'Ít ai biết câu chuyện này' }, packet);
    expect(rarity.reasons.join(' ')).toContain('ước đoán độ hiếm');
    const rarityBrief = validateYoutubeIdea({ ...baseIdea, title: 'Kế hoạch tự sụp đổ', brief: 'Đây là câu chuyện ít ai biết. Một nhân vật dựng kế hoạch. Một giả định bị bỏ qua. Dấu hiệu cảnh báo xuất hiện. Nhân vật vẫn tiếp tục. Cái bẫy khép lại. Hệ quả cần kiểm chứng.' }, packet);
    expect(rarityBrief.reasons.join(' ')).toContain('ước đoán độ hiếm');
  });

  it('rejects unsupported demand claims and durations above the requested target', () => {
    const demand = validateYoutubeIdea({ ...baseIdea, whyForThisChannel: 'Nhu cầu tìm kiếm đang tăng nhanh.' }, packet);
    expect(demand.reasons.join(' ')).toContain('khẳng định về nhu cầu');
    const duration = validateYoutubeIdea({ ...baseIdea, suggestedDurationSec: 601 }, packet);
    expect(duration.reasons.join(' ')).toContain('vượt quá thời lượng mục tiêu');
  });

  it('requires narrative numbers to be in the packet or explicitly flagged for research', () => {
    const brief = 'Một kế hoạch được lập. Một giả định bị bỏ qua. Dấu hiệu cảnh báo xuất hiện. Quyết định tiếp tục. Cái bẫy khép lại. Một triều đại kết thúc năm 1527. Hệ quả cần kiểm chứng.';
    const unflagged = validateYoutubeIdea({ ...baseIdea, brief }, packet);
    expect(unflagged.reasons.join(' ')).toContain('Số trong phần kể');
    const flagged = validateYoutubeIdea({ ...baseIdea, brief, unverifiedFacts: ['Niên đại 1527 cần kiểm chứng.'] }, packet);
    expect(flagged.reasons).toEqual([]);
  });

  it('rejects a tier mismatch and brief text outside its contract', () => {
    expect(validateYoutubeIdea({ ...baseIdea, evidenceTier: 'data-informed' }, packet).reasons.join(' ')).toContain('bậc chứng cứ');
    expect(validateYoutubeIdea({ ...baseIdea, brief: 'Ngắn.' }, packet).reasons.join(' ')).toContain('schema');
  });
});

function draft(id: string, title: string): Omit<YoutubeIdea, 'scores'> {
  const { scores, ...candidate } = baseIdea;
  void scores;
  return { ...candidate, id, title };
}

function context(overrides: Partial<YoutubeIdeaJobContext> = {}): YoutubeIdeaJobContext {
  return {
    reportProgress: vi.fn(async () => undefined),
    isCancelled: vi.fn(async () => false),
    appendLog: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('runYoutubeIdeaPipeline', () => {
  it('runs generation then critique and merges scores by id while recording rejected candidates', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ ideas: [draft('one', 'Kế hoạch tự khép thành chiếc bẫy'), draft('two', 'Giả định sai làm kế hoạch sụp đổ'), draft('three', 'Khi người dựng bẫy mắc vào chính nó')] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [
        { id: 'two', decision: 'keep', scores: { fit: 5, clarity: 4, riskOfThinSources: 1 } },
        { id: 'one', decision: 'drop', rejectionReason: 'Quá giống nội dung đã làm.', scores: { fit: 2, clarity: 3, riskOfThinSources: 4 } },
        { id: 'three', decision: 'keep', scores: { fit: 4, clarity: 4, riskOfThinSources: 2 } },
      ] }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-opus-4-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]![1]).toEqual({ stepLabel: 'video-ideas-generate' });
    expect(chat.mock.calls[1]![1]).toEqual({ stepLabel: 'video-ideas-critique' });
    expect(result?.ideas).toHaveLength(2);
    expect(result?.ideas[0]).toMatchObject({ id: 'two', scores: { fit: 5, clarity: 4, riskOfThinSources: 1 } });
    expect(result?.dropped).toContainEqual({ id: 'one', reason: 'Quá giống nội dung đã làm.' });
  });

  it('repairs invalid candidate rows once and uses the repaired item', async () => {
    const broken = { ...draft('repair-me', 'Mục tiêu bị bỏ quên'), motif: { hunter: { text: '', evidence: 'strong' } } };
    const repaired = draft('repair-me', 'Mục tiêu bị bỏ quên ở cửa sau');
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ ideas: [broken, draft('second', 'Kế hoạch lệch khỏi dự tính')] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [repaired] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [
        { id: 'repair-me', decision: 'keep', scores: { fit: 4, clarity: 4, riskOfThinSources: 2 } },
        { id: 'second', decision: 'keep', scores: { fit: 3, clarity: 4, riskOfThinSources: 2 } },
      ] }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-opus-4-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls[1]![1]).toEqual({ stepLabel: 'video-ideas-generate-repair' });
    expect(result?.ideas[0]?.title).toBe('Mục tiêu bị bỏ quên ở cửa sau');
  });

  it('fails with YOUTUBE_IDEAS_UNGROUNDED when fewer than half the requested ideas survive', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ ideas: [draft('one', 'Kế hoạch tự khép thành chiếc bẫy')] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [{ id: 'one', decision: 'drop', rejectionReason: 'Nguồn quá mỏng.', scores: { fit: 1, clarity: 2, riskOfThinSources: 5 } }] }));
    await expect(runYoutubeIdeaPipeline({ packet, backend: { kind: 'api', model: 'deepseek-chat', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } }))
      .rejects.toMatchObject({ code: 'YOUTUBE_IDEAS_UNGROUNDED' });
  });

  it('does not continue to critique after cancellation between calls', async () => {
    const chat = vi.fn().mockResolvedValueOnce(JSON.stringify({ ideas: [draft('one', 'Kế hoạch tự khép thành chiếc bẫy')] }));
    const isCancelled = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'api', model: 'deepseek-chat', chat }, context: context({ isCancelled }), request: { count: 4, presetId: 'hubris-trap' } });
    expect(result).toBeUndefined();
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
