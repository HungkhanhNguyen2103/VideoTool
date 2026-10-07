import type { KeywordKind, RemotionKeyword } from '../../../contracts/video';
import type { FilmLookStyle } from '../../../contracts/project';

export type TimedWord = { text: string; startSec: number; endSec: number };
export type Keyword = RemotionKeyword & { kind: KeywordKind };

export const NUMBER_UNIT_TOKENS = new Set(['tỷ', 'triệu', 'nghìn', 'ngàn', 'trăm', '%', 'đô', 'la', 'usd', 'năm']);
export const MAX_KEYWORDS_PER_SCENE = 2;
export const MIN_KEYWORD_START_SPACING_SEC = 2.5;
export const MIN_KEYWORD_HOLD_SEC = 1.2;
export const KEYWORD_FADE_SEC = 0.3;
export const LOWER_THIRD_HOLD_SEC = 3;
export const LOWER_THIRD_MIN_REMAIN_SEC = 1.5;
/** Lone 4-digit tokens in this range are treated as calendar years. */
export const YEAR_RANGE = { min: 1000, max: 2100 } as const;
/** The first year in a video rolls up from this many years earlier. */
export const FIRST_YEAR_ROLL_SPAN = 10;
/** Timeline padding as a fraction of its span (at least one year each side). */
export const TIMELINE_PAD_RATIO = 0.05;
export const FILM_LOOK_BEFORE_YEAR = 1990;

const clean = (text: string) => text.replace(/[\p{P}]+$/gu, (suffix) => suffix.replace(/[^%]/gu, ''));
const isCapitalized = (text: string) => /^\p{Lu}/u.test(text);
const isSentenceStart = (words: ReadonlyArray<TimedWord>, index: number) =>
  index === 0 || /[.!?]["'”’)]*$/u.test(words[index - 1]?.text ?? '');

type Candidate = {
  text: string;
  startSec: number;
  phraseEndSec: number;
  priority: number;
  kind: KeywordKind;
  nameRole?: 'person' | 'place';
  subtitle?: string;
};

export const ROLE_PHRASES = [
  'kỹ sư', 'ông', 'bà', 'giám đốc', 'tổng giám đốc', 'chủ tịch', 'tổng thống', 'thủ tướng',
  'tướng', 'đại tướng', 'vua', 'hoàng đế', 'nhà khoa học', 'nhà sáng lập', 'nhà phát minh', 'người sáng lập',
].sort((a, b) => b.split(' ').length - a.split(' ').length);
const LOCATIVE_PHRASES = ['ở', 'tại', 'từ', 'đến', 'sang', 'thành phố', 'bang', 'tỉnh', 'thủ đô']
  .sort((a, b) => b.split(' ').length - a.split(' ').length);
const GEOGRAPHY_NAME_PREFIXES = [
  'sông', 'núi', 'biển', 'hồ', 'đảo', 'vịnh', 'đèo', 'cửa', 'cầu', 'bến', 'rạch', 'kênh',
  'thành phố', 'thành', 'tỉnh', 'huyện', 'xã', 'làng', 'đồng bằng', 'cao nguyên', 'bán đảo', 'quần đảo', 'eo biển',
];
const EVENT_OR_POLITY_NAME_PREFIXES = [
  'trận', 'chiến dịch', 'cuộc khởi nghĩa', 'hiệp ước', 'triều', 'nhà', 'vương quốc', 'đế quốc', 'đồn', 'pháo đài',
];
const GEOGRAPHY_NAME_PREFIX_SET = new Set(GEOGRAPHY_NAME_PREFIXES);

/** Generic nouns that may be part of a proper name; longest phrases match first. */
export const NAME_PREFIX_PHRASES = [...GEOGRAPHY_NAME_PREFIXES, ...EVENT_OR_POLITY_NAME_PREFIXES]
  .sort((a, b) => b.split(' ').length - a.split(' ').length);

const isYearToken = (value: string) => /^\d{4}$/u.test(value) && Number(value) >= YEAR_RANGE.min && Number(value) <= YEAR_RANGE.max;

const normalizedWord = (value: string) => clean(value).toLocaleLowerCase('vi');

function matchesPhraseBefore(words: ReadonlyArray<TimedWord>, index: number, phrase: string): boolean {
  const parts = phrase.split(' ');
  if (index < parts.length) return false;
  return parts.every((part, offset) => normalizedWord(words[index - parts.length + offset]!.text) === part);
}

function matchesPhraseAt(words: ReadonlyArray<TimedWord>, index: number, phrase: string): boolean {
  const parts = phrase.split(' ');
  if (index < 0 || index + parts.length > words.length) return false;
  return parts.every((part, offset) => normalizedWord(words[index + offset]!.text) === part);
}

function sentenceCase(value: string): string {
  const lower = value.toLocaleLowerCase('vi');
  return `${lower.slice(0, 1).toLocaleUpperCase('vi')}${lower.slice(1)}`;
}

type NamePrefixMatch = { phrase: string; startIndex: number; nameIndex: number; kind: 'geography' | 'event' };

function namePrefixKind(phrase: string): NamePrefixMatch['kind'] {
  return GEOGRAPHY_NAME_PREFIX_SET.has(phrase) ? 'geography' : 'event';
}

function namePrefixBefore(words: ReadonlyArray<TimedWord>, index: number): NamePrefixMatch | null {
  for (const phrase of NAME_PREFIX_PHRASES) {
    const startIndex = index - phrase.split(' ').length;
    if (matchesPhraseBefore(words, index, phrase)) {
      return { phrase, startIndex, nameIndex: index, kind: namePrefixKind(phrase) };
    }
  }
  return null;
}

function namePrefixAt(words: ReadonlyArray<TimedWord>, index: number): NamePrefixMatch | null {
  if (!isCapitalized(clean(words[index]?.text ?? ''))) return null;
  for (const phrase of NAME_PREFIX_PHRASES) {
    const nameIndex = index + phrase.split(' ').length;
    if (matchesPhraseAt(words, index, phrase) && isCapitalized(clean(words[nameIndex]?.text ?? ''))) {
      return { phrase, startIndex: index, nameIndex, kind: namePrefixKind(phrase) };
    }
  }
  return null;
}

function capitalizeFirst(value: string): string {
  return `${value.slice(0, 1).toLocaleUpperCase('vi')}${value.slice(1)}`;
}

function nameMetadata(words: ReadonlyArray<TimedWord>, index: number, prefixKind?: NamePrefixMatch['kind']): Pick<Candidate, 'nameRole' | 'subtitle'> {
  const role = ROLE_PHRASES.find((phrase) => matchesPhraseBefore(words, index, phrase));
  const place = LOCATIVE_PHRASES.some((phrase) => matchesPhraseBefore(words, index, phrase));
  if (prefixKind === 'event') {
    return role ? { subtitle: sentenceCase(role) } : {};
  }
  return {
    nameRole: prefixKind === 'geography' || place ? 'place' : 'person',
    ...(role ? { subtitle: sentenceCase(role) } : {}),
  };
}

function dateCandidate(words: ReadonlyArray<TimedWord>, index: number): { candidate: Candidate; endIndex: number } | null {
  const token = clean(words[index]!.text).toLocaleLowerCase('vi');
  const next = (offset: number) => clean(words[index + offset]?.text ?? '');
  const numeric = (value: string) => /^\d+$/u.test(value);
  const startSec = words[index]!.startSec;

  const hasDayPrefix = token === 'ngày' && numeric(next(1)) && clean(words[index + 2]?.text ?? '').toLocaleLowerCase('vi') === 'tháng';
  const monthIndex = hasDayPrefix ? index + 2 : token === 'tháng' ? index : -1;
  if (monthIndex >= 0 && numeric(next(monthIndex - index + 1)) && clean(words[monthIndex + 2]?.text ?? '').toLocaleLowerCase('vi') === 'năm' && numeric(clean(words[monthIndex + 3]?.text ?? ''))) {
    const day = hasDayPrefix ? next(1) : null;
    const month = clean(words[monthIndex + 1]!.text);
    const year = clean(words[monthIndex + 3]!.text);
    return {
      candidate: { text: day ? `${day}/${month}/${year}` : `${month}/${year}`, startSec, phraseEndSec: words[monthIndex + 3]!.endSec, priority: 0, kind: 'date' },
      endIndex: monthIndex + 3,
    };
  }
  if (token === 'năm' && numeric(next(1))) {
    return {
      candidate: { text: next(1), startSec, phraseEndSec: words[index + 1]!.endSec, priority: 0, kind: isYearToken(next(1)) ? 'year' : 'number' },
      endIndex: index + 1,
    };
  }
  return null;
}

/** Select a few narration-derived phrases; endSec includes the full fade. */
export function selectKeywords(words: ReadonlyArray<TimedWord>): Keyword[] {
  if (words.length === 0) return [];
  // The final aligned word ends no later than the WAV. It is a conservative audio-end bound.
  const audioEndSec = words[words.length - 1]!.endSec;
  const centerCandidates: Candidate[] = [];
  const nameCandidates: Candidate[] = [];
  const addNameCandidate = (nameIndex: number, last: number, prefix: NamePrefixMatch | null) => {
    const role = ROLE_PHRASES.find((phrase) => matchesPhraseBefore(words, nameIndex, phrase));
    const effectivePrefix = role ? null : prefix;
    const nameText = words.slice(nameIndex, last + 1).map((word) => clean(word.text)).join(' ');
    const prefixText = effectivePrefix
      ? capitalizeFirst(words.slice(effectivePrefix.startIndex, nameIndex).map((word) => clean(word.text)).join(' '))
      : '';
    nameCandidates.push({
      text: prefixText ? `${prefixText} ${nameText}` : nameText,
      startSec: words[effectivePrefix?.startIndex ?? nameIndex]!.startSec,
      phraseEndSec: words[last]!.endSec,
      priority: 1,
      kind: 'name',
      ...nameMetadata(words, nameIndex, effectivePrefix?.kind),
    });
  };
  for (let index = 0; index < words.length; index++) {
    const date = dateCandidate(words, index);
    if (date) {
      centerCandidates.push(date.candidate);
      index = date.endIndex;
      continue;
    }
    const first = words[index]!;
    const firstText = clean(first.text);
    if (/\d/u.test(firstText)) {
      let last = index;
      while (last + 1 < words.length && NUMBER_UNIT_TOKENS.has(clean(words[last + 1]!.text).toLocaleLowerCase('vi'))) last++;
      centerCandidates.push({
        text: words.slice(index, last + 1).map((word) => clean(word.text)).join(' ').replace(/ %/gu, '%'),
        startSec: first.startSec,
        phraseEndSec: words[last]!.endSec,
        priority: 0,
        kind: last === index && isYearToken(firstText) ? 'year' : 'number',
      });
      index = last;
      continue;
    }
    const prefixBeforeCurrent = namePrefixBefore(words, index);
    const prefixAtCurrent = prefixBeforeCurrent ? null : namePrefixAt(words, index);
    if (prefixAtCurrent) {
      let last = prefixAtCurrent.nameIndex;
      while (last + 1 < words.length && isCapitalized(clean(words[last + 1]!.text))) last++;
      addNameCandidate(prefixAtCurrent.nameIndex, last, prefixAtCurrent);
      index = last;
      continue;
    }
    if (isSentenceStart(words, index) || !isCapitalized(firstText)) continue;
    // A capitalized continuation of a sentence-start run belongs to that run;
    // do not surface its trailing token as a single-name lower third.
    if (isCapitalized(clean(words[index - 1]?.text ?? ''))) continue;
    let last = index;
    while (last + 1 < words.length && isCapitalized(clean(words[last + 1]!.text))) last++;
    if (last >= index) {
      addNameCandidate(index, last, prefixBeforeCurrent);
      index = last;
    }
  }

  centerCandidates.sort((a, b) => a.priority - b.priority || a.startSec - b.startSec);
  const selectedCenter: Keyword[] = [];
  for (const candidate of centerCandidates) {
    const endSec = Math.min(audioEndSec, Math.round((candidate.startSec + Math.max(candidate.phraseEndSec - candidate.startSec, MIN_KEYWORD_HOLD_SEC) + KEYWORD_FADE_SEC) * 1000) / 1000);
    if (endSec - candidate.startSec < KEYWORD_FADE_SEC) continue;
    if (selectedCenter.some((prior) => Math.abs(prior.startSec - candidate.startSec) < MIN_KEYWORD_START_SPACING_SEC ||
      (candidate.startSec < prior.endSec && prior.startSec < endSec))) continue;
    selectedCenter.push(enrichKeyword({ text: candidate.text, startSec: candidate.startSec, endSec, kind: candidate.kind }));
    if (selectedCenter.length === MAX_KEYWORDS_PER_SCENE) break;
  }

  const selectedName = nameCandidates
    .sort((a, b) => a.startSec - b.startSec)
    .map((candidate) => {
      const endSec = Math.min(audioEndSec, Math.round((candidate.startSec + Math.max(candidate.phraseEndSec - candidate.startSec, LOWER_THIRD_HOLD_SEC) + KEYWORD_FADE_SEC) * 1000) / 1000);
      return { candidate, endSec };
    })
    .find(({ candidate, endSec }) => endSec - candidate.startSec >= LOWER_THIRD_MIN_REMAIN_SEC);
  const selected: Keyword[] = [...selectedCenter];
  if (selectedName) {
    const { candidate, endSec } = selectedName;
    selected.push({
      text: candidate.text,
      startSec: candidate.startSec,
      endSec,
      kind: 'name',
      ...(candidate.nameRole ? { nameRole: candidate.nameRole } : {}),
      ...(candidate.subtitle ? { subtitle: candidate.subtitle } : {}),
    });
  }
  return selected.sort((a, b) => a.startSec - b.startSec);
}

/**
 * Parse a Vietnamese-formatted leading number ("." = thousands, "," = decimal).
 * Returns null when the phrase does not start with a cleanly formatted number.
 */
export function parseNumberPhrase(text: string): { value: number; decimals: number; grouping: boolean; prefix: string; suffix: string } | null {
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?![\d.,])/u.exec(text);
  if (!match) return null;
  const integer = match[1]!;
  const fraction = match[2] ?? '';
  const value = Number(`${integer.replace(/\./gu, '')}${fraction ? `.${fraction}` : ''}`);
  if (!Number.isFinite(value)) return null;
  return { value, decimals: fraction.length, grouping: integer.includes('.'), prefix: '', suffix: text.slice(match[0].length).trimStart() };
}

function enrichKeyword(keyword: Keyword): Keyword {
  if (keyword.kind === 'number') {
    const parsed = parseNumberPhrase(keyword.text);
    return parsed ? { ...keyword, ...parsed } : keyword;
  }
  if (keyword.kind === 'year') return { ...keyword, year: Number(keyword.text) };
  if (keyword.kind === 'date') {
    const year = Number(keyword.text.split('/').at(-1));
    return Number.isInteger(year) ? { ...keyword, year } : keyword;
  }
  return keyword;
}

/**
 * Chain year pop-ups across the whole video, in mention order: each year rolls
 * from the previous year mentioned (dates count as mentions), and every year
 * pop-up shares one project-wide timeline range.
 */
export function annotateYearKeywords(scenes: ReadonlyArray<ReadonlyArray<Keyword>>): Keyword[][] {
  let previous: number | null = null;
  const mentioned: number[] = [];
  const chained = scenes.map((keywords) => [...keywords].sort((a, b) => a.startSec - b.startSec).map((keyword) => {
    if (keyword.year === undefined) return keyword;
    let next: Keyword = keyword;
    if (keyword.kind === 'year') {
      const fromYear = Math.max(YEAR_RANGE.min, previous ?? keyword.year - FIRST_YEAR_ROLL_SPAN);
      next = { ...keyword, fromYear };
      mentioned.push(fromYear);
    }
    mentioned.push(keyword.year);
    previous = keyword.year;
    return next;
  }));
  if (mentioned.length === 0) return chained;
  let min = Math.min(...mentioned);
  let max = Math.max(...mentioned);
  if (max === min) max = min + 1;
  const pad = Math.max(1, Math.round((max - min) * TIMELINE_PAD_RATIO));
  min -= pad;
  max += pad;
  return chained.map((keywords) => keywords.map((keyword) => (keyword.kind === 'year' ? { ...keyword, timeline: { min, max } } : keyword)));
}

/** Resolve the old-film look scene by scene from the latest narrated year/date mention. */
export function resolveFilmLookByScene(
  scenes: ReadonlyArray<ReadonlyArray<Pick<Keyword, 'year' | 'startSec'>>>,
  style: FilmLookStyle = 'auto',
): boolean[] {
  if (style === 'always') return scenes.map(() => true);
  if (style === 'off') return scenes.map(() => false);

  let currentYear: number | null = null;
  return scenes.map((keywords) => {
    for (const keyword of [...keywords].sort((a, b) => a.startSec - b.startSec)) {
      if (keyword.year !== undefined) currentYear = keyword.year;
    }
    return currentYear !== null && currentYear < FILM_LOOK_BEFORE_YEAR;
  });
}

function normalizeNameMention(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeNameDedupeKey(value: string): string {
  const normalized = normalizeNameMention(value);
  for (const prefix of NAME_PREFIX_PHRASES) {
    const normalizedPrefix = normalizeNameMention(prefix);
    if (normalized.startsWith(`${normalizedPrefix} `)) return normalized.slice(normalizedPrefix.length + 1);
  }
  return normalized;
}

/** Keep only the first lower-third mention of each name across the project. */
export function annotateNameKeywords(scenes: ReadonlyArray<ReadonlyArray<Keyword>>): Keyword[][] {
  const seen = new Set<string>();
  return scenes.map((keywords) => keywords.filter((keyword) => {
    if (keyword.kind !== 'name') return true;
    const key = normalizeNameDedupeKey(keyword.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}
