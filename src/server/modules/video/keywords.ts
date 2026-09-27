import type { KeywordKind, RemotionKeyword } from '../../../contracts/video';

export type TimedWord = { text: string; startSec: number; endSec: number };
export type Keyword = RemotionKeyword & { kind: KeywordKind };

export const NUMBER_UNIT_TOKENS = new Set(['tỷ', 'triệu', 'nghìn', 'ngàn', 'trăm', '%', 'đô', 'la', 'usd', 'năm']);
export const MAX_KEYWORDS_PER_SCENE = 2;
export const MIN_KEYWORD_START_SPACING_SEC = 2.5;
export const MIN_KEYWORD_HOLD_SEC = 1.2;
export const KEYWORD_FADE_SEC = 0.3;
/** Lone 4-digit tokens in this range are treated as calendar years. */
export const YEAR_RANGE = { min: 1000, max: 2100 } as const;
/** The first year in a video rolls up from this many years earlier. */
export const FIRST_YEAR_ROLL_SPAN = 10;
/** Timeline padding as a fraction of its span (at least one year each side). */
export const TIMELINE_PAD_RATIO = 0.05;

const clean = (text: string) => text.replace(/[\p{P}]+$/gu, (suffix) => suffix.replace(/[^%]/gu, ''));
const isCapitalized = (text: string) => /^\p{Lu}/u.test(text);
const isSentenceStart = (words: ReadonlyArray<TimedWord>, index: number) =>
  index === 0 || /[.!?]["'”’)]*$/u.test(words[index - 1]?.text ?? '');

type Candidate = { text: string; startSec: number; phraseEndSec: number; priority: number; kind: KeywordKind };

const isYearToken = (value: string) => /^\d{4}$/u.test(value) && Number(value) >= YEAR_RANGE.min && Number(value) <= YEAR_RANGE.max;

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
  const candidates: Candidate[] = [];
  for (let index = 0; index < words.length; index++) {
    const date = dateCandidate(words, index);
    if (date) {
      candidates.push(date.candidate);
      index = date.endIndex;
      continue;
    }
    const first = words[index]!;
    const firstText = clean(first.text);
    if (/\d/u.test(firstText)) {
      let last = index;
      while (last + 1 < words.length && NUMBER_UNIT_TOKENS.has(clean(words[last + 1]!.text).toLocaleLowerCase('vi'))) last++;
      candidates.push({
        text: words.slice(index, last + 1).map((word) => clean(word.text)).join(' ').replace(/ %/gu, '%'),
        startSec: first.startSec,
        phraseEndSec: words[last]!.endSec,
        priority: 0,
        kind: last === index && isYearToken(firstText) ? 'year' : 'number',
      });
      index = last;
      continue;
    }
    if (isSentenceStart(words, index) || !isCapitalized(firstText)) continue;
    let last = index;
    while (last + 1 < words.length && isCapitalized(clean(words[last + 1]!.text))) last++;
    if (last > index) {
      candidates.push({
        text: words.slice(index, last + 1).map((word) => clean(word.text)).join(' '),
        startSec: first.startSec,
        phraseEndSec: words[last]!.endSec,
        priority: 1,
        kind: 'name',
      });
      index = last;
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.startSec - b.startSec);
  const selected: Keyword[] = [];
  for (const candidate of candidates) {
    const endSec = Math.min(audioEndSec, Math.round((candidate.startSec + Math.max(candidate.phraseEndSec - candidate.startSec, MIN_KEYWORD_HOLD_SEC) + KEYWORD_FADE_SEC) * 1000) / 1000);
    if (endSec - candidate.startSec < KEYWORD_FADE_SEC) continue;
    if (selected.some((prior) => Math.abs(prior.startSec - candidate.startSec) < MIN_KEYWORD_START_SPACING_SEC ||
      (candidate.startSec < prior.endSec && prior.startSec < endSec))) continue;
    selected.push(enrichKeyword({ text: candidate.text, startSec: candidate.startSec, endSec, kind: candidate.kind }));
    if (selected.length === MAX_KEYWORDS_PER_SCENE) break;
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
