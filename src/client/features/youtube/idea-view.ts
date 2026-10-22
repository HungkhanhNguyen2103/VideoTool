import { canTransitionYoutubeIdeaStatus, type YoutubeIdea, type YoutubeIdeaCreateProjectResponse, type YoutubeIdeaEvidenceTier, type YoutubeIdeaProjectPrefill, type YoutubeIdeaRunSummary, type YoutubeIdeaStatus } from '../../../contracts/youtube-ideas';
import { findDuplicateTitle, normalizeSeoTitleForComparison } from '../../../contracts/seo-duplicates';

export const YOUTUBE_IDEA_MANUAL_CHECK_INSTRUCTIONS = 'Gõ tiêu đề hoặc từ khóa chính vào tìm kiếm YouTube, mở 5 kết quả đầu: kênh nhỏ có video từ 10k lượt xem không? Video cũ hơn 2 năm còn lượt xem không? Ghi lại một câu.';

export function youtubeIdeaTierText(tier: YoutubeIdeaEvidenceTier, matureCount: number): string {
  if (tier === 'no-performance-data') return 'Chưa có dữ liệu hiệu quả: ý tưởng chỉ dựa trên hồ sơ kênh và các video đã làm';
  if (tier === 'weak-signal') return `Gợi ý yếu từ ${matureCount} video`;
  return `Dựa trên ${matureCount} video đã đo`;
}

export function youtubeIdeaGateText(matureCount: number, gate = 10): string {
  const remaining = Math.max(0, gate - matureCount);
  return remaining === 0
    ? `Đã đạt ngưỡng ${gate} video trưởng thành cho dữ liệu có tín hiệu.`
    : `Còn ${remaining} video trưởng thành để đạt ngưỡng ${gate} video đo lường.`;
}

export function validateYoutubeIdeaSteering(value: string): string | null {
  return value.length > 500 ? 'Chỉ dẫn tối đa 500 ký tự.' : null;
}

export function canChangeYoutubeIdeaStatus(from: YoutubeIdeaStatus, to: YoutubeIdeaStatus): boolean {
  return canTransitionYoutubeIdeaStatus(from, to);
}

export function buildYoutubeIdeaResearchRequest(idea: YoutubeIdea, language: 'vi' | 'en'): string {
  const motifLines = idea.motif
    ? (['hunter', 'perfectPlan', 'blindSpot', 'selfDestruction'] as const).map((key) => `- ${key}: ${idea.motif![key].text} (giả thuyết cần kiểm chứng; mức chứng cứ hiện tại: ${idea.motif![key].evidence})`).join('\n')
    : '- Preset không yêu cầu bốn mắt xích hubris-trap.';
  const facts = idea.unverifiedFacts.length ? idea.unverifiedFacts.map((fact) => `- ${fact}`).join('\n') : '- Chưa có dữ kiện cụ thể; tự xác định các chi tiết cần kiểm chứng.';
  return [
    'Yêu cầu research có dẫn nguồn trước khi viết kịch bản',
    `Chủ đề / tiêu đề: ${idea.title}`,
    `Ngôn ngữ: ${language === 'vi' ? 'Tiếng Việt' : 'English'}`,
    `Thời lượng mục tiêu: ${idea.suggestedDurationSec} giây`,
    'Các mắt xích của motif cần kiểm chứng:', motifLines,
    'Thông tin chưa kiểm chứng từ trí nhớ AI:', facts,
    'Chỉ ghi điều có nguồn; nếu thiếu bằng chứng cho một mắt xích, nói rõ.',
  ].join('\n');
}

export function mapYoutubeIdeaToProjectPrefill(response: YoutubeIdeaCreateProjectResponse): { youtubeIdea: { ideaId: string; prefill: YoutubeIdeaProjectPrefill } } {
  return { youtubeIdea: { ideaId: response.ideaId, prefill: { ...response.prefill, referencesText: '' } } };
}

export function isYoutubeIdeaCoverageStale(run: Pick<YoutubeIdeaRunSummary, 'coverageFingerprint'> | null, currentFingerprint: string): boolean {
  return Boolean(run && run.coverageFingerprint !== currentFingerprint);
}

export function normalizeYoutubeIdeaTitleForClient(value: string): string {
  return normalizeSeoTitleForComparison(value);
}

export function isNearDuplicateYoutubeIdeaTitle(candidate: string, knownTitles: readonly string[]): boolean {
  return findDuplicateTitle(candidate, knownTitles).length > 0;
}
