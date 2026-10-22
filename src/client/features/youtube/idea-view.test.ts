import { describe, expect, it } from 'vitest';
import type { YoutubeIdea, YoutubeIdeaCreateProjectResponse } from '../../../contracts/youtube-ideas';
import { buildYoutubeIdeaResearchRequest, canChangeYoutubeIdeaStatus, isNearDuplicateYoutubeIdeaTitle, isYoutubeIdeaCoverageStale, mapYoutubeIdeaToProjectPrefill, normalizeYoutubeIdeaTitleForClient, validateYoutubeIdeaSteering, YOUTUBE_IDEA_MANUAL_CHECK_INSTRUCTIONS, youtubeIdeaGateText, youtubeIdeaTierText } from './idea-view';

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

describe('YouTube video idea view helpers', () => {
  it('uses honest tier and gate wording for all evidence tiers', () => {
    expect(youtubeIdeaTierText('no-performance-data', 2)).toContain('Chưa có dữ liệu hiệu quả');
    expect(youtubeIdeaTierText('weak-signal', 7)).toBe('Gợi ý yếu từ 7 video');
    expect(youtubeIdeaTierText('data-informed', 12)).toBe('Dựa trên 12 video đã đo');
    expect(youtubeIdeaGateText(2, 10)).toContain('Còn 8 video trưởng thành');
    expect(youtubeIdeaGateText(10, 10)).toContain('Đã đạt ngưỡng 10');
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
});
