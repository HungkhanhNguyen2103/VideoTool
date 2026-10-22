import { describe, expect, it } from 'vitest';
import type { YoutubeIdea, YoutubeIdeaCreateProjectResponse, YoutubeIdeaV2 } from '../../../contracts/youtube-ideas';
import { buildYoutubeIdeaResearchRequest, canChangeYoutubeIdeaStatus, isNearDuplicateYoutubeIdeaTitle, isYoutubeIdeaCoverageStale, mapYoutubeIdeaToProjectPrefill, normalizeYoutubeIdeaTitleForClient, validateYoutubeIdeaSteering, YOUTUBE_IDEA_MANUAL_CHECK_INSTRUCTIONS, youtubeIdeaArchetypeLabel, youtubeIdeaClaimRows, youtubeIdeaCliDefaultModel, youtubeIdeaDropReasonLabel, youtubeIdeaFamousnessLabel, youtubeIdeaGateText, youtubeIdeaStageDurations, youtubeIdeaTierText, youtubeIdeaTrapLines } from './idea-view';

const idea: YoutubeIdea = {
  id: 'idea-1', title: 'Kế hoạch hoàn hảo tự sụp đổ', hook: 'Cánh cửa khép lại khi người đi săn bước vào.',
  brief: 'Một nhân vật chuẩn bị kế hoạch. Một giả định bị bỏ qua. Dấu hiệu đầu tiên xuất hiện. Nhân vật tiếp tục như trước. Cái bẫy dần khép lại. Hệ quả đến từ chính kế hoạch ấy.',
  presetId: 'hubris-trap', motif: {
    hunter: { text: 'Chủ động đặt bẫy.', evidence: 'strong' },
    perfectPlan: { text: 'Kế hoạch được chuẩn bị.', evidence: 'partial' },
    blindSpot: { text: 'Một giả định bị bỏ sót.', evidence: 'thin' },
    selfDestruction: { text: 'Hành động quay lại gây hại.', evidence: 'strong' },
  },
  whyForThisChannel: 'Thiếu một câu chuyện có điểm mù.', testVariable: 'topic',
  successCriterion: { description: 'So sánh mức giữ chân đầu video.', afterVideos: 3 },
  unverifiedFacts: ['Tên sự kiện cần kiểm chứng.'], risks: [], rarityGuess: 'rare', evidenceTier: 'no-performance-data',
  scores: { fit: 4, clarity: 4, riskOfThinSources: 2 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
};

const v2Idea: YoutubeIdeaV2 = {
  id: 'idea-v2', episode: 'Chỉ huy kéo dài cuộc vây hãm khi tin tuyến tiếp tế đã an toàn.', period: 'thế kỷ XIII', place: 'đồng bằng',
  hunterArchetype: 'military', famousnessGuess: 'known', famousnessFallback: true, angle: 'hậu cần', title: 'Kế hoạch tự khép lại',
  hook: 'Người chỉ huy tin đường tiếp tế vẫn an toàn.',
  brief: 'Người chỉ huy tin đường tiếp tế đã an toàn. Kế hoạch kéo dài cuộc vây hãm. Một đường vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô đội hình khiến đường tiếp tế khó bảo vệ.',
  presetId: 'hubris-trap', motif: {
    hunter: { text: 'Người chỉ huy tin tuyến tiếp tế.', evidence: 'strong' }, perfectPlan: { text: 'Kế hoạch dựa vào quân số.', evidence: 'partial' },
    blindSpot: { text: 'Tuyến tiếp tế dài nằm ngoài khung nhìn.', evidence: 'partial' }, selfDestruction: { text: 'Quy mô khiến tuyến tiếp tế khó bảo vệ.', evidence: 'strong' },
  },
  trap: { hunterBelief: 'Tin tuyến tiếp tế an toàn.', outsideVariable: 'Tuyến tiếp tế kéo dài.', exploitedBy: 'Bên phòng thủ cắt tuyến.', advantageThatBackfired: 'Chính quy mô quân số gây khó cho hậu cần.' },
  trapSketch: 'Người chỉ huy tin tuyến tiếp tế an toàn, nên kéo dài cuộc vây hãm; nhưng tuyến dài nằm ngoài khung nhìn; lực lượng mắc kẹt vì chính quy mô của mình.',
  whyForThisChannel: 'Góc này bổ sung một tập sự kiện.', testVariable: 'topic', successCriterion: { description: 'So sánh giữ chân sau khi đăng.', afterVideos: 3 },
  claims: [{ text: 'Địa điểm và bối cảnh của cuộc vây hãm cần kiểm chứng.', confidence: 'low' }, { text: 'Kế hoạch dựa vào quy mô quân số.', confidence: 'medium' }],
  risks: [], rarityGuess: 'unknown', evidenceTier: 'no-performance-data', scores: { fit: 4, clarity: 4, riskOfThinSources: 2 },
  suggestedDurationSec: 600, suggestedChapterCount: 5,
};

describe('YouTube video idea view helpers', () => {
  it('uses honest tier and gate wording for all evidence tiers', () => {
    expect(youtubeIdeaTierText('no-performance-data', 2)).toContain('Chưa có dữ liệu hiệu quả');
    expect(youtubeIdeaTierText('weak-signal', 7)).toBe('Gợi ý yếu từ 7 video');
    expect(youtubeIdeaTierText('data-informed', 12)).toBe('Dựa trên 12 video đã đo');
    expect(youtubeIdeaGateText(2, 10)).toContain('Còn 8 video trưởng thành');
    expect(youtubeIdeaGateText(10, 10)).toContain('Đã đạt ngưỡng 10');
  });

  it('selects the shared CLI default even when the registry ordering changes', () => {
    expect(youtubeIdeaCliDefaultModel()).toBe('claude-sonnet-5-5');
  });

  it('checks steering length, status transitions, stale coverage, and diacritic-insensitive duplicate titles', () => {
    expect(validateYoutubeIdeaSteering('x'.repeat(500))).toBeNull();
    expect(validateYoutubeIdeaSteering('x'.repeat(501))).toContain('500');
    expect(canChangeYoutubeIdeaStatus('new', 'chosen')).toBe(true);
    expect(canChangeYoutubeIdeaStatus('used', 'new')).toBe(false);
    expect(isYoutubeIdeaCoverageStale({ coverageFingerprint: 'a'.repeat(64) }, 'b'.repeat(64))).toBe(true);
    expect(isYoutubeIdeaCoverageStale(null, 'b'.repeat(64))).toBe(false);
    expect(normalizeYoutubeIdeaTitleForClient('Kế hoạch hoàn hảo')).toBe(normalizeYoutubeIdeaTitleForClient('Ke hoach hoan hao'));
    expect(isNearDuplicateYoutubeIdeaTitle('Mot cau chuyen cu', ['Một câu chuyện cũ'])).toBe(true);
  });

  it('builds a source-first research request and keeps the idea handoff references empty', () => {
    const request = buildYoutubeIdeaResearchRequest(idea, 'vi');
    expect(request).toContain(idea.title);
    expect(request).toContain('hunter: Chủ động đặt bẫy.');
    expect(request).toContain('Tên sự kiện cần kiểm chứng.');
    expect(request).toContain('Chỉ ghi điều có nguồn; nếu thiếu bằng chứng cho một mắt xích, nói rõ.');
    expect(YOUTUBE_IDEA_MANUAL_CHECK_INSTRUCTIONS).toContain('5 kết quả đầu');
    const response: YoutubeIdeaCreateProjectResponse = {
      ideaId: 'idea-1', prefill: { title: idea.title, language: 'vi', brief: idea.brief, referencesText: '', scriptPresetId: idea.presetId, targetDurationSec: 600, chapterCount: 5, channelId: 'channel-1', researchNote: 'Chưa có nguồn: cần research có dẫn nguồn trước khi viết kịch bản' },
    };
    expect(mapYoutubeIdeaToProjectPrefill(response)).toEqual({ youtubeIdea: { ideaId: 'idea-1', prefill: { ...response.prefill, referencesText: '' } } });
  });

  it('puts v2 trap hypotheses and low-confidence claims first in the research checklist', () => {
    const request = buildYoutubeIdeaResearchRequest(v2Idea, 'vi');
    expect(request).toContain('hunterBelief: Tin tuyến tiếp tế an toàn.');
    expect(request.indexOf('Dễ sai — phải kiểm chứng trước')).toBeLessThan(request.indexOf('Kế hoạch dựa vào quy mô quân số.'));
    expect(youtubeIdeaClaimRows(v2Idea).map((claim) => claim.confidence)).toEqual(['low', 'medium']);
    expect(youtubeIdeaTrapLines(v2Idea)).toHaveLength(4);
  });

  it('formats v2 chips, stage durations, and the new drop reasons', () => {
    expect(youtubeIdeaArchetypeLabel(v2Idea.hunterArchetype)).toBe('Quân sự');
    expect(youtubeIdeaFamousnessLabel(v2Idea)).toContain('ước đoán của AI');
    expect(youtubeIdeaFamousnessLabel(v2Idea)).toContain('phương án dự phòng');
    expect(youtubeIdeaStageDurations({ seedsMs: 1_000, selectMs: 2_000, expandMs: 4_000, totalMs: 7_000 })).toEqual([
      { label: 'Sơ bộ', durationMs: 1_000 }, { label: 'Chọn lọc', durationMs: 2_000 }, { label: 'Viết chi tiết', durationMs: 4_000 }, { label: 'Tổng', durationMs: 7_000 },
    ]);
    expect(youtubeIdeaStageDurations({ generateMs: 1_000, critiqueMs: 2_000, totalMs: 3_000 }).map((item) => item.label)).toEqual(['Sinh ý tưởng', 'Phản biện', 'Tổng']);
    expect(youtubeIdeaDropReasonLabel('blind spot mỏng.')).toBe('Blind spot mỏng');
    expect(youtubeIdeaDropReasonLabel('không phải bẫy tự giăng.')).toBe('Không phải bẫy tự giăng');
    expect(youtubeIdeaDropReasonLabel('quá dựa vào trí nhớ: quá nửa claim có độ tin cậy thấp.')).toBe('Quá dựa vào trí nhớ');
    expect(youtubeIdeaDropReasonLabel('trùng loại bẫy trong cùng thế kỷ.')).toBe('Trùng loại bẫy');
  });
});
