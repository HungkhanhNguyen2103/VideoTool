import { describe, expect, it } from 'vitest';
import type { YoutubeIdeaV2 } from '../../../contracts/youtube-ideas';
import { computeYoutubeIdeaEvalMetrics } from './idea-eval';

function idea(id: string, hunterArchetype: YoutubeIdeaV2['hunterArchetype'], period: string, blindSpot: 'strong' | 'partial' | 'thin' = 'partial'): YoutubeIdeaV2 {
  return {
    id, episode: 'Chỉ huy đổi tuyến tiếp tế khi tin đường chính đã an toàn.', period, place: 'đồng bằng', hunterArchetype,
    famousnessGuess: 'obscure', famousnessFallback: false, angle: 'góc hậu cần', title: 'Kế hoạch tự khép lại',
    hook: 'Người chỉ huy tin đường tiếp tế an toàn.',
    brief: 'Người chỉ huy tin đường tiếp tế đã an toàn. Kế hoạch kéo dài cuộc vây hãm. Một lối vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô lực lượng khiến kế hoạch khó xoay chuyển.',
    presetId: 'hubris-trap', motif: {
      hunter: { text: 'Người chỉ huy tin đường tiếp tế an toàn.', evidence: 'strong' },
      perfectPlan: { text: 'Kế hoạch dựa vào quy mô quân số.', evidence: 'partial' },
      blindSpot: { text: 'Tuyến tiếp tế nằm ngoài khung nhìn.', evidence: blindSpot },
      selfDestruction: { text: 'Chính quy mô lực lượng khiến kế hoạch khó xoay chuyển.', evidence: 'strong' },
    },
    trap: {
      hunterBelief: 'Người chỉ huy tin đường tiếp tế an toàn.', outsideVariable: 'Tuyến tiếp tế nằm ngoài khung nhìn.',
      exploitedBy: 'Bên phòng thủ cắt tuyến tiếp tế.', advantageThatBackfired: 'Chính quy mô lực lượng khiến kế hoạch khó xoay chuyển.',
    },
    trapSketch: 'Người chỉ huy tin đường tiếp tế an toàn; tuyến dài nằm ngoài khung nhìn; chính quy mô lực lượng khiến kế hoạch khó xoay chuyển.',
    whyForThisChannel: 'Một góc khác cho hồ sơ kênh.', testVariable: 'topic',
    successCriterion: { description: 'So sánh mức giữ chân đầu video.', afterVideos: 3 },
    claims: [{ text: 'Quy mô lực lượng khiến kế hoạch khó xoay chuyển.', confidence: id === 'idea-1' ? 'low' : 'medium' }],
    risks: [], rarityGuess: 'unknown', evidenceTier: 'no-performance-data',
    scores: { fit: 4, clarity: 4, riskOfThinSources: 2 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
  };
}

describe('YouTube idea eval metrics', () => {
  it('computes blind-spot, diversity, fame, claim, grounding, repair and duration metrics without a provider', () => {
    const metrics = computeYoutubeIdeaEvalMetrics({
      ideas: [idea('idea-1', 'military', 'thế kỷ XIII'), idea('idea-2', 'political', 'thế kỷ XIV', 'thin')],
      dropped: [{ id: 'idea-3', reason: 'blind spot mỏng.' }, { id: 'idea-4', reason: 'blind spot mỏng.' }, { id: 'idea-5', reason: 'trùng loại bẫy.' }],
      packetJson: '{}', repairCalls: { seeds: 0, select: 1, expand: 1 },
      durations: { seedsMs: 100, selectMs: 200, expandMs: 300, totalMs: 650 },
    });
    expect(metrics).toMatchObject({
      kept: 2, dropped: 3, blindSpotAtLeastPartial: 1, blindSpotShare: 0.5, distinctHunterArchetypes: 2,
      archetypeCounts: { military: 1, political: 1 }, distinctCenturies: 2, famousnessFamousCount: 0,
      claims: 2, lowConfidenceClaims: 1, lowConfidenceShare: 0.5,
      unbackedNumbers: [], unbackedNames: [], unsupportedCausalStatements: [],
      repairCalls: { seeds: 0, select: 1, expand: 1 }, durations: { totalMs: 650 },
    });
    expect(metrics.droppedReasonCounts).toEqual({ 'blind spot mỏng.': 2, 'trùng loại bẫy.': 1 });
    expect(metrics.titles).toHaveLength(2);
  });
});
