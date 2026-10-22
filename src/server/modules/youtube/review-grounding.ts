import type { ReviewMetricMap } from './review-evidence';

export const YOUTUBE_REVIEW_STOP_LANGUAGE = [
  'nen dung', 'hay dung', 'can dung', 'can nhac dung', 'khuyen nghi dung', 'dung kenh', 'dung ngach',
  'bo ngach', 'bo kenh', 'ngung lam', 'ngung dang video', 'tam dung kenh', 'cham dut kenh',
  'abandon the niche', 'stop the channel', 'quit the channel',
] as const;

export const YOUTUBE_REVIEW_FORBIDDEN_PROMISE_LANGUAGE = [
  'se dat', 'se tang', 'se co', 'chac chan', 'dam bao', 'cam ket', 'will reach', 'will get', 'guaranteed',
] as const;

type JsonRecord = Record<string, unknown>;

export type YoutubeReviewInvalidItem = { path: string; reasons: string[]; value: unknown };
export type YoutubeReviewGroundingResult = { output: JsonRecord; invalidItems: YoutubeReviewInvalidItem[]; checked: number };

function normalizeVietnamese(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/đ/giu, 'd').toLocaleLowerCase('vi-VN');
}

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function collectVideoIds(packet: JsonRecord): Set<string> {
  const ids = new Set<string>();
  const singleVideoId = object(packet.video).videoId;
  if (typeof singleVideoId === 'string') ids.add(singleVideoId);
  if (Array.isArray(packet.videos)) for (const row of packet.videos) {
    const videoId = object(row).videoId;
    if (typeof videoId === 'string') ids.add(videoId);
  }
  return ids;
}

function collectSearchRanks(packet: JsonRecord): Set<number> {
  const ranks = new Set<number>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const row = value as JsonRecord;
    if (typeof row.rank === 'number' && Number.isInteger(row.rank) && typeof row.term === 'string') ranks.add(row.rank);
    for (const child of Object.values(row)) visit(child, depth + 1);
  };
  visit(packet.searchTerms, 0);
  visit(packet.channelSearchTerms, 0);
  visit(object(packet.video).searchTerms, 0);
  return ranks;
}

function parseLocalizedNumber(raw: string, suffix: string): { value: number; precision: number; percent: boolean } | null {
  let numeric = raw.replace(/\s/gu, '');
  const comma = numeric.lastIndexOf(',');
  const dot = numeric.lastIndexOf('.');
  let decimalSeparator = '';
  if (comma >= 0 && dot >= 0) decimalSeparator = comma > dot ? ',' : '.';
  else if (comma >= 0) {
    const trailing = numeric.length - comma - 1;
    if (trailing > 0 && trailing <= 2) decimalSeparator = ',';
  } else if (dot >= 0) {
    const trailing = numeric.length - dot - 1;
    if (trailing > 0 && trailing <= 2) decimalSeparator = '.';
  }
  if (decimalSeparator) {
    const grouping = decimalSeparator === ',' ? '.' : ',';
    numeric = numeric.split(grouping).join('').replace(decimalSeparator, '.');
  } else numeric = numeric.replace(/[.,]/gu, '');
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return null;
  const precision = decimalSeparator ? numeric.split('.')[1]?.length ?? 0 : 0;
  const normalizedSuffix = normalizeVietnamese(suffix.trim());
  const multiplier = normalizedSuffix === 'k' || normalizedSuffix === 'nghin' || normalizedSuffix === 'ngan' ? 1_000
    : normalizedSuffix === 'trieu' || normalizedSuffix === 'tr' ? 1_000_000 : 1;
  return { value: parsed * multiplier, precision, percent: normalizedSuffix === '%' };
}

type NumberToken = { raw: string; value: number; precision: number; percent: boolean; before: string; after: string; time: boolean; date: boolean };

function extractNumberTokens(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  const masked = [...text];
  const maskRange = (start: number, end: number) => { for (let i = start; i < end; i += 1) masked[i] = ' '; };
  const timePattern = /(?<![\p{L}\p{N}])(\d{1,2}):(\d{2})(?![\p{L}\p{N}])/gu;
  for (const match of text.matchAll(timePattern)) {
    const raw = match[0]; const start = match.index ?? 0; const seconds = Number(match[1]) * 60 + Number(match[2]);
    tokens.push({ raw, value: seconds, precision: 0, percent: false, before: text.slice(Math.max(0, start - 12), start), after: text.slice(start + raw.length, start + raw.length + 12), time: true, date: false });
    maskRange(start, start + raw.length);
  }
  const datePattern = /(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})(?!\d)/gu;
  for (const match of text.matchAll(datePattern)) {
    const raw = match[0]; const start = match.index ?? 0;
    tokens.push({ raw, value: Number.NaN, precision: 0, percent: false, before: '', after: '', time: false, date: true });
    maskRange(start, start + raw.length);
  }
  const remaining = masked.join('');
  const numberPattern = /(?<![\p{L}\p{N}])([+-]?\d(?:[\d.,]*\d)?)(\s*(?:%|k\b|nghìn|ngàn|triệu|tr\b))?/giu;
  for (const match of remaining.matchAll(numberPattern)) {
    const raw = match[1] ?? '';
    const suffix = match[2] ?? '';
    const parsed = parseLocalizedNumber(raw, suffix);
    if (!parsed) continue;
    const start = match.index ?? 0;
    const full = match[0];
    tokens.push({ raw: full.trim(), ...parsed, before: text.slice(Math.max(0, start - 16), start), after: text.slice(start + full.length, start + full.length + 20), time: false, date: false });
  }
  return tokens.sort((a, b) => text.indexOf(a.raw) - text.indexOf(b.raw));
}

function roundAt(value: number, precision: number): number {
  const scale = 10 ** Math.min(precision, 6);
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function tokenMatchesMetric(token: NumberToken, metric: { value: number; unit: string }): boolean {
  const candidates = [metric.value];
  if (metric.unit === 'fraction') candidates.push(metric.value * 100);
  if (metric.unit === 'percent' && token.percent) candidates.push(metric.value / 100);
  return candidates.some((candidate) => roundAt(candidate, token.precision) === roundAt(token.value, token.precision));
}

function matchesAllowedNumbers(text: string, metricIds: readonly string[], metricMap: ReviewMetricMap, packet: JsonRecord, extra: number[] = []): string[] {
  const ids = metricIds.filter((id) => Object.hasOwn(metricMap, id));
  const metrics = ids.map((id) => metricMap[id]!);
  const allPacketText = JSON.stringify(packet);
  const retentionDrops = Array.isArray(object(packet.retention).drops) ? object(packet.retention).drops as JsonRecord[] : [];
  const times = retentionDrops.flatMap((drop) => [Number(drop.fromSec), Number(drop.toSec)]).filter(Number.isFinite).map(Math.round);
  const sceneIndexes = new Set<number>(retentionDrops.flatMap((drop) => Array.isArray(drop.sceneIndexes) ? drop.sceneIndexes as number[] : []));
  const violations: string[] = [];
  for (const token of extractNumberTokens(text)) {
    if (token.date && allPacketText.includes(token.raw)) continue;
    if (token.time && times.includes(Math.round(token.value))) continue;
    const isSingleVideo = token.value === 1 && /video/u.test(normalizeVietnamese(token.after));
    const isStepNumber = /(?:buoc|step)\s*$/u.test(normalizeVietnamese(token.before));
    const isPacketScene = /(?:canh|scene)\s*$/u.test(normalizeVietnamese(token.before)) && sceneIndexes.has(token.value);
    if (isSingleVideo || isStepNumber || isPacketScene || extra.some((value) => roundAt(value, token.precision) === roundAt(token.value, token.precision))) continue;
    if (!metrics.some((metric) => tokenMatchesMetric(token, metric))) violations.push(token.raw);
  }
  return [...new Set(violations)];
}

function forbiddenPhrases(text: string, phrases: readonly string[]): string[] {
  const normalized = normalizeVietnamese(text);
  return phrases.filter((phrase) => {
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrase}(?:$|[^\\p{L}\\p{N}])`, 'u');
    return pattern.test(normalized);
  });
}

function stopLanguageViolation(text: string): boolean {
  const normalized = normalizeVietnamese(text);
  return YOUTUBE_REVIEW_STOP_LANGUAGE.some((phrase) => {
    const index = normalized.indexOf(phrase);
    if (index < 0) return false;
    const prefix = normalized.slice(Math.max(0, index - 18), index).trim();
    return !/(?:khong|chua|khong nen)\s*$/u.test(prefix);
  });
}

function normalizedTitle(value: string): string {
  return normalizeVietnamese(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function titleIsDuplicate(title: string, existing: readonly string[]): boolean {
  const candidate = normalizedTitle(title);
  if (!candidate) return false;
  const candidateTokens = new Set(candidate.split(' '));
  return existing.some((value) => {
    const previous = normalizedTitle(value);
    if (!previous) return false;
    if (candidate === previous) return true;
    const previousTokens = new Set(previous.split(' '));
    const intersection = [...candidateTokens].filter((token) => previousTokens.has(token)).length;
    return intersection / Math.max(1, new Set([...candidateTokens, ...previousTokens]).size) >= 0.82;
  });
}

const VARIABLE_TERMS: Record<string, RegExp> = {
  topic: /\b(?:chu de|ngach|noi dung)\b/u,
  title: /\b(?:tieu de|title)\b/u,
  thumbnail: /\b(?:thumbnail|anh bia)\b/u,
  hook: /\b(?:hook|mo dau|mo bai)\b/u,
  length: /\b(?:do dai|thoi luong)\b/u,
  cadence: /\b(?:tan suat|lich dang|nhip dang)\b/u,
};

function criterionReasons(criterion: unknown, metricMap: ReviewMetricMap): string[] {
  const row = object(criterion);
  const reasons: string[] = [];
  const afterVideos = row.afterVideos;
  if (typeof row.metricId !== 'string' || !Object.hasOwn(metricMap, row.metricId)) reasons.push(`successCriterion.metricId không có trong allowlist: ${String(row.metricId ?? '')}`);
  if (row.comparator !== '>=' && row.comparator !== '<=') reasons.push('successCriterion.comparator không hợp lệ.');
  if (typeof row.value !== 'number' || !Number.isFinite(row.value)) reasons.push('successCriterion.value phải là số hữu hạn.');
  if (typeof afterVideos !== 'number' || !Number.isInteger(afterVideos) || afterVideos < 1 || afterVideos > 60) reasons.push('successCriterion.afterVideos phải từ 1 đến 60.');
  return reasons;
}

function inspectClaim(input: {
  path: string; value: JsonRecord; metricIds: unknown; textFields: string[]; metricMap: ReviewMetricMap;
  packet: JsonRecord; verdict: string; allowStopReason?: boolean; extraNumbers?: number[];
}): string[] {
  const reasons: string[] = [];
  const ids = strings(input.metricIds);
  for (const id of ids) if (!Object.hasOwn(input.metricMap, id)) reasons.push(`metricId không có trong allowlist: ${id}`);
  if (Array.isArray(input.metricIds)) {
    const unknownVideoIds = strings(input.value.videoIds).filter((id) => !collectVideoIds(input.packet).has(id));
    for (const id of unknownVideoIds) reasons.push(`videoId không có trong packet: ${id}`);
  }
  for (const text of input.textFields) {
    const promises = forbiddenPhrases(text, YOUTUBE_REVIEW_FORBIDDEN_PROMISE_LANGUAGE);
    if (promises.length) reasons.push(`có lời hứa hoặc dự đoán kết quả: ${promises.join(', ')}`);
    if (input.verdict !== 'consider_stop' && stopLanguageViolation(text)) reasons.push('khuyến nghị dừng hoặc bỏ kênh trái với verdict xác định.');
    const unsupported = matchesAllowedNumbers(text, ids, input.metricMap, input.packet, input.extraNumbers);
    if (unsupported.length) reasons.push(`số không khớp metric được trích dẫn: ${unsupported.join(', ')}`);
  }
  return [...new Set(reasons)];
}

function addInvalid(output: JsonRecord, invalidItems: YoutubeReviewInvalidItem[], path: string, value: unknown, reasons: string[]) {
  if (reasons.length) invalidItems.push({ path, value: structuredClone(value), reasons: [...new Set(reasons)] });
}

function inspectClaims(output: JsonRecord, field: 'strengths' | 'weaknesses', metricMap: ReviewMetricMap, packet: JsonRecord, verdict: string, invalidItems: YoutubeReviewInvalidItem[], checked: { count: number }) {
  const rows = Array.isArray(output[field]) ? output[field] as unknown[] : [];
  rows.forEach((value, index) => {
    const row = object(value); checked.count += 1;
    addInvalid(output, invalidItems, `${field}[${index}]`, value, inspectClaim({ path: `${field}[${index}]`, value: row, metricIds: row.metricIds, textFields: [String(row.text ?? '')], metricMap, packet, verdict }));
  });
}

export function validateYoutubeReviewGrounding(input: {
  target: 'channel' | 'video' | 'ideas';
  output: unknown;
  packet: JsonRecord;
  metricMap: ReviewMetricMap;
  matureCount: number;
}): YoutubeReviewGroundingResult {
  const output = structuredClone(object(input.output));
  const invalidItems: YoutubeReviewInvalidItem[] = [];
  const checked = { count: 0 };
  const verdict = String(object(input.packet.verdict).verdict ?? '');
  const allMetricIds = Object.keys(input.metricMap);
  if (input.target === 'ideas') {
    const rows = Array.isArray(output.ideas) ? output.ideas as unknown[] : [];
    const existingTitles = [
      ...strings(input.packet.existingVideoTitles),
      ...(Array.isArray(input.packet.videos) ? (input.packet.videos as unknown[]).map((row) => String(object(row).title ?? '')) : []),
      ...(typeof object(input.packet.video).title === 'string' ? [object(input.packet.video).title as string] : []),
    ];
    rows.forEach((value, index) => {
      checked.count += 1;
      const row = object(value); const basedOn = object(row.basedOn);
      const ids = strings(basedOn.metricIds);
      const reasons = inspectClaim({ path: `ideas[${index}]`, value: { videoIds: basedOn.videoIds }, metricIds: ids, textFields: [String(row.title ?? ''), String(row.angle ?? ''), String(row.hypothesis ?? ''), String(row.risk ?? '')], metricMap: input.metricMap, packet: input.packet, verdict, extraNumbers: [Number(object(row.successCriterion).afterVideos)] });
      for (const id of strings(basedOn.videoIds)) if (!collectVideoIds(input.packet).has(id)) reasons.push(`basedOn.videoIds không có trong packet: ${id}`);
      const ranks = Array.isArray(basedOn.searchTermRanks) ? basedOn.searchTermRanks as unknown[] : [];
      const availableRanks = collectSearchRanks(input.packet);
      if (ranks.length === 0 && ids.length === 0 && strings(basedOn.videoIds).length === 0) reasons.push('basedOn phải tham chiếu ít nhất một metricId, videoId hoặc searchTermRank.');
      for (const rank of ranks) if (typeof rank !== 'number' || !availableRanks.has(rank)) reasons.push(`searchTermRank không có trong packet: ${String(rank)}`);
      const duplicate = titleIsDuplicate(String(row.title ?? ''), existingTitles);
      if (duplicate) reasons.push('duplicate title trùng hoặc quá giống tiêu đề đã có.');
      const ideaText = normalizeVietnamese([row.title, row.angle, row.hypothesis].filter((value): value is string => typeof value === 'string').join(' '));
      const changed = Object.entries(VARIABLE_TERMS).filter(([, pattern]) => pattern.test(ideaText)).map(([variable]) => variable);
      const declared = String(row.changedVariable ?? '');
      if (changed.some((variable) => variable !== declared)) reasons.push(`ý tưởng thay đổi nhiều biến: ${[declared, ...changed].filter(Boolean).join(', ')}`);
      reasons.push(...criterionReasons(row.successCriterion, input.metricMap));
      addInvalid(output, invalidItems, `ideas[${index}]`, value, reasons);
    });
    return { output, invalidItems, checked: checked.count };
  }

  const summary = String(output.summary ?? '');
  checked.count += 1;
  const summaryReasons = inspectClaim({ path: 'summary', value: {}, metricIds: allMetricIds, textFields: [summary], metricMap: input.metricMap, packet: input.packet, verdict });
  if (verdict === 'consider_stop') {
    const reasons = Array.isArray(object(input.packet.verdict).reasons)
      ? (object(input.packet.verdict).reasons as unknown[]).flatMap((reason) => typeof reason === 'string' ? [reason] : typeof object(reason).text === 'string' ? [object(reason).text as string] : [])
      : [];
    if (!reasons.some((reason) => reason && summary.includes(reason))) summaryReasons.push('summary phải mang nguyên văn ít nhất một lý do của verdict consider_stop.');
    if (/(?:khong nen dung|khong dung|tiep tuc kenh|tiep tuc ngach|nen tiep tuc)/u.test(normalizeVietnamese(summary))) summaryReasons.push('summary phủ nhận hoặc làm nhẹ verdict consider_stop.');
  }
  addInvalid(output, invalidItems, 'summary', summary, summaryReasons);

  inspectClaims(output, 'strengths', input.metricMap, input.packet, verdict, invalidItems, checked);
  inspectClaims(output, 'weaknesses', input.metricMap, input.packet, verdict, invalidItems, checked);

  if (input.target === 'channel') {
    const diagnosis = object(output.diagnosis); checked.count += 1;
    const reasoning = String(diagnosis.reasoning ?? '');
    const reasons = inspectClaim({ path: 'diagnosis', value: diagnosis, metricIds: diagnosis.metricIds, textFields: [reasoning], metricMap: input.metricMap, packet: input.packet, verdict, extraNumbers: [15, input.matureCount] });
    if (input.matureCount < 15 && diagnosis.classification === 'niche') reasons.push(`classification niche chưa được hỗ trợ dưới 15 video trưởng thành (hiện ${input.matureCount}).`);
    addInvalid(output, invalidItems, 'diagnosis', diagnosis, reasons);
    if (input.matureCount < 15 && diagnosis.classification === 'niche') {
      diagnosis.classification = 'unclear';
      diagnosis.reasoning = `${reasoning.trim()} Chưa đủ 15 video trưởng thành để kết luận ngách.`.trim();
      output.diagnosis = diagnosis;
    }
    const actions = Array.isArray(output.actionPlan) ? output.actionPlan as unknown[] : [];
    actions.forEach((value, index) => {
      checked.count += 1;
      const row = object(value);
      const ids = strings(row.metricIds);
      const reasons = inspectClaim({ path: `actionPlan[${index}]`, value: row, metricIds: ids, textFields: [String(row.step ?? ''), String(row.why ?? '')], metricMap: input.metricMap, packet: input.packet, verdict, extraNumbers: [Number(object(row.successCriterion).afterVideos)] });
      reasons.push(...criterionReasons(row.successCriterion, input.metricMap));
      addInvalid(output, invalidItems, `actionPlan[${index}]`, value, reasons);
    });
  } else {
    const packetDrops = Array.isArray(object(input.packet.retention).drops) ? object(input.packet.retention).drops as JsonRecord[] : [];
    const mappingQuality = String(object(input.packet.retention).mappingQuality ?? 'none');
    const findings = Array.isArray(output.retentionFindings) ? output.retentionFindings as unknown[] : [];
    findings.forEach((value, index) => {
      checked.count += 1;
      const row = object(value);
      const matching = packetDrops.find((drop) => Math.round(Number(drop.fromSec)) === Math.round(Number(row.fromSec)) && Math.round(Number(drop.toSec)) === Math.round(Number(row.toSec)));
      const reasons: string[] = [];
      if (!matching) reasons.push('retention interval không trùng một đoạn giảm trong packet.');
      if (mappingQuality === 'none' && strings(row.sceneIndexes).length) reasons.push('mappingQuality none không cho phép gán sceneIndexes.');
      if (matching) {
        const allowed = new Set<number>(Array.isArray(matching.sceneIndexes) ? matching.sceneIndexes : []);
        for (const sceneIndex of Array.isArray(row.sceneIndexes) ? row.sceneIndexes : []) if (!allowed.has(sceneIndex)) reasons.push(`sceneIndexes chứa cảnh không ánh xạ: ${String(sceneIndex)}`);
      }
      const allowedMetric = { value: Number(matching?.dropPercent ?? 0), unit: 'percent', label: 'retention drop' };
      const matchingBounds = matching ? [Math.round(Number(matching.fromSec)), Math.round(Number(matching.toSec))] : [];
      const unsupported = extractNumberTokens(`${String(row.observation ?? '')} ${String(row.suggestion ?? '')}`).filter((token) => {
        if (token.time && matching && matchingBounds.includes(Math.round(token.value))) return false;
        if (matching && matchingBounds.includes(Math.round(token.value)) && /(?:giay|seconds?|secs?)/u.test(normalizeVietnamese(`${token.before} ${token.after}`))) return false;
        if (/canh|scene/u.test(normalizeVietnamese(`${token.before} ${token.after}`)) && matching && (matching.sceneIndexes as number[]).includes(token.value)) return false;
        if (matching && tokenMatchesMetric(token, allowedMetric)) return false;
        return !matchesAllowedNumbers(token.raw, allMetricIds, input.metricMap, input.packet).length;
      }).map((token) => token.raw);
      if (unsupported.length) reasons.push(`số trong retention finding không có trong đoạn được ánh xạ: ${[...new Set(unsupported)].join(', ')}`);
      addInvalid(output, invalidItems, `retentionFindings[${index}]`, value, reasons);
    });
    const searchRows = Array.isArray(output.searchFindings) ? output.searchFindings as unknown[] : [];
    const availableRanks = collectSearchRanks(input.packet);
    searchRows.forEach((value, index) => {
      checked.count += 1;
      const row = object(value); const reasons: string[] = [];
      if (!availableRanks.has(Number(row.rank))) reasons.push(`search rank không có trong packet: ${String(row.rank)}`);
      const ids = strings(row.metricIds);
      if (!ids.some((id) => id.includes(':search:') || id.startsWith('search:') || id.includes('search_'))) reasons.push('search finding phải trích metric id thuộc search terms.');
      reasons.push(...inspectClaim({ path: `searchFindings[${index}]`, value: row, metricIds: ids, textFields: [String(row.observation ?? '')], metricMap: input.metricMap, packet: input.packet, verdict }));
      addInvalid(output, invalidItems, `searchFindings[${index}]`, value, reasons);
    });
    const next = object(output.nextChange); checked.count += 1;
    const nextReasons = inspectClaim({ path: 'nextChange', value: next, metricIds: next.metricIds, textFields: [String(next.why ?? '')], metricMap: input.metricMap, packet: input.packet, verdict, extraNumbers: [Number(object(next.successCriterion).afterVideos)] });
    nextReasons.push(...criterionReasons(next.successCriterion, input.metricMap));
    addInvalid(output, invalidItems, 'nextChange', next, nextReasons);
  }

  const limits = Array.isArray(output.limits) ? output.limits as unknown[] : [];
  limits.forEach((value, index) => {
    checked.count += 1;
    const text = String(value ?? '');
    const reasons: string[] = [];
    if (forbiddenPhrases(text, YOUTUBE_REVIEW_FORBIDDEN_PROMISE_LANGUAGE).length) reasons.push('limit chứa lời hứa hoặc dự đoán kết quả.');
    const unsupported = matchesAllowedNumbers(text, allMetricIds, input.metricMap, input.packet);
    if (unsupported.length) reasons.push(`số không có metric hỗ trợ: ${unsupported.join(', ')}`);
    addInvalid(output, invalidItems, `limits[${index}]`, value, reasons);
  });
  return { output, invalidItems, checked: checked.count };
}
