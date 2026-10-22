import { describe, expect, it, vi } from 'vitest';
import type { YoutubeIdea } from '../../../contracts/youtube-ideas';
import type { YoutubeIdeaV2 } from '../../../contracts/youtube-ideas';
import type { YoutubeIdeaPacket } from './idea-packet';
import { runYoutubeIdeaPipeline, validateYoutubeIdea, type YoutubeIdeaJobContext } from './idea-engine';
import { validateYoutubeIdeaV2 } from './idea-quality';

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

function context(overrides: Partial<YoutubeIdeaJobContext> = {}): YoutubeIdeaJobContext {
  return {
    reportProgress: vi.fn(async () => undefined),
    isCancelled: vi.fn(async () => false),
    appendLog: vi.fn(async () => undefined),
    ...overrides,
  };
}

function v2Idea(id: string, archetype: YoutubeIdeaV2['hunterArchetype'], period: string, score: number): YoutubeIdeaV2 {
  const episode = `Chỉ huy đổi kế hoạch tiếp tế sau khi tin đường chính an toàn ${id}.`;
  return {
    id, episode, period, place: `vùng ${id}`, hunterArchetype: archetype, famousnessGuess: 'obscure', famousnessFallback: false,
    angle: `góc ${id}`, title: `Kế hoạch tự khép lại ${id}`,
    hook: `Người chỉ huy tin rằng đường tiếp tế ${id} vẫn được bảo vệ.`,
    brief: `Người chỉ huy tin rằng đường tiếp tế ${id} vẫn an toàn. Kế hoạch kéo dài cuộc vây hãm. Một lối vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô lực lượng khiến kế hoạch khó xoay chuyển.`,
    presetId: 'hubris-trap',
    motif: {
      hunter: { text: 'Người chỉ huy tin đường tiếp tế được bảo vệ.', evidence: 'strong' },
      perfectPlan: { text: 'Kế hoạch kéo dài cuộc vây hãm dựa vào quân số đông.', evidence: 'partial' },
      blindSpot: { text: 'Tuyến tiếp tế kéo dài nằm ngoài dự tính.', evidence: 'partial' },
      selfDestruction: { text: 'Chính quy mô quân số kéo dài tuyến tiếp tế.', evidence: 'strong' },
    },
    trap: {
      hunterBelief: 'Người chỉ huy tin đường tiếp tế vẫn được bảo vệ.',
      outsideVariable: 'Tuyến tiếp tế kéo dài nằm ngoài khung nhìn.',
      exploitedBy: 'Bên phòng thủ dùng lối vòng để cắt tuyến tiếp tế.',
      advantageThatBackfired: 'Chính quy mô quân số kéo dài tuyến tiếp tế và làm lực lượng mắc kẹt.',
    },
    trapSketch: `Người chỉ huy tin đường tiếp tế ${id} an toàn, nên kéo dài cuộc vây hãm; nhưng tuyến tiếp tế nằm ngoài khung nhìn; kết quả lực lượng mắc kẹt vì chính quy mô của mình.`,
    whyForThisChannel: 'Chủ đề phù hợp với hồ sơ kênh.', testVariable: 'topic',
    successCriterion: { description: 'So sánh mức giữ chân đầu video sau khi đăng.', afterVideos: 3 },
    claims: [{ text: `Tuyến tiếp tế kéo dài khiến đội hình mắc kẹt trong ${period}; chính quy mô lực lượng khiến kế hoạch khó xoay chuyển.`, confidence: 'medium' }],
    risks: ['Cần kiểm chứng địa điểm và bối cảnh.'], rarityGuess: 'unknown', evidenceTier: 'no-performance-data',
    scores: { fit: score, clarity: score, riskOfThinSources: 1 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
  };
}

function v2Seed(id: string, archetype: YoutubeIdeaV2['hunterArchetype'], period: string) {
  return { id, episode: `Chỉ huy đổi tuyến tiếp tế tại ${id}.`, yearOrPeriod: period, place: `vùng ${id}`, hunterArchetype: archetype, domain: 'logistics', famousnessGuess: 'obscure' };
}

describe('runYoutubeIdeaPipeline', () => {
  it('accepts the expanded fixture against the trap and legacy safeguards', () => {
    expect(validateYoutubeIdeaV2(v2Idea('a', 'military', 'thế kỷ XIII', 5), packet).reasons).toEqual([]);
  });

  it('runs seeds, selection and expansion in batches of four, then trims deterministically', async () => {
    const seeds = [
      v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV'),
      v2Seed('c', 'economic', 'thế kỷ XV'), v2Seed('d', 'technological', 'thế kỷ XVI'),
      v2Seed('e', 'diplomatic', 'thế kỷ XVII'), v2Seed('f', 'institutional', 'thế kỷ XVIII'),
    ];
    const selected = seeds.map(({ id }) => ({ id, trapSketch: `Giả định cụ thể của ${id} bị lợi thế của chính người ra quyết định làm phản tác dụng.` }));
    const ideas = seeds.map((row, index) => v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 5 - Math.floor(index / 2)));
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: ideas.slice(0, 4) }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: ideas.slice(4) }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat.mock.calls.map((call) => call[1]?.stepLabel)).toEqual([
      'video-ideas-v2-seeds', 'video-ideas-v2-select', 'video-ideas-v2-expand',
    ]);
    expect(chat.mock.calls[2]![0][1]!.content).toContain('"id":"a"');
    expect(chat.mock.calls[2]![0][1]!.content).toContain('"id":"d"');
    expect(chat.mock.calls[2]![0][1]!.content).not.toContain('"id":"e"');
    expect(result?.ideas.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result?.promptVersion).toBe('video-ideas-v2');
    expect(result?.durations).toHaveProperty('seedsMs');
    expect(result?.repairCalls).toEqual({ seeds: 0, select: 0, expand: 0 });
  });

  it('accepts a more specific period when the added year is backed by claims or packet', async () => {
    const seed = v2Seed('french-1930', 'political', 'thời Pháp thuộc');
    const expanded = v2Idea(seed.id, seed.hunterArchetype, 'thời Pháp thuộc, năm 1930', 5);
    expanded.claims = [{ text: 'Thời Pháp thuộc năm 1930, quy mô lực lượng khiến kế hoạch khó xoay chuyển.', confidence: 'medium' }];
    const packetWithEvidence = { ...packet, serialized: JSON.stringify({ request: { count: 4, targetDurationSec: 600 }, historicalEvidence: 'Thời Pháp thuộc năm 1930' }) };
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds: [seed] }))
      .mockResolvedValueOnce(JSON.stringify({ selected: [{ id: seed.id, trapSketch: 'Niềm tin về đường tiếp tế khiến quy mô lực lượng thành điểm yếu.' }], rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [expanded] }));
    const result = await runYoutubeIdeaPipeline({ packet: packetWithEvidence, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(result?.ideas.map((row) => row.period)).toEqual(['thời Pháp thuộc, năm 1930']);
    expect(result?.dropped.some((row) => row.reason.includes('Thời kỳ trong bản chi tiết lệch seed'))).toBe(false);
  });

  it('continues into a later batch until running validated survivors reach the requested count', async () => {
    const archetypes: YoutubeIdeaV2['hunterArchetype'][] = ['military', 'political', 'economic', 'technological', 'diplomatic', 'institutional', 'other', 'military'];
    const seeds = archetypes.map((archetype, index) => v2Seed(`s${index}`, archetype, `thế kỷ ${13 + index}`));
    const selected = seeds.map(({ id }) => ({ id, trapSketch: 'Giả định biến lợi thế thành điểm yếu.' }));
    const rowsForBatch = (batch: typeof seeds, validCount: number) => batch.map((seed, index) => {
      const row = v2Idea(seed.id, seed.hunterArchetype, seed.yearOrPeriod, 4);
      if (index >= validCount) row.motif.blindSpot.evidence = 'thin';
      return row;
    });
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: rowsForBatch(seeds.slice(0, 4), 1) }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: rowsForBatch(seeds.slice(4), 3) }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat.mock.calls.filter((call) => call[1]?.stepLabel === 'video-ideas-v2-expand')).toHaveLength(2);
    expect(chat.mock.calls[3]![0][1]!.content).toContain('archetype còn thiếu');
    expect(result?.ideas).toHaveLength(4);
    expect(result?.diagnostics.expansionBatches).toHaveLength(2);
  });

  it('caps expansion at three batches and stops starting batches after the soft budget', async () => {
    const archetypes: YoutubeIdeaV2['hunterArchetype'][] = ['military', 'political', 'economic', 'technological', 'diplomatic', 'institutional', 'other', 'military', 'political', 'economic', 'technological', 'diplomatic'];
    const seeds = archetypes.map((archetype, index) => v2Seed(`s${index}`, archetype, `thế kỷ ${13 + index}`));
    const selected = seeds.map(({ id }) => ({ id, trapSketch: 'Giả định biến lợi thế thành điểm yếu.' }));
    const rowsForBatch = (batch: typeof seeds) => batch.map((seed, index) => {
      const row = v2Idea(seed.id, seed.hunterArchetype, seed.yearOrPeriod, 4);
      if (index > 0) row.motif.blindSpot.evidence = 'thin';
      return row;
    });
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: rowsForBatch(seeds.slice(0, 4)) }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: rowsForBatch(seeds.slice(4, 8)) }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: rowsForBatch(seeds.slice(8, 12)) }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 8, presetId: 'hubris-trap' } });
    expect(chat.mock.calls.filter((call) => call[1]?.stepLabel === 'video-ideas-v2-expand')).toHaveLength(3);
    expect(result?.diagnostics.expansionBatches).toHaveLength(3);
    expect(result?.ideas).toHaveLength(3);

    let now = 0;
    const budgetContext = context();
    const sourceResponses = [JSON.stringify({ seeds }), JSON.stringify({ selected, rejected: [] }), JSON.stringify({ ideas: rowsForBatch(seeds.slice(0, 4)) })];
    const budgetChat = vi.fn(async (_messages: unknown, options?: { stepLabel?: string }) => {
      if (options?.stepLabel === 'video-ideas-v2-expand') now += 241_000;
      return sourceResponses[budgetChat.mock.calls.length - 1]!;
    });
    const budgetResult = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat: budgetChat }, context: budgetContext, request: { count: 8, presetId: 'hubris-trap' }, clock: () => now });
    expect(budgetChat.mock.calls.filter((call) => call[1]?.stepLabel === 'video-ideas-v2-expand')).toHaveLength(1);
    expect(budgetResult?.diagnostics.budgetStopped).toBe(true);
    expect(budgetContext.appendLog).toHaveBeenCalledWith('Đã dừng thêm lượt viết chi tiết vì sắp hết thời gian dự kiến');
  });

  it('normalizes safe shape and enum problems before deciding whether a repair call is needed', async () => {
    const seeds = [v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV')];
    const first = { ...seeds[0]!, hunterArchetype: 'MILITARY', harmlessExtra: 'drop' };
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds: [first, seeds[1]] }))
      .mockResolvedValueOnce(JSON.stringify({ selected: seeds.map(({ id }) => ({ id, trapSketch: 'Một giả định bị chính lợi thế của người ra quyết định làm phản tác dụng.' })), rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: seeds.map((row) => v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4)) }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(result?.repairCalls).toEqual({ seeds: 0, select: 0, expand: 0 });
    expect(result?.ideas).toHaveLength(2);
  });

  it('repairs a selection that exceeds the shortlist bound once', async () => {
    const seeds = [
      v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV'),
      v2Seed('c', 'economic', 'thế kỷ XV'), v2Seed('d', 'technological', 'thế kỷ XVI'),
      v2Seed('e', 'diplomatic', 'thế kỷ XVII'), v2Seed('f', 'institutional', 'thế kỷ XVIII'),
      v2Seed('g', 'other', 'thế kỷ XIX'), v2Seed('h', 'economic', 'thế kỷ XX'), v2Seed('i', 'technological', 'thế kỷ XXI'),
    ];
    const selected = seeds.map(({ id }) => ({ id, trapSketch: `Giả định của ${id} bị chính lợi thế làm phản tác dụng.` }));
    const rejected = seeds.map(({ id }) => ({ id, rejectionReason: 'Không thuộc shortlist.' }));
    const firstBatchIdeas = seeds.slice(0, 4).map((row) => v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4));
    firstBatchIdeas[3]!.motif.blindSpot.evidence = 'thin';
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ selected: selected.slice(0, 8), rejected: [rejected[8]!] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: firstBatchIdeas }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: seeds.slice(4, 8).map((row) => v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4)) }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat).toHaveBeenCalledTimes(5);
    expect(chat.mock.calls[2]![1]?.stepLabel).toBe('video-ideas-v2-select-repair');
    expect(result?.repairCalls).toEqual({ seeds: 0, select: 1, expand: 0 });
    expect(result?.ideas).toHaveLength(4);
  });

  it('accepts a shorter fully classified shortlist when fewer seeds pass the trap test', async () => {
    const seeds = Array.from({ length: 18 }, (_, index) => v2Seed(
      `seed-${index + 1}`,
      (['military', 'political', 'economic', 'technological', 'diplomatic', 'institutional', 'other'] as const)[index % 7]!,
      `thế kỷ ${index + 1}`,
    ));
    const selectedSeeds = seeds.slice(0, 5);
    const selected = selectedSeeds.map(({ id }) => ({ id, trapSketch: `Giả định của ${id} bị chính lợi thế làm phản tác dụng.` }));
    const rejected = seeds.slice(5).map(({ id }) => ({ id, rejectionReason: 'Không có bẫy đủ rõ sau khi kiểm tra.' }));
    const ideas = selectedSeeds.map((row) => v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4));
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: ideas.slice(0, 4) }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: ideas.slice(4) }));

    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 6, presetId: 'hubris-trap' } });

    expect(chat).toHaveBeenCalledTimes(4);
    expect(chat.mock.calls[2]![1]?.stepLabel).toBe('video-ideas-v2-expand');
    expect(result?.ideas).toHaveLength(5);
    expect(result?.repairCalls.select).toBe(0);
  });

  it.each([9, 20])('accepts v2 ideas with %i research claims without inheriting the v1 eight-fact limit', async (claimCount) => {
    const seeds = [v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV')];
    const selected = seeds.map(({ id }) => ({ id, trapSketch: 'Giả định cụ thể bị chính lợi thế của người ra quyết định làm phản tác dụng.' }));
    const ideas = seeds.map((row) => ({
      ...v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4),
      claims: [v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4).claims[0]!, ...Array.from({ length: claimCount - 1 }, (_, index) => ({ text: `Chi tiết nghiên cứu ${index + 1} cần kiểm chứng.`, confidence: 'medium' as const }))],
    }));
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas }));

    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });

    expect(result?.ideas).toHaveLength(2);
    expect(result?.dropped.filter((row) => row.id === 'a' || row.id === 'b')).toEqual([]);
  });

  it('uses no more than one repair across all expansion batches', async () => {
    const seeds = [
      v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV'),
      v2Seed('c', 'economic', 'thế kỷ XV'), v2Seed('d', 'technological', 'thế kỷ XVI'),
      v2Seed('e', 'diplomatic', 'thế kỷ XVII'), v2Seed('f', 'institutional', 'thế kỷ XVIII'),
    ];
    const selected = seeds.map(({ id }) => ({ id, trapSketch: 'Giả định bị lợi thế của chính người ra quyết định làm phản tác dụng.' }));
    const wrong = { ...v2Idea('d', 'technological', 'thế kỷ XVI', 4), angle: '' };
    const secondWrong = { ...v2Idea('f', 'institutional', 'thế kỷ XVIII', 4), angle: '' };
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [...seeds.slice(0, 3).map((row) => v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4)), wrong] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [v2Idea('d', 'technological', 'thế kỷ XVI', 4)] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [v2Idea('e', 'diplomatic', 'thế kỷ XVII', 4), secondWrong] }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat.mock.calls.filter((call) => String(call[1]?.stepLabel).startsWith('video-ideas-v2-expand'))).toHaveLength(3);
    expect(result?.repairCalls).toEqual({ seeds: 0, select: 0, expand: 1 });
    expect(result?.dropped.some((row) => row.id === 'f')).toBe(true);
  });

  it('repairs omitted expansion rows and merges the repaired seed with valid rows', async () => {
    const seeds = [v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV'), v2Seed('c', 'economic', 'thế kỷ XV')];
    const selected = seeds.map(({ id }) => ({ id, trapSketch: 'Giả định bị chính lợi thế của người ra quyết định làm phản tác dụng.' }));
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected, rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [v2Idea('a', 'military', 'thế kỷ XIII', 4)] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [v2Idea('b', 'political', 'thế kỷ XIV', 4), v2Idea('c', 'economic', 'thế kỷ XV', 4)] }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat).toHaveBeenCalledTimes(4);
    expect(chat.mock.calls[3]![1]?.stepLabel).toBe('video-ideas-v2-expand-repair');
    expect(result?.repairCalls).toEqual({ seeds: 0, select: 0, expand: 1 });
    expect(result?.ideas.map((row) => row.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('fails with the top drop reasons when zero ideas survive', async () => {
    const seeds = [v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV')];
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected: seeds.map(({ id }) => ({ id, trapSketch: 'Giả định bị lợi thế của chính người ra quyết định làm phản tác dụng.' })), rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [{ ...v2Idea('a', 'military', 'thế kỷ XIII', 4), angle: '' }] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [] }));
    await expect(runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } })).rejects.toMatchObject({
      code: 'YOUTUBE_IDEAS_UNGROUNDED', message: expect.stringContaining('Lý do chính:'),
    });
  });

  it('keeps one valid survivor as a partial result', async () => {
    const seed = v2Seed('one', 'military', 'thế kỷ XIII');
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds: [seed] }))
      .mockResolvedValueOnce(JSON.stringify({ selected: [{ id: seed.id, trapSketch: 'Giả định biến lợi thế thành điểm yếu.' }], rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [v2Idea(seed.id, seed.hunterArchetype, seed.yearOrPeriod, 4)] }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(result).toMatchObject({ status: 'partial', ideas: [{ id: 'one' }] });
  });

  it('skips action-like claimed intentions and excludes previously proposed episodes before selection', async () => {
    const repeated = v2Seed('old', 'military', 'thế kỷ XIII');
    const fresh = v2Seed('fresh', 'political', 'thế kỷ XIV');
    const packetWithPrevious = {
      ...packet,
      packet: { ...packet.packet, alreadyProposedEpisodes: [repeated.episode] },
      serialized: JSON.stringify({ request: { targetDurationSec: 600 }, alreadyProposedEpisodes: [repeated.episode] }),
    } as YoutubeIdeaPacket;
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds: [repeated, fresh] }))
      .mockResolvedValueOnce(JSON.stringify({ selected: [{ id: fresh.id, trapSketch: 'Giả định biến lợi thế thành điểm yếu.' }], rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas: [v2Idea(fresh.id, fresh.hunterArchetype, fresh.yearOrPeriod, 4)] }));
    const result = await runYoutubeIdeaPipeline({ packet: packetWithPrevious, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat.mock.calls[1]![0][1]!.content).toContain('fresh');
    expect(chat.mock.calls[1]![0][1]!.content).not.toContain('"id":"old"');
    expect(result?.dropped).toContainEqual(expect.objectContaining({ id: 'old' }));
  });

  it('does not repair judgment failures in a batch', async () => {
    const seeds = [v2Seed('a', 'military', 'thế kỷ XIII'), v2Seed('b', 'political', 'thế kỷ XIV'), v2Seed('c', 'economic', 'thế kỷ XV')];
    const ideas = seeds.map((row) => v2Idea(row.id, row.hunterArchetype, row.yearOrPeriod, 4));
    ideas[1]!.motif.blindSpot.evidence = 'thin';
    ideas[2]!.trap.advantageThatBackfired = 'Một biến cố bất ngờ làm lực lượng suy yếu.';
    const chat = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ seeds }))
      .mockResolvedValueOnce(JSON.stringify({ selected: seeds.map(({ id }) => ({ id, trapSketch: 'Giả định biến lợi thế thành điểm yếu.' })), rejected: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ideas }));
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context(), request: { count: 4, presetId: 'hubris-trap' } });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(result?.repairCalls.expand).toBe(0);
    expect(result?.dropped.some((row) => row.reason.includes('blind spot mỏng'))).toBe(true);
  });

  it('stops after a stage response when cancellation arrives', async () => {
    let cancelled = false;
    const chat = vi.fn(async () => { cancelled = true; return JSON.stringify({ seeds: [v2Seed('a', 'military', 'thế kỷ XIII')] }); });
    const result = await runYoutubeIdeaPipeline({ packet, backend: { kind: 'cli', model: 'claude-sonnet-5-5', chat }, context: context({ isCancelled: async () => cancelled }), request: { count: 4, presetId: 'hubris-trap' } });
    expect(result).toBeUndefined();
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
