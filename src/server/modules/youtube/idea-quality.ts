import {
  YoutubeIdeaV2Schema,
  type YoutubeIdeaDropped,
  type YoutubeIdeaV2,
} from '../../../contracts/youtube-ideas';
import { findDuplicateTitle } from '../../../contracts/seo-duplicates';

export type YoutubeIdeaStage = 'seeds' | 'select' | 'expand';

export const YOUTUBE_IDEA_MORAL_LABELS = ['phản bội', 'bán nước', 'hèn nhát', 'thiên tài', 'kẻ tội đồ'] as const;
export const YOUTUBE_IDEA_OBSCURITY_STEERING_KEYWORDS = ['ít người biết', 'ít ai biết', 'hiếm', 'chưa nhiều người'] as const;

// Heuristic editorial list; edit this array when the requested history region changes.
export const YOUTUBE_IDEA_AVOID_LISTS = {
  vietnameseHistory: ['Trần Hưng Đạo', 'Ngô Quyền', 'Lê Lợi', 'Quang Trung', 'Hồ Quý Ly', 'Mạc Đăng Dung', 'Lê Chiêu Thống', 'Phan Thanh Giản', 'Hai Bà Trưng', 'Bạch Đằng'],
} as const;

const SEED_KEYS = ['id', 'episode', 'yearOrPeriod', 'place', 'hunterArchetype', 'domain', 'famousnessGuess'];
const SELECTED_KEYS = ['id', 'trapSketch'];
const REJECTED_KEYS = ['id', 'rejectionReason'];
const IDEA_KEYS = [
  'id', 'episode', 'period', 'place', 'hunterArchetype', 'famousnessGuess', 'famousnessFallback', 'angle', 'title', 'hook', 'brief',
  'presetId', 'motif', 'trap', 'trapSketch', 'whyForThisChannel', 'testVariable', 'successCriterion', 'claims', 'risks', 'rarityGuess',
  'evidenceTier', 'suggestedDurationSec', 'suggestedChapterCount', 'scores',
];
const ENUM_KEYS = new Set(['hunterArchetype', 'famousnessGuess', 'evidence', 'confidence', 'presetId', 'testVariable', 'evidenceTier', 'rarityGuess']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function trimAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const prefix = value.slice(0, max + 1);
  const boundary = prefix.lastIndexOf(' ');
  return (boundary >= Math.floor(max * 0.6) ? prefix.slice(0, boundary) : value.slice(0, max)).trimEnd();
}

function allowKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)));
}

function normalizedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = allowKeys(value, keys);
  for (const [key, child] of Object.entries(row)) {
    if (ENUM_KEYS.has(key)) row[key] = typeof child === 'string' ? child.toLocaleLowerCase('en-US') : child;
  }
  return row;
}

function normalizeIdea(value: unknown): Record<string, unknown> {
  const row = normalizedRecord(value, IDEA_KEYS);
  if (typeof row.whyForThisChannel === 'string') row.whyForThisChannel = trimAtWord(row.whyForThisChannel, 300);
  if (Array.isArray(row.risks)) row.risks = row.risks.map((risk) => typeof risk === 'string' ? trimAtWord(risk, 300) : risk);
  else if (typeof row.risks === 'string') row.risks = [trimAtWord(row.risks, 300)];
  if (isRecord(row.claims)) row.claims = [row.claims];
  if (Array.isArray(row.claims)) row.claims = row.claims.map((claim) => {
    const normalized = normalizedRecord(claim, ['text', 'confidence']);
    if (typeof normalized.text === 'string') normalized.text = trimAtWord(normalized.text, 160);
    return normalized;
  });
  if (isRecord(row.motif)) {
    row.motif = Object.fromEntries(Object.entries(row.motif).filter(([key]) => ['hunter', 'perfectPlan', 'blindSpot', 'selfDestruction'].includes(key)).map(([key, link]) => [
      key,
      normalizedRecord(link, ['text', 'evidence']),
    ]));
  }
  if (isRecord(row.trap)) row.trap = normalizedRecord(row.trap, ['hunterBelief', 'outsideVariable', 'exploitedBy', 'advantageThatBackfired']);
  if (isRecord(row.successCriterion)) row.successCriterion = normalizedRecord(row.successCriterion, ['description', 'afterVideos']);
  if (isRecord(row.scores)) row.scores = normalizedRecord(row.scores, ['fit', 'clarity', 'riskOfThinSources']);
  return row;
}

export function normalizeYoutubeIdeaStageOutput(stage: YoutubeIdeaStage, value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (stage === 'seeds') {
    const rows = Array.isArray(value.seeds) ? value.seeds : isRecord(value.seeds) ? [value.seeds] : 'id' in value ? [value] : [];
    return 'seeds' in value || 'id' in value ? { seeds: rows.map((row) => normalizedRecord(row, SEED_KEYS)) } : {};
  }
  if (stage === 'select') {
    const selected = Array.isArray(value.selected) ? value.selected : isRecord(value.selected) ? [value.selected] : [];
    const rejected = Array.isArray(value.rejected) ? value.rejected : isRecord(value.rejected) ? [value.rejected] : [];
    return {
      ...('selected' in value ? { selected: selected.map((row) => normalizedRecord(row, SELECTED_KEYS)) } : 'id' in value ? { selected: [normalizedRecord(value, SELECTED_KEYS)] } : {}),
      ...('rejected' in value ? { rejected: rejected.map((row) => normalizedRecord(row, REJECTED_KEYS)) } : {}),
    };
  }
  const rows = Array.isArray(value.ideas) ? value.ideas : isRecord(value.ideas) ? [value.ideas] : 'id' in value ? [value] : [];
  return 'ideas' in value || 'id' in value ? { ideas: rows.map(normalizeIdea) } : {};
}

function normalizeVietnamese(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').toLocaleLowerCase('vi-VN');
}

function extractNumbers(value: string): string[] {
  return [...value.matchAll(/(?<![\p{L}\p{N}])(\d[\d.,]*\d|\d)(?![\p{L}\p{N}])/gu)]
    .map((match) => (match[1] ?? '').replace(/[.,]/gu, '')).filter(Boolean);
}

const SENTENCE_START_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'because', 'when', 'while', 'after', 'before', 'người', 'khi', 'nếu', 'một', 'đây', 'đó', 'chính', 'sau', 'trước', 'kế', 'câu', 'cuộc', 'năm', 'nhà', 'vua', 'chúa', 'tướng', 'chỉ', 'đội', 'quân', 'triều', 'nhưng', 'vì', 'tuy', 'dù', 'ông', 'bà', 'họ', 'từ', 'trong', 'đến', 'lúc', 'bên', 'tuyến', 'tập'].map(normalizeVietnamese));
const COMMON_CLAIM_SENTENCE_OPENERS = new Set([
  ...SENTENCE_START_WORDS,
  ...['therefore', 'however', 'vậy', 'biến', 'vấn', 'điều', 'phần', 'sức', 'phía', 'như', 'theo', 'mặc', 'dẫu', 'dường', 'thực', 'có', 'cũng', 'đồng', 'ngoài', 'mọi', 'tính', 'trên', 'dưới', 'nội', 'tại'].map(normalizeVietnamese),
]);

function extractCapitalizedTerms(value: string): string[] {
  const result: string[] = [];
  const matches = [...value.matchAll(/[\p{Lu}][\p{L}\p{M}'’.-]*/gu)];
  const groups: Array<{ words: string[]; start: number; end: number }> = [];
  for (const match of matches) {
    const raw = match[0].replace(/^[.'’]+|[.'’]+$/gu, '');
    if (!raw || /^(?:i|v|x|l|c|d|m)+$/iu.test(raw)) continue;
    const start = match.index ?? 0;
    const previous = groups.at(-1);
    const between = previous ? value.slice(previous.end, start) : '';
    if (previous && /^\s+$/u.test(between)) {
      previous.words.push(raw);
      previous.end = start + raw.length;
    } else groups.push({ words: [raw], start, end: start + raw.length });
  }
  for (const group of groups) {
    const before = value.slice(0, group.start);
    const sentenceStart = !before.trim() || /[.!?。！？]\s*$/u.test(before);
    const words = sentenceStart && COMMON_CLAIM_SENTENCE_OPENERS.has(normalizeVietnamese(group.words[0] ?? ''))
      ? group.words.slice(1)
      : group.words;
    if (words.length) result.push(normalizeVietnamese(words.join(' ')));
  }
  return result;
}

function meaningfulWords(value: string): Set<string> {
  return new Set(normalizeVietnamese(value).match(/[\p{L}]{4,}/gu)?.filter((word) => !SENTENCE_START_WORDS.has(word)) ?? []);
}

function hasSharedMeaning(left: string, right: string): boolean {
  const leftWords = meaningfulWords(left);
  if ([...meaningfulWords(right)].some((word) => leftWords.has(word))) return true;
  const leftEntities = entitySignatures(left);
  const rightEntities = entitySignatures(right);
  return [...leftEntities].some((name) => [...rightEntities].some((other) => {
    if (name === other || name.startsWith(`${other} `) || other.startsWith(`${name} `)) return true;
    const nameWords = name.split(' ');
    const otherWords = other.split(' ');
    if (nameWords.length >= 2 && otherWords.length >= 2) {
      const smaller = nameWords.length <= otherWords.length ? nameWords : otherWords;
      const larger = new Set(nameWords.length <= otherWords.length ? otherWords : nameWords);
      if (smaller.length >= 2 && smaller.every((word) => larger.has(word))) return true;
    }
    return false;
  }));
}

const VI_DECISION_ACTIONS = [
  'chap nhan', 'nhan gap', 'quyet dinh', 'chon', 'doi ke hoach', 'doi tuyen', 'doi huong', 'doi luat', 'doi moi', 'rut lui', 'giu lai', 'giu trong tam', 'tu choi', 'yeu cau', 'de nghi',
];
const VI_MILITARY_ACTIONS = [
  'tan cong', 'tien cong', 'tien quan', 'tien sau', 'dem quan', 'danh tran', 'danh bai', 'danh chiem', 'danh vao', 'dan quan vao', 'dan quan', 'dieu quan', 'chuyen quan', 'cat tuyen', 'cat duong', 'co thu', 'do bo', 'vuot song', 'bat giu', 'dau hang', 'bao vay', 'pha vay', 'chiem', 'sat hai', 'giet', 'chan', 'tru tuong', 'xu tuong', 'xay', 'dung dai don', 'chuan bi khoi nghia', 'cho quan nghi ngoi',
];
const VI_DIPLOMATIC_ACTIONS = [
  'ket thong gia', 'ky ket', 'ky hiep uoc', 'ky thoa thuan', 'ky hoa uoc', 'dam phan', 'lien minh', 'cau phong', 'gui toi hau thu', 'thuong luong', 'tuyen bo', 'gui', 'cu',
];
const VI_GOVERNANCE_ACTIONS = [
  'ra lenh', 'ky lenh', 'ban hanh', 'ban lenh', 'cai cach', 'thanh lap', 'lap', 'tu bo', 'phat dong', 'phe tru', 'bon nhiem', 'dinh chi', 'bai chuc', 'ap dat', 'bai bo', 'bo qua', 'bo nguoi thua ke', 'chon ke vi', 'tap trung', 'cung co', 'xoa bo', 'thu hep', 'doi nguoi noi ngoi', 'giu can bang', 'nhan dieu tran', 'giu nguyen', 'keo dai', 'mo chien dich', 'mo truong', 'mo rong',
];
const VI_ECONOMIC_TECHNICAL_ACTIONS = [
  'chia dat', 'siet thue', 'thu gom', 'tu che', 'che tao', 'sao chep', 'han che', 'don thuong nhan', 'ban thue', 'dat bay', 'dat cuoc', 'dat ra', 'thu xep', 'mo tuyen', 'nhan khai thac', 'cho phep khai thac', 'thu thue', 'nhan ganh no', 'doi lay', 'mua', 'ban', 'cam', 'trien khai', 'bao dong', 'nhan chau lam con nuoi', 'phan doi', 'doi dau', 'gianh quyen', 'dung tai',
];
const ENGLISH_ACTIONS = [
  'withdraw', 'withdrew', 'ordered', 'order', 'signed', 'sign', 'invaded', 'invade', 'attacked', 'attack', 'built', 'build', 'reformed', 'reform', 'chose', 'choose', 'declared', 'declare', 'allied', 'besieged', 'redirected', 'extended', 'blocked', 'advanced',
  'sent', 'send', 'accepted', 'accept', 'agreed', 'agree', 'met', 'meet', 'issued', 'issue', 'appointed', 'appoint', 'removed', 'remove', 'assassinated', 'assassinate', 'executed', 'execute', 'conquered', 'conquer', 'mobilized', 'mobilize', 'seized', 'seize', 'occupied', 'occupy', 'rejected', 'reject', 'proposed', 'propose', 'negotiated', 'negotiate', 'surrendered', 'surrender', 'launched', 'launch', 'expanded', 'expand', 'imposed', 'impose', 'banned', 'ban', 'adopted', 'adopt', 'introduced', 'introduce', 'deployed', 'deploy', 'crossed', 'cross', 'landed', 'land', 'overthrew', 'overthrow',
];
const EPISODE_ACTION_PHRASES = [...VI_DECISION_ACTIONS, ...VI_MILITARY_ACTIONS, ...VI_DIPLOMATIC_ACTIONS, ...VI_GOVERNANCE_ACTIONS, ...VI_ECONOMIC_TECHNICAL_ACTIONS, ...ENGLISH_ACTIONS];

export function youtubeIdeaEpisodeHasDecision(episode: string): boolean {
  const normalized = normalizeVietnamese(episode);
  const actionMatches = EPISODE_ACTION_PHRASES.flatMap((action) => {
    const match = new RegExp(`(^|[^a-z])${action.replace(/ /gu, '\\s+')}([^a-z]|$)`, 'u').exec(normalized);
    return match ? [{ start: match.index + match[1]!.length }] : [];
  });
  if (!actionMatches.length) return false;

  // An intended action after “tin vào ... để” is part of the belief, not evidence
  // that the seed names an event. A later action in a new clause still counts.
  const beliefIndex = normalized.search(/\b(?:tin vao|niem tin)\b/u);
  if (beliefIndex < 0) return true;
  return actionMatches.some(({ start }) => {
    if (start <= beliefIndex) return true;
    const priorClause = normalized.slice(beliefIndex, start).split(/[,;.!?]/u).at(-1) ?? '';
    return !/\b(?:de|nham)\b/u.test(priorClause);
  });
}

export function youtubeIdeaCenturyBucket(period: string): number | null {
  const vietnameseUnits: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9 };
  const normalized = normalizeVietnamese(period);
  const isBce = /(?:^|[^a-z])(?:b\.?c\.?e?\.?|t\.?c\.?n\.?)(?:$|[^a-z])/u.test(normalized)
    || /(?:truoc\s+(?:cong\s+)?nguyen|before\s+(?:christ|common\s+era))/u.test(normalized);
  const numericCentury = normalized.match(/(?:the ky|century|c\.)\s*(?:thu\s*)?(\d{1,2})(?:st|nd|rd|th)?\b/u)?.[1]
    ?? normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/u)?.[1];
  if (numericCentury) {
    const century = Number(numericCentury);
    return century ? (isBce ? -century : century) : null;
  }
  const centuryWords = normalized.match(/(?:the ky|century)(?:\s+thu)?\s+(muoi(?:\s+(?:mot|hai|ba|bon|tu|nam|sau|bay|tam|chin))?|hai\s+muoi(?:\s+(?:mot|hai|ba|bon|tu|nam|sau|bay|tam|chin))?)/u)?.[1];
  if (centuryWords) {
    const words = centuryWords.split(/\s+/u);
    const century = words[0] === 'muoi' ? 10 + (words[1] ? vietnameseUnits[words[1]] ?? 0 : 0) : 20 + (words[2] ? vietnameseUnits[words[2]] ?? 0 : 0);
    return isBce ? -century : century;
  }
  const roman = normalized.match(/(?:the ky|century|c\.)\s*([ivxlcdm]+)/u)?.[1]
    ?? normalized.match(/\b([ivxlcdm]+)(?:st|nd|rd|th)?\s+century\b/u)?.[1];
  if (roman) {
    const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
    let total = 0;
    let previous = 0;
    for (const char of [...roman].reverse()) {
      const current = values[char] ?? 0;
      total += current < previous ? -current : current;
      previous = current;
    }
    return total ? (isBce ? -total : total) : null;
  }
  const year = normalized.match(/(?<!\d)(-?\d{1,4})(?!\d)/u)?.[1];
  if (!year) return null;
  const number = Math.abs(Number(year));
  if (!number) return null;
  const century = Math.floor((number - 1) / 100) + 1;
  return isBce || Number(year) < 0 ? -century : century;
}

function evidenceYears(value: string): number[] {
  return extractNumbers(value).map(Number).filter((year) => Number.isInteger(year) && year >= 100 && year <= 2999);
}

function numericPeriodReferences(period: string): string[] {
  return extractNumbers(period);
}

function periodNumberIsSupported(number: string, expandedPeriod: string, evidence: string): boolean {
  if (extractNumbers(evidence).includes(number)) return true;
  const normalizedPeriod = normalizeVietnamese(expandedPeriod);
  const decadeMatch = normalizedPeriod.match(new RegExp(`(?:thap nien|decade)\\s+${number}(?:s)?\\b`, 'u'));
  if (!decadeMatch || Number(number) % 10 !== 0) return false;
  const decade = Number(number);
  return evidenceYears(evidence).some((year) => year >= decade && year < decade + 10);
}

export function isYoutubeIdeaPeriodRefinement(seedPeriod: string, expandedPeriod: string, evidence: string): boolean {
  const seed = normalizeVietnamese(seedPeriod).replace(/\s+/gu, ' ').trim();
  const expanded = normalizeVietnamese(expandedPeriod).replace(/\s+/gu, ' ').trim();
  if (seed === expanded) return true;
  const addedNumbers = numericPeriodReferences(expandedPeriod).filter((number) => !numericPeriodReferences(seedPeriod).includes(number));
  if (addedNumbers.some((number) => !periodNumberIsSupported(number, expandedPeriod, evidence))) return false;
  if (expanded.includes(seed)) return true;

  const relativeLateCentury = /cuoi the ky truoc/u.test(seed)
    && /cuoi thap nien 19\d0/u.test(expanded)
    && evidenceYears(evidence).some((year) => year >= 1990 && year <= 1999);
  if (relativeLateCentury) return true;

  const seedCentury = youtubeIdeaCenturyBucket(seedPeriod);
  const expandedCentury = youtubeIdeaCenturyBucket(expandedPeriod);
  return seedCentury !== null && seedCentury === expandedCentury && addedNumbers.length > 0;
}

function entitySignatures(episode: string): Set<string> {
  const groups: string[] = [];
  let current: string[] = [];
  let previousEnd = -1;
  for (const match of episode.matchAll(/[\p{Lu}][\p{L}\p{M}'’.-]*/gu)) {
    const word = normalizeVietnamese(match[0]);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = episode.slice(0, start);
    const sentenceStart = !before.trim() || /[.!?。！？]\s*$/u.test(before);
    if (sentenceStart && SENTENCE_START_WORDS.has(word)) continue;
    const between = previousEnd < 0 ? '' : episode.slice(previousEnd, start);
    if (current.length && /^\s+$/u.test(between)) current.push(word);
    else {
      if (current.length) groups.push(current.join(' '));
      current = [word];
    }
    previousEnd = end;
  }
  if (current.length) groups.push(current.join(' '));
  return new Set(groups.filter((value) => value.length > 1));
}

function hasPersonOverlap(left: string, right: string): boolean {
  const a = entitySignatures(left);
  const b = entitySignatures(right);
  return [...a].some((name) => [...b].some((other) => name === other || name.startsWith(`${other} `) || other.startsWith(`${name} `)));
}

const HUNTER_STRENGTH_WORDS = ['the manh', 'quy mo', 'quan so', 'uu the', 'suc manh', 'ky binh', 'bo binh', 'hai quan', 'ky luat', 'ky thuat', 'mang luoi', 'nguon luc', 'thong tin', 'toc do', 'cai cach', 'quyen luc', 'hau can', 'niem tin', 'uy tin', 'danh chinh', 'kinh nghiem', 'kiem soat', 'cong trinh', 'supply', 'scale', 'strength', 'discipline', 'logistics', 'control', 'reform', 'authority'];
const CAUSAL_WORDS = ['khiến', 'dẫn đến', 'do đó', 'vì vậy', 'bởi vì', 'làm cho', 'because', 'caused', 'led to', 'therefore'];

function includesWholePhrase(value: string, phrase: string): boolean {
  const normalized = value.normalize('NFC').toLocaleLowerCase('vi-VN');
  const escaped = phrase.normalize('NFC').toLocaleLowerCase('vi-VN').replace(/\s+/gu, '\\s+');
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'u').test(normalized);
}

function ideaTextFields(idea: YoutubeIdeaV2): string[] {
  return [
    idea.episode, idea.period, idea.place, idea.title, idea.hook, idea.brief, idea.trapSketch,
    ...Object.values(idea.trap), ...Object.values(idea.motif).map((item) => item.text),
  ];
}

export function auditYoutubeIdeaClaimCoverage(idea: YoutubeIdeaV2, packetJson: string): {
  unbackedNumbers: string[];
  unbackedNames: string[];
  unsupportedCausalStatements: string[];
} {
  const fields = ideaTextFields(idea);
  const claimsText = idea.claims.map((claim) => claim.text).join(' ');
  const packetText = normalizeVietnamese(packetJson);
  const claimText = normalizeVietnamese(claimsText);
  const supportedNumbers = new Set([...extractNumbers(packetJson), ...extractNumbers(claimsText)]);
  const periodCentury = youtubeIdeaCenturyBucket(idea.period);
  const hasSupportedCenturyYear = (number: string) => {
    const period = normalizeVietnamese(idea.period);
    const numericCentury = new RegExp(`(?:the ky|century)\\s*(?:thu\\s*)?${number}(?:st|nd|rd|th)?\\b`, 'u').test(period);
    return numericCentury && periodCentury !== null && evidenceYears(`${packetJson} ${claimsText}`).some((year) => youtubeIdeaCenturyBucket(String(year)) === periodCentury);
  };
  const unbackedNumbers = [...new Set(extractNumbers(fields.join(' ')).filter((number) => !supportedNumbers.has(number) && !hasSupportedCenturyYear(number)))];
  const unbackedNames = [...new Set(fields.flatMap(extractCapitalizedTerms).filter((name) => !packetText.includes(name) && !claimText.includes(name)))];
  const unsupportedCausalStatements: string[] = [];
  for (const sentence of fields.flatMap((field) => field.split(/(?<=[.!?。！？;])\s+/u))) {
    if (sentence.trim().endsWith('?')) continue;
    if (!CAUSAL_WORDS.some((word) => includesWholePhrase(sentence, word))) continue;
    const sentenceWords = meaningfulWords(sentence);
    const overlaps = [...meaningfulWords(claimsText)].filter((word) => sentenceWords.has(word)).length;
    if (overlaps < 2) unsupportedCausalStatements.push(sentence.trim());
  }
  return { unbackedNumbers, unbackedNames, unsupportedCausalStatements };
}

function validateClaims(idea: YoutubeIdeaV2, packetJson: string): string[] {
  const audit = auditYoutubeIdeaClaimCoverage(idea, packetJson);
  const reasons: string[] = [];
  if (audit.unbackedNumbers.length) reasons.push(`số chưa có claim hoặc packet: ${audit.unbackedNumbers.join(', ')}.`);
  if (audit.unbackedNames.length) reasons.push(`tên chưa có claim hoặc packet: ${audit.unbackedNames.slice(0, 8).join(', ')}.`);
  if (audit.unsupportedCausalStatements.length) reasons.push('mệnh đề nhân quả chưa có claim tương ứng.');
  return reasons;
}

function quoteExceptionIsClaimed(title: string, label: string, idea: YoutubeIdeaV2): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const quoted = new RegExp(`[“\"'‘]\\s*${escaped}\\s*[”\"'’]`, 'iu').test(title);
  const normalizedClaims = normalizeVietnamese(idea.claims.map((claim) => claim.text).join(' '));
  return quoted && normalizedClaims.includes(normalizeVietnamese(label)) && /(nhan|cach goi|ten goi|duong thoi|duoc goi|label|called)/u.test(normalizedClaims);
}

export function validateYoutubeIdeaV2(value: unknown, packet: { evidenceTier: string; packet: Record<string, unknown>; serialized: string }): { idea: YoutubeIdeaV2 | null; reasons: string[] } {
  const parsed = YoutubeIdeaV2Schema.safeParse(value);
  if (!parsed.success) return { idea: null, reasons: [`schema: ${parsed.error.issues.slice(0, 4).map((issue) => issue.path.join('.') || issue.message).join(', ')}`] };
  const idea = parsed.data;
  const reasons: string[] = [];
  if (idea.evidenceTier !== packet.evidenceTier) reasons.push('bậc chứng cứ của ý tưởng không khớp với gói dữ liệu.');
  if (!youtubeIdeaEpisodeHasDecision(idea.episode)) reasons.push('chưa phải một tập sự kiện có quyết định cụ thể.');
  if (idea.testVariable !== 'topic') reasons.push('biến thử nghiệm phải là topic.');
  if (idea.presetId === 'hubris-trap') {
    if (idea.motif.blindSpot.evidence === 'thin') reasons.push('blind spot mỏng.');
    if (idea.motif.perfectPlan.evidence === 'thin' && idea.motif.selfDestruction.evidence === 'thin') reasons.push('thiếu mắt xích bẫy đủ rõ.');
    if (!hasSharedMeaning(idea.trap.hunterBelief, idea.motif.hunter.text)
      || !hasSharedMeaning(idea.trap.outsideVariable, idea.motif.blindSpot.text)
      || !hasSharedMeaning(idea.trap.exploitedBy, `${idea.motif.blindSpot.text} ${idea.motif.selfDestruction.text}`)
      || !hasSharedMeaning(idea.trap.advantageThatBackfired, idea.motif.selfDestruction.text)) {
      reasons.push('bốn dòng bẫy chưa nhất quán với các mắt xích motif.');
    }
    const advantage = normalizeVietnamese(idea.trap.advantageThatBackfired);
    const strengthNamed = HUNTER_STRENGTH_WORDS.some((word) => advantage.includes(normalizeVietnamese(word)))
      || hasSharedMeaning(idea.trap.advantageThatBackfired, idea.motif.hunter.text)
      || hasSharedMeaning(idea.trap.advantageThatBackfired, idea.motif.perfectPlan.text);
    if (!strengthNamed) {
      reasons.push('không phải bẫy tự giăng: lợi thế của người đi săn không tự phản tác dụng.');
    }
    for (const label of YOUTUBE_IDEA_MORAL_LABELS) {
      if (normalizeVietnamese(idea.title).includes(normalizeVietnamese(label)) && !quoteExceptionIsClaimed(idea.title, label, idea)) {
        reasons.push(`nhãn đạo đức không được dùng làm tuyên bố chính: ${label}.`);
        break;
      }
    }
  }
  if (idea.claims.length > 0 && idea.claims.filter((claim) => claim.confidence === 'low').length > idea.claims.length / 2) {
    reasons.push('quá dựa vào trí nhớ: quá nửa claim có độ tin cậy thấp.');
  }
  reasons.push(...validateClaims(idea, packet.serialized));
  return { idea: reasons.length ? null : idea, reasons };
}

export type YoutubeIdeaSeed = {
  id: string;
  episode: string;
  yearOrPeriod: string;
  place: string;
  hunterArchetype: YoutubeIdeaV2['hunterArchetype'];
  domain: string;
  famousnessGuess: YoutubeIdeaV2['famousnessGuess'];
};

export function filterYoutubeIdeaSeeds(rows: YoutubeIdeaSeed[], count: number, steering = ''): { seeds: YoutubeIdeaSeed[]; dropped: YoutubeIdeaDropped[] } {
  const seeds: YoutubeIdeaSeed[] = [];
  const dropped: YoutubeIdeaDropped[] = [];
  const archetypeCounts = new Map<string, number>();
  const obscureMode = isObscuritySteering(steering);
  const target = Math.min(12, Math.ceil(count * 2));
  const famous = obscureMode ? rows.filter((row) => row.famousnessGuess === 'famous') : [];
  for (const row of famous) dropped.push({ id: row.id, reason: 'độ nổi tiếng ước đoán là famous theo yêu cầu tìm chủ đề ít nổi tiếng.' });
  const eligibleRows = rows.filter((row) => !obscureMode || row.famousnessGuess !== 'famous');
  const ordinaryRows = eligibleRows.filter((row) => !obscureMode || row.famousnessGuess !== 'known');
  const knownRows = obscureMode ? eligibleRows.filter((row) => row.famousnessGuess === 'known') : [];
  const considered = new Set<string>();
  const considerRows = (candidateRows: YoutubeIdeaSeed[], limit: number) => {
    for (const row of candidateRows) {
      if (seeds.length >= limit) break;
      if (considered.has(row.id)) continue;
      considered.add(row.id);
      let reason: string | null = null;
      if (!youtubeIdeaEpisodeHasDecision(row.episode) || !row.yearOrPeriod.trim()) reason = 'không phải một tập sự kiện có quyết định và thời kỳ.';
      const yearBucket = youtubeIdeaCenturyBucket(row.yearOrPeriod);
      if (!reason && yearBucket !== null && seeds.some((accepted) => accepted.hunterArchetype === row.hunterArchetype && youtubeIdeaCenturyBucket(accepted.yearOrPeriod) === yearBucket)) {
        reason = 'trùng loại bẫy trong cùng thế kỷ.';
      }
      if (!reason && (archetypeCounts.get(row.hunterArchetype) ?? 0) >= 2) reason = 'trùng loại bẫy: đã đủ hai ý tưởng cùng archetype.';
      if (!reason && seeds.filter((accepted) => hasPersonOverlap(accepted.episode, row.episode)).length >= 2) reason = 'trùng nhân vật hoặc chính thể quá hai lần.';
      if (reason) dropped.push({ id: row.id, reason });
      else {
        seeds.push(row);
        archetypeCounts.set(row.hunterArchetype, (archetypeCounts.get(row.hunterArchetype) ?? 0) + 1);
      }
    }
  };
  const ordinaryLimit = obscureMode && knownRows.length ? Math.min(target, count + 1) : target;
  considerRows(ordinaryRows, ordinaryLimit);
  if (obscureMode && seeds.length >= count) considerRows(knownRows, target);
  if (seeds.length < target) considerRows(ordinaryRows, target);
  if (obscureMode && seeds.length < target) considerRows(knownRows, target);
  for (const row of eligibleRows) {
    if (considered.has(row.id) || dropped.some((item) => item.id === row.id)) continue;
    dropped.push({ id: row.id, reason: obscureMode && row.famousnessGuess === 'known'
      ? 'không cần phương án đã biết khi còn đủ ý tưởng ước đoán ít nổi tiếng.'
      : 'vượt số lượng seed sau khi áp dụng đa dạng.' });
  }
  return { seeds, dropped };
}

export function isObscuritySteering(value: string): boolean {
  const normalized = normalizeVietnamese(value);
  return YOUTUBE_IDEA_OBSCURITY_STEERING_KEYWORDS.some((keyword) => normalized.includes(normalizeVietnamese(keyword)));
}

export function selectYoutubeIdeaObscurity<T extends Pick<YoutubeIdeaV2, 'id' | 'famousnessGuess' | 'famousnessFallback'>>(
  rows: T[], count: number, steering: string,
): { ideas: T[]; dropped: YoutubeIdeaDropped[] } {
  if (!isObscuritySteering(steering)) return { ideas: rows.slice(0, count).map((row) => ({ ...row, famousnessFallback: false })), dropped: [] };
  const dropped: YoutubeIdeaDropped[] = [];
  const eligible = rows.filter((row) => {
    if (row.famousnessGuess !== 'famous') return true;
    dropped.push({ id: row.id, reason: 'độ nổi tiếng ước đoán là famous theo yêu cầu tìm chủ đề ít nổi tiếng.' });
    return false;
  });
  const ordinary = eligible.filter((row) => row.famousnessGuess !== 'known').slice(0, count).map((row) => ({ ...row, famousnessFallback: false }));
  const known = eligible.filter((row) => row.famousnessGuess === 'known');
  const needed = Math.max(0, count - ordinary.length);
  const fallback = known.slice(0, needed).map((row) => ({ ...row, famousnessFallback: true }));
  for (const row of known.slice(needed)) dropped.push({ id: row.id, reason: 'không cần dùng dự phòng đã biết khi còn đủ ý tưởng ước đoán ít nổi tiếng.' });
  return { ideas: [...ordinary, ...fallback], dropped };
}

export function trimYoutubeIdeaV2Final(rows: YoutubeIdeaV2[], count: number, steering: string): { ideas: YoutubeIdeaV2[]; dropped: YoutubeIdeaDropped[] } {
  const ranked = [...rows].sort((left, right) => {
    const leftScore = left.scores.fit + left.scores.clarity - left.scores.riskOfThinSources;
    const rightScore = right.scores.fit + right.scores.clarity - right.scores.riskOfThinSources;
    return rightScore - leftScore || left.id.localeCompare(right.id);
  });
  const obscureMode = isObscuritySteering(steering);
  const dropped: YoutubeIdeaDropped[] = [];
  const pool = ranked.filter((row) => {
    if (obscureMode && row.famousnessGuess === 'famous') {
      dropped.push({ id: row.id, reason: 'độ nổi tiếng ước đoán là famous theo yêu cầu tìm chủ đề ít nổi tiếng.' });
      return false;
    }
    return true;
  });
  const selected: YoutubeIdeaV2[] = [];
  const angleKeys = new Set<string>();
  const archetypeCounts = new Map<string, number>();
  const accept = (row: YoutubeIdeaV2, fallback: boolean): boolean => {
    const normalizedAngle = normalizeVietnamese(row.angle).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const rowCentury = youtubeIdeaCenturyBucket(row.period);
    let reason: string | null = null;
    if (findDuplicateTitle(row.title, selected.map((item) => item.title)).length) reason = 'tiêu đề trùng hoặc gần trùng với ý tưởng khác trong lượt chạy.';
    else if (angleKeys.has(normalizedAngle)) reason = 'trùng loại bẫy: góc kể bị lặp.';
    else if ((archetypeCounts.get(row.hunterArchetype) ?? 0) >= 2) reason = 'trùng loại bẫy: đã đủ hai ý tưởng cùng archetype.';
    else if (rowCentury !== null && selected.some((item) => item.hunterArchetype === row.hunterArchetype && youtubeIdeaCenturyBucket(item.period) === rowCentury)) reason = 'trùng loại bẫy trong cùng thế kỷ.';
    else if (selected.filter((item) => hasPersonOverlap(item.episode, row.episode)).length >= 2) reason = 'trùng nhân vật hoặc chính thể quá hai lần.';
    if (reason) {
      dropped.push({ id: row.id, reason });
      return false;
    }
    selected.push({ ...row, famousnessFallback: fallback });
    angleKeys.add(normalizedAngle);
    archetypeCounts.set(row.hunterArchetype, (archetypeCounts.get(row.hunterArchetype) ?? 0) + 1);
    return true;
  };
  if (!obscureMode) {
    for (const row of pool) {
      accept(row, false);
      if (selected.length >= count) break;
    }
  } else {
    for (const row of pool.filter((item) => item.famousnessGuess !== 'known')) {
      accept(row, false);
      if (selected.length >= count) break;
    }
    if (selected.length < count) {
      for (const row of pool.filter((item) => item.famousnessGuess === 'known')) {
        accept(row, true);
        if (selected.length >= count) break;
      }
    }
  }
  const selectedIds = new Set(selected.map((row) => row.id));
  for (const row of pool) if (!selectedIds.has(row.id) && !dropped.some((item) => item.id === row.id)) {
    dropped.push({ id: row.id, reason: obscureMode && row.famousnessGuess === 'known'
      ? 'không cần phương án đã biết khi còn đủ ý tưởng khác.'
      : 'vượt số lượng ý tưởng sau khi xếp điểm và áp dụng đa dạng.' });
  }
  return { ideas: selected, dropped };
}

export function createIdeaAvoidList(steering: string, language: 'vi' | 'en'): readonly string[] {
  if (language === 'vi' && isObscuritySteering(steering) && /việt\s*nam|việt|vietnam/iu.test(steering)) return YOUTUBE_IDEA_AVOID_LISTS.vietnameseHistory;
  return [];
}
