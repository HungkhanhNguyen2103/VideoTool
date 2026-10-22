import { canTransitionYoutubeIdeaStatus, IDEA_DEFAULT_CLI_MODEL, type YoutubeIdeaCreateProjectResponse, type YoutubeIdeaEvidenceTier, type YoutubeIdeaProjectPrefill, type YoutubeIdeaRunSummary, type YoutubeIdeaStatus, type YoutubeIdeaStored, type YoutubeIdeaV2 } from '../../../contracts/youtube-ideas';
import { findDuplicateTitle, normalizeSeoTitleForComparison } from '../../../contracts/seo-duplicates';

export const YOUTUBE_IDEA_MANUAL_CHECK_INSTRUCTIONS = 'Gõ tiêu đề hoặc từ khóa chính vào tìm kiếm YouTube, mở 5 kết quả đầu: kênh nhỏ có video từ 10k lượt xem không? Video cũ hơn 2 năm còn lượt xem không? Ghi lại một câu.';

export function youtubeIdeaCliDefaultModel(models: readonly { id: string }[]): string {
  return models.some((model) => model.id === IDEA_DEFAULT_CLI_MODEL) ? IDEA_DEFAULT_CLI_MODEL : models[0]?.id ?? IDEA_DEFAULT_CLI_MODEL;
}

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

export function youtubeIdeaIsV2(idea: YoutubeIdeaStored): idea is YoutubeIdeaV2 {
  return 'trap' in idea;
}

export const YOUTUBE_IDEA_ARCHETYPE_LABELS = {
  military: 'Quân sự', political: 'Chính trị', economic: 'Kinh tế', technological: 'Công nghệ',
  diplomatic: 'Ngoại giao', institutional: 'Thể chế', other: 'Khác',
} as const;

export function youtubeIdeaArchetypeLabel(archetype: keyof typeof YOUTUBE_IDEA_ARCHETYPE_LABELS): string {
  return YOUTUBE_IDEA_ARCHETYPE_LABELS[archetype];
}

export function youtubeIdeaFamousnessLabel(idea: YoutubeIdeaStored): string | null {
  if (!youtubeIdeaIsV2(idea)) return null;
  const estimate = idea.famousnessGuess === 'famous' ? 'nổi tiếng' : idea.famousnessGuess === 'known' ? 'đã biết' : idea.famousnessGuess === 'obscure' ? 'ít nổi tiếng' : 'chưa rõ';
  return `Độ nổi tiếng · ước đoán của AI: ${estimate}${idea.famousnessFallback ? ' · phương án dự phòng' : ''}`;
}

export type YoutubeIdeaTrapLine = { key: 'hunterBelief' | 'outsideVariable' | 'exploitedBy' | 'advantageThatBackfired'; label: string; text: string };
const TRAP_LINE_LABELS: Record<YoutubeIdeaTrapLine['key'], string> = {
  hunterBelief: 'Điều người đi săn tin', outsideVariable: 'Biến số ngoài khung nhìn',
  exploitedBy: 'Cách biến số bị khai thác', advantageThatBackfired: 'Lợi thế tự phản tác dụng',
};

export function youtubeIdeaTrapLines(idea: YoutubeIdeaStored): YoutubeIdeaTrapLine[] {
  if (!youtubeIdeaIsV2(idea)) return [];
  return (Object.keys(TRAP_LINE_LABELS) as YoutubeIdeaTrapLine['key'][]).map((key) => ({ key, label: TRAP_LINE_LABELS[key], text: idea.trap[key] }));
}

export type YoutubeIdeaClaimRow = { text: string; confidence: 'high' | 'medium' | 'low' };

export function youtubeIdeaClaimRows(idea: YoutubeIdeaStored): YoutubeIdeaClaimRow[] {
  const claims = youtubeIdeaIsV2(idea)
    ? idea.claims.map(({ text, confidence }) => ({ text, confidence }))
    : idea.unverifiedFacts.map((text) => ({ text, confidence: 'low' as const }));
  const order = { low: 0, medium: 1, high: 2 };
  return claims.map((claim, index) => ({ claim, index }))
    .sort((left, right) => order[left.claim.confidence] - order[right.claim.confidence] || left.index - right.index)
    .map(({ claim }) => claim);
}

export function youtubeIdeaConfidenceLabel(confidence: YoutubeIdeaClaimRow['confidence']): string {
  return confidence === 'low' ? 'Thấp · dễ sai — phải kiểm chứng trước' : confidence === 'medium' ? 'Vừa' : 'Cao';
}

export function youtubeIdeaStageDurations(durations: YoutubeIdeaRunSummary['durations']): Array<{ label: string; durationMs: number }> {
  if ('seedsMs' in durations) return [
    { label: 'Sơ bộ', durationMs: durations.seedsMs }, { label: 'Chọn lọc', durationMs: durations.selectMs },
    { label: 'Viết chi tiết', durationMs: durations.expandMs }, { label: 'Tổng', durationMs: durations.totalMs },
  ];
  return [
    { label: 'Sinh ý tưởng', durationMs: durations.generateMs }, { label: 'Phản biện', durationMs: durations.critiqueMs },
    { label: 'Tổng', durationMs: durations.totalMs },
  ];
}

export function youtubeIdeaDropReasonLabel(reason: string): string {
  const normalized = reason.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').toLocaleLowerCase('vi-VN');
  if (normalized.includes('blind spot mong')) return 'Blind spot mỏng';
  if (normalized.includes('khong phai bay tu giang')) return 'Không phải bẫy tự giăng';
  if (normalized.includes('qua dua vao tri nho')) return 'Quá dựa vào trí nhớ';
  if (normalized.includes('trung loai bay')) return 'Trùng loại bẫy';
  return reason;
}

function motifResearchLines(idea: YoutubeIdeaStored): string {
  const motifLines = idea.motif
    ? (['hunter', 'perfectPlan', 'blindSpot', 'selfDestruction'] as const).map((key) => `- ${key}: ${idea.motif![key].text} (giả thuyết cần kiểm chứng; mức chứng cứ hiện tại: ${idea.motif![key].evidence})`).join('\n')
    : '- Preset không yêu cầu bốn mắt xích hubris-trap.';
  return motifLines;
}

export function buildYoutubeIdeaResearchRequest(idea: YoutubeIdeaStored, language: 'vi' | 'en'): string {
  const motifLines = motifResearchLines(idea);
  const trapLines = youtubeIdeaTrapLines(idea).map((line) => `- ${line.key}: ${line.text} (giả thuyết cần kiểm chứng)`).join('\n');
  const claims = youtubeIdeaClaimRows(idea);
  const factLines = claims.length
    ? claims.map((claim) => `- [${claim.confidence === 'low' ? 'Thấp · Dễ sai — phải kiểm chứng trước' : claim.confidence === 'medium' ? 'Vừa' : 'Cao'}] ${claim.text}`).join('\n')
    : '- Chưa có claim cụ thể; tự xác định các chi tiết cần kiểm chứng.';
  return [
    'Yêu cầu research có dẫn nguồn trước khi viết kịch bản',
    `Chủ đề / tiêu đề: ${idea.title}`,
    `Ngôn ngữ: ${language === 'vi' ? 'Tiếng Việt' : 'English'}`,
    `Thời lượng mục tiêu: ${idea.suggestedDurationSec} giây`,
    'Các mắt xích của motif cần kiểm chứng:', motifLines,
    ...(trapLines ? ['Bốn giả thuyết của trap cần kiểm chứng:', trapLines] : []),
    youtubeIdeaIsV2(idea) ? 'Claims · checklist cần tìm nguồn (độ tin cậy chỉ là ước lượng của AI):' : 'Thông tin chưa kiểm chứng từ trí nhớ AI:', factLines,
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
